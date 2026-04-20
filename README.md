# todorant-mcp

MCP server for [Todorant](https://todorant.com) — manage your one-task-at-a-time todos from Claude Desktop, Claude Code, and any other [Model Context Protocol](https://modelcontextprotocol.io) client.

## What it does

Exposes Todorant's core todo operations as MCP tools:

| Tool | Action |
|---|---|
| `todorant_whoami` | Validate token and fetch user profile |
| `todorant_get_current_task` | Get the "one task to focus on" for a given day |
| `todorant_list_todos` | List todos with filtering, search, and pagination |
| `todorant_create_todo` | Create a new todo |
| `todorant_update_todo` | Edit an existing todo |
| `todorant_mark_done` | Complete a todo |
| `todorant_mark_undone` | Revert a completed todo |
| `todorant_skip_todo` | Skip a dated todo to later in the day |
| `todorant_delete_todo` | Soft-delete a todo |

## Install

```bash
git clone https://github.com/kyemets/todorant-mcp.git
cd todorant-mcp
npm install
npm run build
```

## Get your Todorant token

Todorant authenticates via JWT. Since there's no public "create API key" flow, grab your existing session token:

1. Sign in at [todorant.com](https://todorant.com).
2. Open DevTools → Application → Local Storage → `https://todorant.com`.
3. Find the `user` key. Its value is JSON; copy the `token` field.

Treat this token like a password — it has full read/write access to your todos.

## Configure Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "todorant": {
      "command": "node",
      "args": ["/absolute/path/to/todorant-mcp/dist/index.js"],
      "env": {
        "TODORANT_TOKEN": "your-jwt-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see nine `todorant_*` tools available.

## Configure Claude Code

```bash
claude mcp add todorant \
  -e TODORANT_TOKEN=your-jwt-token-here \
  -- node /absolute/path/to/todorant-mcp/dist/index.js
```

## Environment variables

| Name | Required | Default | Description |
|---|---|---|---|
| `TODORANT_TOKEN` | yes | — | JWT token for authentication |
| `TODORANT_BASE_URL` | no | `https://backend.todorant.com` | Override for self-hosted instances |

## Development

```bash
npm run dev          # tsc --watch
npm run typecheck    # one-off type check
npm run inspect      # launch MCP Inspector against the built server
```

## Examples

Once connected, you can ask Claude things like:

- *"What's my current task?"* → `todorant_get_current_task`
- *"Add 'review PR #42' as a frog for tomorrow"* → `todorant_create_todo`
- *"Mark the deploy task as done"* → `todorant_list_todos` + `todorant_mark_done`
- *"Show me what's open this week"* → `todorant_list_todos`

## Disclaimer

This is an unofficial community project. Not affiliated with or endorsed by Todorant or its author. Todorant itself is [open source](https://github.com/Borodutch) under MIT.

## License

MIT — see [LICENSE](./LICENSE).
