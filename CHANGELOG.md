# Changelog


## 1.2.1 (2026-11-25)

- Stops when run in your home folder, which isn't a project: asks first in a terminal, and refuses with `--yes` or without a terminal. Pass `--dir` to set up a folder on purpose.
- The test decision retries once after a connection error such as a reset.
## 1.2.0 (2026-11-24)

First release of the setup CLI. (Versions 0.1.0 and 1.1.0 of the `levanto` npm name belonged to the retired SDK and were unpublished on 2026-10-01; npm doesn't allow reusing them.)

- `levanto init`: key, agent skills, AGENTS.md / CLAUDE.md section, one test decision.
- `levanto login`: browser sign-in that creates a key and saves it to `.env`, or a masked paste.
- `levanto skills`: install or update the `levanto-sage` and `levanto-llms` skills.
