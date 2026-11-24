// The key step: find a key, or get one through the browser or a masked paste,
// and save it to <dir>/.env.
import { hostname } from 'node:os';
import { ensureGitignored, isEnvTracked, readEnvKey, writeEnvKey } from './env.js';
import { ENV_NAME, KEYS_URL, isValidKey, maskKey } from './key.js';
import { authUrl, newState, startAuthServer } from './auth-server.js';
import { openBrowser } from './browser.js';
import { readSecret, waitForEnter } from './prompt.js';

/** Short, printable host name for the key's label on the dashboard. */
export function shortHostName(raw = hostname()) {
  const name = String(raw).split('.')[0].replace(/[^\x20-\x7e]/g, '').trim().slice(0, 64);
  return name || 'this computer';
}

function gitignoreNote(status) {
  if (status === 'created') return ' (created .gitignore with .env)';
  if (status === 'appended') return ' (added .env to .gitignore)';
  return '';
}

function saveKey(dir, key, out) {
  const status = writeEnvKey(dir, key);
  const ignore = ensureGitignored(dir);
  const verb = status === 'created' ? 'saved to new' : status === 'updated' ? 'saved to' : 'already in';
  out.ok(`Key ${maskKey(key)} ${verb} .env${gitignoreNote(ignore)}`);
}

function trackedEnvWarning(out) {
  out.fail('.env is tracked by git, so a key written there would be committed. Not writing it.');
  out.note('Untrack it first:  git rm --cached .env && echo .env >> .gitignore');
  out.note(`Or set ${ENV_NAME} in your shell instead. Create a key at ${KEYS_URL}`);
}

async function browserSignIn({ out, env, interactive, timeoutMs }) {
  const state = newState();
  const ac = new AbortController();
  const server = await startAuthServer({ state, env, timeoutMs, signal: ac.signal });
  const url = authUrl({ port: server.port, state, name: shortHostName(), env });
  const opened = await openBrowser(url, { env });
  out.line(opened ? 'Opened your browser to create a key. If it did not open, visit:' : 'Open this link to create a key:');
  out.note(url);
  let enter;
  if (interactive) {
    out.note(`Waiting for the browser (up to ${Math.round(timeoutMs / 60000)} min). Press Enter to paste a key instead.`);
    enter = waitForEnter();
    enter.promise.then((pressed) => {
      if (pressed) ac.abort();
    });
  } else {
    out.note(`Waiting for the browser (up to ${Math.round(timeoutMs / 60000)} min).`);
  }
  try {
    return { key: await server.key };
  } catch (e) {
    return { key: null, reason: e.code };
  } finally {
    enter?.cancel();
  }
}

async function pasteKey(out) {
  out.line(`Create a key at ${KEYS_URL} and paste it here.`);
  for (let i = 0; i < 3; i++) {
    const v = (await readSecret(`${ENV_NAME}: `)).trim();
    if (!v) return null;
    if (isValidKey(v)) return v;
    out.fail('That is not a Levanto key (lv_live_ followed by 48 hex characters). Try again, or press Enter to skip.');
  }
  return null;
}

/**
 * Resolves the key. Returns { key, source, failed } where `failed` means the
 * step went wrong (not merely skipped).
 * Order: process env -> <dir>/.env -> browser sign-in -> masked paste (TTY only).
 */
export async function resolveKey({ dir, out, env = process.env, interactive, ask, timeoutMs }) {
  const fromEnv = env[ENV_NAME]?.trim();
  if (fromEnv) {
    if (isValidKey(fromEnv)) {
      out.ok(`Key ${maskKey(fromEnv)} found in your environment (${ENV_NAME})`);
      return { key: fromEnv, source: 'environment' };
    }
    out.fail(`${ENV_NAME} in your environment doesn't look like a Levanto key; ignoring it.`);
  }

  const tracked = isEnvTracked(dir);
  const fromFile = readEnvKey(dir);
  if (fromFile) {
    if (tracked) {
      out.fail(`.env holds ${ENV_NAME} and is tracked by git: the key may already be committed.`);
      out.note('Untrack it (git rm --cached .env), add .env to .gitignore, and rotate the key at');
      out.note(KEYS_URL);
      return { key: isValidKey(fromFile) ? fromFile : null, source: '.env', failed: true };
    }
    if (isValidKey(fromFile)) {
      const ignore = ensureGitignored(dir);
      out.ok(`Key ${maskKey(fromFile)} found in .env${gitignoreNote(ignore)}`);
      return { key: fromFile, source: '.env' };
    }
    out.fail(`${ENV_NAME} in .env doesn't look like a Levanto key; getting a new one.`);
  }

  if (tracked) {
    trackedEnvWarning(out);
    return { key: null, failed: true };
  }

  let key = null;
  const useBrowser = await ask('Sign in with your browser to create a key?');
  if (useBrowser) {
    const r = await browserSignIn({ out, env, interactive, timeoutMs });
    key = r.key;
    if (!key && r.reason === 'TIMEOUT') out.fail('No key arrived from the browser within the time limit.');
  }
  if (!key && interactive) key = await pasteKey(out);
  if (!key) {
    out.skip(`No key yet. Create one at ${KEYS_URL}`);
    out.note(`and add ${ENV_NAME}=<your key> to .env, then run: npx levanto login`);
    return { key: null, skipped: true };
  }
  saveKey(dir, key, out);
  return { key, source: 'new' };
}
