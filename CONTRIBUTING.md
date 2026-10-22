# Contributing to Showboard

Thanks for helping. Showboard is vibecoded: coding agents, mostly Claude Code, wrote most of it, and pull requests written the same way are welcome. What matters is that you have read the change and the tests pass.

## Set up

You need Node.js 22.13 or later.

```bash
git clone https://github.com/rohanbeingsocial/showboard.git
cd showboard
npm install
npm run build        # the package, its board page and the Claude Code mod's renderer
```

## Check your change

```bash
npm test             # SHOWBOARD_TEST_PG=<postgres url> also runs the Postgres tests
npm run typecheck
npm run test:pane    # if you changed plugins/claude-code or packages/showboard/src/text; needs the claude CLI
npm run demo         # try it in the demo shop at http://localhost:4710
```

The tests are in `packages/showboard/test`, and the folders are described in the [README](README.md#contributing).

## Pull requests

- Keep each one to a single change, and say what it does and why.
- Add or update a test when you change what Showboard does.
- Update the [README](README.md) or [docs/reference.md](docs/reference.md) when you change something people see or type.
- Code from a coding agent is fine. Read the diff before you send it.
- For anything bigger than a fix, open an issue first, so the idea can be agreed before the work.

## Reporting a bug

Open an [issue](https://github.com/rohanbeingsocial/showboard/issues) with what you asked, what you expected and what you got, plus your agent, operating system and Node.js version. For a board that looks wrong, its JSON file from the `.showboard/boards` folder helps, but it holds the board's rows, so attach it only if they are fine to share.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
