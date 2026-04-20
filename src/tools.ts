// MCP tool registrations for Todorant.
//
// Each tool maps one backend endpoint to an LLM-callable tool. Input schemas
// are expressed as Zod shapes so the SDK can generate JSON Schema for clients,
// and handlers translate API responses into compact text + structuredContent
// so both text-only and structured-aware clients get what they need.
//
// Naming: every tool is prefixed `todorant_` so it's easy to filter in tool
// pickers and to avoid collisions with other MCP servers.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TodorantClient, TodorantApiError } from "./client.js";

// "YYYY-MM-DD" — full date used for the "today" context.
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
// "YYYY-MM" — monthAndYear bucket that Todorant uses internally.
const monthYearRegex = /^\d{4}-\d{2}$/;
// "DD" — day-of-month string.
const dayRegex = /^\d{2}$/;
// "HH:MM" — 24h time string.
const timeRegex = /^\d{2}:\d{2}$/;
// Mongo ObjectId — 24 hex chars. Validates todo IDs without reaching the network.
const objectIdRegex = /^[a-f0-9]{24}$/i;

// Render errors in a way the calling LLM can act on — include the HTTP status
// and the server-provided body so it can decide whether to retry, re-auth,
// or ask the user for corrected input.
function toolError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  if (error instanceof TodorantApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Todorant API error (HTTP ${error.status}): ${error.message}\nBody: ${error.body || "<empty>"}`,
        },
      ],
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Unexpected error: ${message}` }],
  };
}

// Shape helper — tool returns both a human-readable text block and a
// structured payload for clients that can consume it.
function ok(text: string, structured?: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structured !== undefined ? { structuredContent: structured as Record<string, unknown> } : {}),
  };
}

export function registerTodorantTools(server: McpServer, client: TodorantClient): void {
  server.registerTool(
    "todorant_whoami",
    {
      title: "Whoami",
      description:
        "Validate the configured Todorant token and return the associated user profile. Use this to check that authentication is working before attempting other operations.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const user = await client.whoami();
        return ok(`Authenticated.\n${JSON.stringify(user, null, 2)}`, { user });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_get_current_task",
    {
      title: "Get current task",
      description:
        "Fetch the single task Todorant considers 'current' for a given day — the one the user should focus on right now. Also returns total and incomplete todo counts for that day.",
      inputSchema: {
        date: z
          .string()
          .regex(dateRegex, "Must be in YYYY-MM-DD format")
          .describe("The day to check, in YYYY-MM-DD format (e.g. 2026-04-20)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ date }) => {
      try {
        const result = await client.getCurrentTask(date);
        const summary = result.todo
          ? `Current task: "${result.todo.text}" (id: ${result.todo._id}${result.todo.frog ? ", 🐸 frog" : ""})\nIncomplete today: ${result.incompleteTodosCount}/${result.todosCount}`
          : `No current task for ${date}. Incomplete today: ${result.incompleteTodosCount}/${result.todosCount}`;
        return ok(summary, result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_list_todos",
    {
      title: "List todos",
      description:
        "List todos with optional filtering by completion state, tag hash, fuzzy text search, and pagination. Returns a sorted list with Todorant's native ordering (frogs first, then by order within day).",
      inputSchema: {
        completed: z
          .boolean()
          .optional()
          .describe("If true, return completed todos; if false or omitted, return open ones"),
        hash: z
          .string()
          .optional()
          .describe("Comma-separated tag hashes to filter by, e.g. 'work,urgent'"),
        queryString: z
          .string()
          .optional()
          .describe("Fuzzy text search against todo text"),
        skip: z.number().int().min(0).optional().describe("Number of results to skip (pagination)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Maximum number of results to return (1-500)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const result = await client.listTodos(args);
        const lines = result.todos.map((t, i) => {
          const when = t.monthAndYear
            ? `${t.monthAndYear}${t.date ? `-${t.date}` : ""}${t.time ? ` ${t.time}` : ""}`
            : "—";
          const flags = [
            t.frog ? "🐸" : null,
            t.completed ? "✓" : null,
            t.repetitive ? "🔁" : null,
            t.skipped ? "⏭" : null,
          ]
            .filter(Boolean)
            .join("");
          return `${i + 1}. [${t._id}] ${when} ${flags} ${t.text}`;
        });
        const header = `Found ${result.todos.length} todo(s).`;
        return ok(lines.length ? `${header}\n${lines.join("\n")}` : header, result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_create_todo",
    {
      title: "Create todo",
      description:
        "Create a new todo. Every todo must belong to a month (monthAndYear) — if you want it scheduled for a specific day, also pass `date`. Mark it as a frog for the highest-priority 'do it first in the morning' slot.",
      inputSchema: {
        text: z.string().min(1).describe("Todo text / description"),
        monthAndYear: z
          .string()
          .regex(monthYearRegex, "Must be in YYYY-MM format")
          .describe("Target month in YYYY-MM format (e.g. 2026-04)"),
        date: z
          .string()
          .regex(dayRegex, "Must be a two-digit day of month like '01' or '31'")
          .optional()
          .describe("Optional day of month as two digits (e.g. '20'). Omit for month-level todos."),
        time: z
          .string()
          .regex(timeRegex, "Must be in HH:MM (24h) format")
          .optional()
          .describe("Optional time of day in HH:MM 24h format"),
        frog: z.boolean().optional().describe("Mark as a frog (high-priority, do-it-first task)"),
        repetitive: z.boolean().optional().describe("Mark as repetitive / recurring"),
        goFirst: z
          .boolean()
          .optional()
          .describe("Insert at the top of its day group instead of the bottom"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        await client.createTodos([args]);
        return ok(`Created todo: "${args.text}" (${args.monthAndYear}${args.date ? `-${args.date}` : ""})`);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_update_todo",
    {
      title: "Update todo",
      description:
        "Edit an existing todo. Only pass the fields you want to change. Note that the backend replaces most fields wholesale on update, so omitting a field that was previously set may clear it — read the todo first if unsure.",
      inputSchema: {
        id: z.string().regex(objectIdRegex, "Must be a 24-char hex Mongo ObjectId").describe("Todo ID (_id)"),
        text: z.string().optional().describe("New todo text"),
        completed: z.boolean().optional().describe("Completion state"),
        frog: z.boolean().optional().describe("Frog flag"),
        repetitive: z.boolean().optional().describe("Repetitive flag"),
        monthAndYear: z.string().regex(monthYearRegex).optional().describe("Target month in YYYY-MM"),
        date: z.string().regex(dayRegex).optional().describe("Day of month as two digits"),
        time: z.string().regex(timeRegex).optional().describe("Time of day in HH:MM"),
        today: z
          .string()
          .regex(dateRegex)
          .optional()
          .describe("Client's current date in YYYY-MM-DD (used by backend to detect overdue todos)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, ...patch }) => {
      try {
        const result = await client.updateTodo(id, patch);
        return ok(`Updated todo ${id}.`, result);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_mark_done",
    {
      title: "Mark todo done",
      description: "Mark a todo as completed. Awards a hero point and triggers a sync.",
      inputSchema: {
        id: z.string().regex(objectIdRegex).describe("Todo ID (_id)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        const result = await client.markDone(id);
        return ok(
          `Marked todo ${id} as done.${result?.incompleteFrogsExist ? " ⚠️ Incomplete frogs still exist for this day." : ""}`,
          result
        );
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_mark_undone",
    {
      title: "Mark todo undone",
      description: "Revert a completed todo back to incomplete.",
      inputSchema: {
        id: z.string().regex(objectIdRegex).describe("Todo ID (_id)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        await client.markUndone(id);
        return ok(`Marked todo ${id} as undone.`);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_skip_todo",
    {
      title: "Skip todo",
      description:
        "Skip a dated todo — pushes it behind its neighbours in the day's order. Only valid for incomplete todos with a date.",
      inputSchema: {
        id: z.string().regex(objectIdRegex).describe("Todo ID (_id)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        await client.skipTodo(id);
        return ok(`Skipped todo ${id}.`);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    "todorant_delete_todo",
    {
      title: "Delete todo",
      description:
        "Soft-delete a todo. The todo is marked deleted on the server but not physically removed; it will stop appearing in lists and current-task queries.",
      inputSchema: {
        id: z.string().regex(objectIdRegex).describe("Todo ID (_id)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        await client.deleteTodo(id);
        return ok(`Deleted todo ${id}.`);
      } catch (error) {
        return toolError(error);
      }
    }
  );
}
