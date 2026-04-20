#!/usr/bin/env node
// Entry point for the Todorant MCP server.
// Uses stdio transport — the standard for local MCP clients like Claude Desktop.
// Config is loaded eagerly so a missing token fails before we bind the transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { TodorantClient } from "./client.js";
import { registerTodorantTools } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new TodorantClient(config);

  const server = new McpServer(
    {
      name: "todorant-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerTodorantTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Stay alive — transport handles the message loop. Log to stderr so we don't
  // corrupt the JSON-RPC stream on stdout.
  process.stderr.write("todorant-mcp running on stdio\n");
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
