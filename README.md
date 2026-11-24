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

Options: `--yes`, `--dir <path>`, `--agents claude,agents`, and for `init` `--no-key`, `--no-skills`, `--no-agents-md`, `--no-test`.

The key never goes on the command line and is never printed (only `lv_live_…abcd`).

## Environment

| Variable | Default |
|---|---|
| `LEVANTO_BASE_URL` | `https://api.levanto.ai` |
| `LEVANTO_DASHBOARD_URL` | `https://platform.levanto.ai` |
| `NO_COLOR` | colour on a TTY |

Node 18 or newer. No dependencies. MIT.
