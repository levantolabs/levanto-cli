# levanto

Set up [Levanto](https://levanto.ai) in a project in one command:

```bash
npx levanto init
```

It:

1. finds your API key (`LEVANTO_API_KEY` in your environment or `.env`), or opens your browser to create one and saves it to `.env` (git-ignored);
2. installs the `levanto-sage` and `levanto-llms` skills for your coding agents (`.claude/skills/` for Claude Code, `.agents/skills/` for Codex, Cursor, Copilot and others);
3. adds a short Levanto section to `AGENTS.md` (and `CLAUDE.md` if you have one);
4. makes one test decision.

Then ask your agent: *Find where Levanto fits in this project.*

Coding agents run it without questions:

```bash
npx -y levanto@latest init --yes
```

## Commands

| Command | Does |
|---|---|
| `levanto init` | Everything above |
| `levanto login` | Only the key |
| `levanto skills` | Only the skills and the `AGENTS.md` section |
| `levanto mcp` | The Sage MCP server, for agents |

Options: `--yes`, `--dir <path>`, `--agents claude,agents`, and for `init` `--no-key`, `--no-skills`, `--no-agents-md`, `--no-test`.

The key never goes on the command line and is never printed (only `lv_live_…abcd`).

## MCP server

`levanto mcp` runs a Model Context Protocol server over stdio with two tools:

- `decide`: yes/no, choice, scale, sort or tags, with a probability and `null` when Sage isn't sure. Takes text or a file (text, PNG, JPEG, WebP), and optional reasoning or web search.
- `extract`: typed fields (text, numbers, money, dates, times, durations) from text or a text file.

Add it to your agent's MCP config:

```json
{
  "mcpServers": {
    "levanto": {
      "command": "npx",
      "args": ["-y", "levanto@latest", "mcp"],
      "env": { "LEVANTO_API_KEY": "lv_live_..." }
    }
  }
}
```

Claude Code: `claude mcp add levanto -e LEVANTO_API_KEY=lv_live_... -- npx -y levanto@latest mcp`

Without `LEVANTO_API_KEY` in its environment, the server reads `.env` in the folder it runs in.

## Environment

| Variable | Default |
|---|---|
| `LEVANTO_BASE_URL` | `https://api.levanto.ai` |
| `LEVANTO_DASHBOARD_URL` | `https://platform.levanto.ai` |
| `NO_COLOR` | colour on a TTY |

Node 18 or newer. No dependencies. MIT.

## Releasing

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, then push a tag `v<version>`. The `Publish` workflow tests and publishes to npm through trusted publishing, so no npm token is stored anywhere.
