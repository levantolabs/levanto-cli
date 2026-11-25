// levanto: set up Levanto in a project.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { PACKAGE_ROOT } from './assets.js';
import { TARGETS, detectTargets, installSkills, parseAgentsFlag } from './agents.js';
import { AUTH_TIMEOUT_MS } from './auth-server.js';
import { describeDecision, testDecision } from './decide.js';
import { readEnvKey } from './env.js';
import { ENV_NAME, isValidKey } from './key.js';
import { resolveKey } from './login.js';
import { createOutput } from './output.js';
import { confirm, isInteractive } from './prompt.js';
import { installSnippet } from './snippet.js';

export function version() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
}

export const HELP = `levanto: set up Levanto in a project

Usage
  npx levanto init      key, agent skills, AGENTS.md section, one test decision
  npx levanto login     only the key: browser sign-in, saved to .env
  npx levanto skills    only install or update the skills and AGENTS.md section

Options
  --yes               accept every default, no questions (for coding agents)
  --dir <path>        project folder (default: current folder)
  --agents <list>     where to put skills: claude, agents (codex, cursor, copilot...)
  --no-skills         init: skip the skills
  --no-agents-md      init: skip the AGENTS.md / CLAUDE.md section
  --no-key            init: skip the key step
  --no-test           init: skip the test decision
  -h, --help          show this help
  -v, --version       show the version

The key is never taken on the command line. Set ${ENV_NAME} in your
environment or .env, or let \`levanto login\` create one.
Docs: https://docs.levanto.ai`;

const BOOL_FLAGS = new Set(['yes', 'no-skills', 'no-agents-md', 'no-key', 'no-test', 'help', 'version']);
const VALUE_FLAGS = new Set(['dir', 'agents']);
const SHORT = { y: 'yes', h: 'help', v: 'version' };

export class UsageError extends Error {}

export function parseArgs(argv) {
  const opts = { command: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/lv_live_/i.test(a)) {
      throw new UsageError(`Don't pass the key on the command line (it ends up in shell history). Put ${ENV_NAME} in .env or run \`npx levanto login\`.`);
    }
    if (a.startsWith('--')) {
      let [name, value] = a.slice(2).split(/=(.*)/s, 2);
      if (name === 'key' || name === 'api-key') {
        throw new UsageError(`There is no --${name} flag: the key never goes on the command line. Put ${ENV_NAME} in .env or run \`npx levanto login\`.`);
      }
      if (BOOL_FLAGS.has(name)) {
        if (value !== undefined) throw new UsageError(`--${name} takes no value`);
        opts[name] = true;
      } else if (VALUE_FLAGS.has(name)) {
        if (value === undefined) {
          value = argv[++i];
          if (value === undefined || value.startsWith('-')) throw new UsageError(`--${name} needs a value`);
        }
        opts[name] = value;
      } else {
        throw new UsageError(`Unknown option --${name}. See: npx levanto --help`);
      }
    } else if (a.startsWith('-') && a.length > 1) {
      for (const c of a.slice(1)) {
        if (!SHORT[c]) throw new UsageError(`Unknown option -${c}. See: npx levanto --help`);
        opts[SHORT[c]] = true;
      }
    } else if (!opts.command) {
      opts.command = a;
    } else {
      throw new UsageError(`Unexpected argument "${a}". See: npx levanto --help`);
    }
  }
  return opts;
}

function resolveDir(opts) {
  const dir = resolve(opts.dir ?? process.cwd());
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`Not a folder: ${dir}`);
  return dir;
}

/** True when the CLI would set up the home folder without being told to with --dir. */
function isUnaskedHome(dir, opts, env) {
  if (opts.dir) return false;
  const home = env.HOME?.trim() || homedir();
  if (!home) return false;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(home) === real(dir);
}

function skillsStep(dir, opts, out) {
  let targets;
  let detected = true;
  if (opts.agents) targets = parseAgentsFlag(opts.agents);
  else ({ targets, detected } = detectTargets(dir));
  const results = installSkills(dir, targets);
  let failed = false;
  for (const t of targets) {
    const rows = results.filter((r) => r.target === t);
    const done = rows.filter((r) => r.status !== 'skipped');
    if (done.length) {
      const verb = done.every((r) => r.status === 'updated') ? 'Updated' : 'Installed';
      out.ok(`${verb} skills in ${TARGETS[t].dir}/: ${done.map((r) => r.name).join(', ')} (${TARGETS[t].label})`);
    }
    for (const r of rows.filter((x) => x.status === 'skipped')) {
      out.fail(`Left ${r.path} alone: ${r.reason}.`);
      failed = true;
    }
  }
  if (!detected && !opts.agents) out.note('No agent config found, so installed for Claude Code and the .agents/ standard.');
  return !failed;
}

function snippetStep(dir, out) {
  for (const r of installSnippet(dir)) {
    if (r.status === 'imports AGENTS.md') out.ok(`${r.file} imports AGENTS.md; left as is`);
    else if (r.status === 'unchanged') out.ok(`${r.file} already has the Levanto section`);
    else out.ok(`${r.status === 'created' ? 'Created' : 'Updated'} ${r.file} with the Levanto section`);
  }
  return true;
}

async function testStep(key, out) {
  const r = await testDecision(key);
  if (r.ok) {
    out.ok(describeDecision(r));
    return true;
  }
  out.fail(r.message);
  return false;
}

function makeAsk(opts, interactive) {
  if (opts.yes || !interactive) return async () => true;
  return (q) => confirm(q);
}

export async function run(argv, { env = process.env } = {}) {
  const out = createOutput({ env });
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    out.fail(e.message);
    return 1;
  }
  if (opts.version) {
    out.line(version());
    return 0;
  }
  if (opts.help || !opts.command || opts.command === 'help') {
    out.line(HELP);
    return 0;
  }

  const ask = makeAsk(opts, isInteractive());
  const timeoutMs = Number(env.LEVANTO_AUTH_TIMEOUT_MS) > 0 ? Number(env.LEVANTO_AUTH_TIMEOUT_MS) : AUTH_TIMEOUT_MS;
  let dir;
  try {
    dir = resolveDir(opts);
    if (opts.agents) parseAgentsFlag(opts.agents);
  } catch (e) {
    out.fail(e.message);
    return 1;
  }

  if (['init', 'login', 'skills'].includes(opts.command) && isUnaskedHome(dir, opts, env)) {
    const here = 'This is your home folder, not a project.';
    if (opts.yes || !isInteractive()) {
      out.fail(`${here} Run this inside a project folder, or pass --dir to choose one.`);
      return 1;
    }
    if (!(await confirm(`${here} Set up Levanto here anyway?`, { defaultYes: false }))) {
      out.line('Nothing changed. Run this again inside a project folder.');
      return 1;
    }
  }

  try {
    if (opts.command === 'login') {
      const r = await resolveKey({ dir, out, env, interactive: isInteractive(), ask, timeoutMs });
      return r.key && !r.failed ? 0 : 1;
    }

    if (opts.command === 'skills') {
      const ok = skillsStep(dir, opts, out) && snippetStep(dir, out);
      return ok ? 0 : 1;
    }

    if (opts.command !== 'init') {
      out.fail(`Unknown command "${opts.command}". See: npx levanto --help`);
      return 1;
    }

    let ok = true;
    let key = null;
    out.line(out.bold(`Setting up Levanto in ${dir}`));

    if (opts['no-key']) {
      out.skip('Key step skipped (--no-key)');
      const k = env[ENV_NAME]?.trim() || readEnvKey(dir);
      key = isValidKey(k) ? k : null;
    } else {
      const r = await resolveKey({ dir, out, env, interactive: isInteractive(), ask, timeoutMs });
      key = r.key;
      if (r.failed) ok = false;
    }

    if (opts['no-skills']) out.skip('Skills skipped (--no-skills)');
    else if (await ask('Install the Levanto skills for your coding agents?')) ok = skillsStep(dir, opts, out) && ok;
    else out.skip('Skills skipped');

    if (opts['no-agents-md']) out.skip('AGENTS.md skipped (--no-agents-md)');
    else if (await ask('Add a short Levanto section to AGENTS.md (and CLAUDE.md)?')) ok = snippetStep(dir, out) && ok;
    else out.skip('AGENTS.md skipped');

    if (opts['no-test']) out.skip('Test decision skipped (--no-test)');
    else if (!key) out.skip('Test decision skipped: no key yet');
    else if (await ask('Make one test decision with your key?')) ok = (await testStep(key, out)) && ok;
    else out.skip('Test decision skipped');

    out.line('');
    if (ok) {
      out.line(out.bold('Levanto is set up.') + (key ? '' : ` Add ${ENV_NAME} to .env when you have a key.`));
    } else {
      out.line(out.bold('Set up with problems; see the ✗ lines above.'));
    }
    out.line('Next step. Ask your agent: "Find where Levanto fits in this project."');
    return ok ? 0 : 1;
  } catch (e) {
    out.fail(e instanceof UsageError ? e.message : `Unexpected error: ${e?.message ?? e}`);
    return 1;
  }
}
