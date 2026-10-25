# Development and contributing

[Documentation](README.md) · [Product overview](../README.md)

[Contributing](#contributing) · [License](#license)

## Contributing

Contributions are welcome, AI-assisted ones included. Read your diff before you send it, and make sure the tests pass. For anything bigger than a fix, open an issue first. [CONTRIBUTING.md](../CONTRIBUTING.md) has the details.

```bash
npm install
npm run build        # the package, its board page and the Claude Code mod's renderer
npm test             # SHOWBOARD_TEST_PG=<postgres url> also runs the Postgres tests
npm run test:pane    # the Claude Code mod, in Claude Code's own plugin test kit
npm run typecheck
npm run demo
```

| Folder | What is in it |
| --- | --- |
| `packages/showboard/src/server` | `createShowboard`, the tools, read-only database access, spreadsheet loading, the HTTP handler |
| `packages/showboard/src/react` | `ShowboardProvider`, `Board`, the built-in components and the hooks |
| `packages/showboard/src/spec` | The component catalog, number formats and board checks |
| `packages/showboard/src/text` | Boards drawn as text, for the panes |
| `packages/showboard/src/cli` | The `serve`, `mcp`, `init` and `pane` commands, and each agent's settings |
| `packages/showboard/src/viewer` | Showboard's own board page |
| `plugins/claude-code` | The Claude Code plugin: a Showboard server and the pane beside the chat, listed for `/plugin install` in `.claude-plugin/marketplace.json` |
| `plugins/claude-desktop` | The Claude desktop extension: `manifest.json` and `build.mjs`, which writes `showboard-<version>.mcpb` |
| `examples/` | The demo shop and the sample spreadsheets |
| `bench/` | The cost benchmark |

## License

MIT. See [LICENSE](../LICENSE).

