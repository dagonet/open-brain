# Open Brain MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude Code read and write access to your Open Brain through 22 tools. It is not published to npm; build it from a clone.

```bash
npm ci
npm run build          # then add dist/index.js to your .mcp.json and restart Claude Code
```

Rebuild after every `git pull`. The `.mcp.json` block, the environment variables, all 22 tools with their parameters, the per-repo opt-out and the version history are in [`docs/mcp.md`](../docs/mcp.md). Install guide: [`docs/install.md`](../docs/install.md#6-set-up-the-mcp-server-claude-code).

`sql/match_thoughts.sql` here is deprecated: migration 008 is the source of truth for `match_thoughts`.

> Inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) via Nate B Jones — [Karpathy's Wiki vs Open Brain](https://www.youtube.com/watch?v=dxq7WtWxi44).
