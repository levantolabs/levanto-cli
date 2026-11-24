// Reading and writing LEVANTO_API_KEY in <dir>/.env, and keeping .env out of git.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV_NAME } from './key.js';

const LINE = new RegExp(`^\\s*(?:export\\s+)?${ENV_NAME}\\s*=(.*)$`);

function unquote(v) {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1);
  return t.replace(/\s+#.*$/, '');
}

/** The key in <dir>/.env, or null. */
export function readEnvKey(dir) {
  const path = join(dir, '.env');
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m) {
      const v = unquote(m[1]);
      if (v) return v;
    }
  }
  return null;
}

function git(dir, args) {
  try {
    const r = spawnSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    return r.status;
  } catch {
    return null;
  }
}

/** True when <dir>/.env is tracked by git (so a key written there would be committed). */
export function isEnvTracked(dir) {
  return git(dir, ['ls-files', '--error-unmatch', '.env']) === 0;
}

/** Sets LEVANTO_API_KEY in <dir>/.env: replaces the existing line (dropping
 *  duplicates), keeps every other line, creates the file with mode 0600.
 *  Returns 'created' | 'updated' | 'unchanged'. */
export function writeEnvKey(dir, key) {
  const path = join(dir, '.env');
  const entry = `${ENV_NAME}=${key}`;
  if (!existsSync(path)) {
    writeFileSync(path, `${entry}\n`, { mode: 0o600 });
    return 'created';
  }
  const text = readFileSync(path, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const endsWithNewline = text.length === 0 || /\r?\n$/.test(text);
  if (endsWithNewline) lines.pop();
  let found = false;
  let changed = false;
  const next = [];
  for (const line of lines) {
    if (LINE.test(line)) {
      if (found) {
        changed = true;
        continue;
      }
      found = true;
      if (line !== entry) changed = true;
      next.push(entry);
    } else {
      next.push(line);
    }
  }
  if (!found) {
    next.push(entry);
    changed = true;
  }
  if (!changed) return 'unchanged';
  writeFileSync(path, next.join(eol) + eol);
  return 'updated';
}

const IGNORE_LINES = new Set(['.env', '/.env', '.env*', '/.env*', '*.env', '**/.env']);

/** Makes sure <dir>/.gitignore lists .env (a global excludes file doesn't
 *  protect teammates' clones). Returns 'present' | 'created' | 'appended'. */
export function ensureGitignored(dir) {
  const path = join(dir, '.gitignore');
  if (!existsSync(path)) {
    writeFileSync(path, '.env\n');
    return 'created';
  }
  const text = readFileSync(path, 'utf8');
  const has = text.split(/\r?\n/).some((l) => IGNORE_LINES.has(l.trim()));
  if (has) return 'present';
  const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  writeFileSync(path, `${text}${sep}.env\n`);
  return 'appended';
}
