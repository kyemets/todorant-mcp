// Typed HTTP client for the Todorant backend.
// All methods inject the JWT into the `token` header (Todorant's custom auth scheme —
// not the standard `Authorization: Bearer`). Errors are normalised into a single
// TodorantApiError that tools can render back to the LLM with actionable context.

import type { Config } from "./config.js";

export interface Todo {
  _id: string;
  text: string;
  completed: boolean;
  frog: boolean;
  repetitive: boolean;
  skipped: boolean;
  deleted: boolean;
  encrypted: boolean;
  order: number;
  frogFails: number;
  monthAndYear?: string; // "YYYY-MM"
  date?: string; // "DD"
  time?: string; // "HH:MM"
  clientId?: string;
  updatedAt?: string;
}

export interface CurrentTaskResponse {
  todosCount: number;
  incompleteTodosCount: number;
  todo?: Todo;
  points?: unknown;
  state?: unknown;
  tags?: unknown;
}

export interface ListTodosResponse {
  todos: Todo[];
  points?: unknown;
  state?: unknown;
  tags?: unknown;
}

export interface CreateTodoInput {
  text: string;
  monthAndYear: string; // "YYYY-MM"
  date?: string; // "DD"
  time?: string; // "HH:MM"
  frog?: boolean;
  repetitive?: boolean;
  goFirst?: boolean;
}

export interface UpdateTodoInput {
  text?: string;
  completed?: boolean;
  frog?: boolean;
  repetitive?: boolean;
  monthAndYear?: string;
  date?: string;
  time?: string;
  today?: string; // "YYYY-MM-DD" used by backend to detect overdue
}

export interface ListTodosOptions {
  completed?: boolean;
  hash?: string; // tag filter, e.g. "#work"
  queryString?: string; // fuzzy search
  skip?: number;
  limit?: number;
  today?: string; // "YYYY-MM-DD" — required by backend (default: today's UTC date)
}

export class TodorantApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "TodorantApiError";
  }
}

export class TodorantClient {
  constructor(private readonly config: Config) {}

  // Core request helper — every public method goes through this so auth,
  // content-type, and error handling stay consistent.
  private async request<T>(
    path: string,
    init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {}
  ): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    if (init.query) {
      for (const [key, value] of Object.entries(init.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers(init.headers);
    headers.set("token", this.config.token);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url, { ...init, headers });

    if (!response.ok) {
      const body = await response.text();
      throw new TodorantApiError(
        `Todorant API ${response.status} ${response.statusText} at ${init.method ?? "GET"} ${path}`,
        response.status,
        body
      );
    }

    // Some endpoints respond 200 with empty body (e.g. POST /todo/).
    // Guard against JSON.parse on empty string.
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // Validate the configured token and return the associated user.
  async whoami(): Promise<unknown> {
    return this.request("/login/token", {
      method: "POST",
      body: JSON.stringify({ token: this.config.token }),
    });
  }

  // Fetch "the one task to focus on now" for a given day.
  // Backend requires date in "YYYY-MM-DD" format.
  async getCurrentTask(date: string): Promise<CurrentTaskResponse> {
    return this.request<CurrentTaskResponse>("/todo/current", {
      method: "GET",
      query: { date },
    });
  }

  // List todos with optional filtering and pagination.
  // `completed: false` returns open todos, `true` returns completed ones.
  //
  // Why `date` is injected: GET /todo/ builds its response via getStateBody(ctx),
  // which unconditionally requires `date` in YYYY-MM-DD format and throws
  // 403 invalidFormat otherwise. We default to today's UTC date so the caller
  // doesn't need to know about this backend quirk.
  async listTodos(options: ListTodosOptions = {}): Promise<ListTodosResponse> {
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    return this.request<ListTodosResponse>("/todo/", {
      method: "GET",
      query: {
        date: today,
        completed: options.completed ?? false,
        hash: options.hash,
        queryString: options.queryString,
        skip: options.skip,
        limit: options.limit,
      },
    });
  }

  // Create one or many todos. Returns empty 200 on success.
  async createTodos(todos: CreateTodoInput[]): Promise<void> {
    await this.request("/todo/", {
      method: "POST",
      body: JSON.stringify({ todos }),
    });
  }

  // Edit an existing todo. Only pass the fields you want to change — but note
  // the backend treats undefined/null fields as "clear", so we only forward
  // explicitly provided keys.
  async updateTodo(id: string, patch: UpdateTodoInput): Promise<{ incompleteFrogsExist?: boolean }> {
    return this.request(`/todo/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  }

  async markDone(id: string): Promise<{ incompleteFrogsExist?: boolean }> {
    return this.request(`/todo/${encodeURIComponent(id)}/done`, { method: "PUT" });
  }

  async markUndone(id: string): Promise<void> {
    await this.request(`/todo/${encodeURIComponent(id)}/undone`, { method: "PUT" });
  }

  async skipTodo(id: string): Promise<void> {
    await this.request(`/todo/${encodeURIComponent(id)}/skip`, { method: "PUT" });
  }

  async deleteTodo(id: string): Promise<void> {
    await this.request(`/todo/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
