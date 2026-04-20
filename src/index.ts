#!/usr/bin/env node
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

  // Log to stderr — stdout is reserved for the JSON-RPC stream.
  process.stderr.write("todorant-mcp running on stdio\n");
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
