import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureGitignored, isEnvTracked, readEnvKey, writeEnvKey } from '../src/env.js';
import { resolveKey } from '../src/login.js';
import { FAKE_KEY, tempDir } from './helpers.js';

const OTHER = 'lv_live_' + 'f'.repeat(48);

test('creates .env with mode 0600', (t) => {
  const dir = tempDir(t);
  assert.equal(writeEnvKey(dir, FAKE_KEY), 'created');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), `LEVANTO_API_KEY=${FAKE_KEY}\n`);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
});

test('replaces the key in place, keeps other lines, drops duplicates', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, '.env'), `A=1\nLEVANTO_API_KEY=${OTHER}\n# note\nexport LEVANTO_API_KEY="${OTHER}"\nB=2\n`);
  assert.equal(writeEnvKey(dir, FAKE_KEY), 'updated');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), `A=1\nLEVANTO_API_KEY=${FAKE_KEY}\n# note\nB=2\n`);
  assert.equal(writeEnvKey(dir, FAKE_KEY), 'unchanged');
});

test('appends to an .env without the key, adding a newline when missing', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, '.env'), 'A=1');
  assert.equal(writeEnvKey(dir, FAKE_KEY), 'updated');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), `A=1\nLEVANTO_API_KEY=${FAKE_KEY}\n`);
});

test('reads plain, quoted and exported keys', (t) => {
  const dir = tempDir(t);
  assert.equal(readEnvKey(dir), null);
  writeFileSync(join(dir, '.env'), `X=1\nexport LEVANTO_API_KEY='${FAKE_KEY}'\n`);
  assert.equal(readEnvKey(dir), FAKE_KEY);
  writeFileSync(join(dir, '.env'), `LEVANTO_API_KEY=${FAKE_KEY} # mine\n`);
  assert.equal(readEnvKey(dir), FAKE_KEY);
});

test('.gitignore: created, appended once, recognised', (t) => {
  const dir = tempDir(t);
  assert.equal(ensureGitignored(dir), 'created');
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), '.env\n');
  assert.equal(ensureGitignored(dir), 'present');

  const dir2 = tempDir(t);
  writeFileSync(join(dir2, '.gitignore'), 'node_modules');
  assert.equal(ensureGitignored(dir2), 'appended');
  assert.equal(ensureGitignored(dir2), 'present');
  assert.equal(readFileSync(join(dir2, '.gitignore'), 'utf8'), 'node_modules\n.env\n');

  const dir3 = tempDir(t);
  writeFileSync(join(dir3, '.gitignore'), 'dist\n/.env*\n');
  assert.equal(ensureGitignored(dir3), 'present');
});

const hasGit = spawnSync('git', ['--version']).status === 0;

test('a tracked .env is detected and never written', { skip: !hasGit && 'git not installed' }, async (t) => {
  const dir = tempDir(t);
  spawnSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, '.env'), 'A=1\n');
  assert.equal(isEnvTracked(dir), false);
  spawnSync('git', ['-C', dir, 'add', '.env']);
  assert.equal(isEnvTracked(dir), true);

  const lines = [];
  const out = { ok: (s) => lines.push(`ok ${s}`), fail: (s) => lines.push(`fail ${s}`), skip: (s) => lines.push(`skip ${s}`), note: (s) => lines.push(`note ${s}`), line: (s) => lines.push(s) };
  let asked = false;
  const r = await resolveKey({ dir, out, env: {}, interactive: false, ask: async () => (asked = true), timeoutMs: 1000 });
  assert.equal(r.key, null);
  assert.equal(r.failed, true);
  assert.equal(asked, false, 'must not start the browser sign-in');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'A=1\n');
  assert.ok(lines.some((l) => l.startsWith('fail .env is tracked by git')));
});

test('a key from the environment is used, masked, and not written', async (t) => {
  const dir = tempDir(t);
  const lines = [];
  const out = { ok: (s) => lines.push(s), fail: (s) => lines.push(s), skip: (s) => lines.push(s), note: (s) => lines.push(s), line: (s) => lines.push(s) };
  const r = await resolveKey({ dir, out, env: { LEVANTO_API_KEY: FAKE_KEY }, interactive: false, ask: async () => true });
  assert.equal(r.key, FAKE_KEY);
  assert.equal(r.source, 'environment');
  assert.ok(lines.join('\n').includes('lv_live_…cdef'));
  assert.ok(!lines.join('\n').includes(FAKE_KEY));
  assert.equal(readEnvKey(dir), null);
});
