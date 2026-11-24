import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs } from '../src/cli.js';
import { FAKE_KEY, tempDir } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/levanto.js', import.meta.url));

test('parseArgs: commands and flags', () => {
  assert.deepEqual(parseArgs(['init', '--yes', '--dir', 'x', '--agents=claude', '--no-test']), {
    command: 'init', yes: true, dir: 'x', agents: 'claude', 'no-test': true,
  });
  assert.deepEqual(parseArgs(['-y', 'skills']), { command: 'skills', yes: true });
  assert.throws(() => parseArgs(['init', '--bogus']), UsageError);
  assert.throws(() => parseArgs(['init', '--dir']), /needs a value/);
});

test('parseArgs: the key is never accepted on the command line', () => {
  assert.throws(() => parseArgs(['login', FAKE_KEY]), /shell history/);
  assert.throws(() => parseArgs(['login', `--key=${FAKE_KEY}`]), /on the command line/);
  assert.throws(() => parseArgs(['login', '--api-key', 'x']), /never goes on the command line/);
});

function fakeApi(t) {
  return new Promise((resolve) => {
    const calls = [];
    const s = createServer((req, res) => {
      calls.push({ url: req.url, auth: req.headers.authorization });
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: { answer: 'yes', probability: 0.991 } }));
      });
    });
    s.listen(0, '127.0.0.1', () => {
      t.after(() => s.close());
      resolve({ url: `http://127.0.0.1:${s.address().port}`, calls });
    });
  });
}

function cli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', LEVANTO_NO_BROWSER: '1', ...env }, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('e2e: init --yes with a key in the environment', async (t) => {
  const api = await fakeApi(t);
  const dir = tempDir(t);
  const r = await cli(['init', '--yes', '--dir', dir], { LEVANTO_API_KEY: FAKE_KEY, LEVANTO_BASE_URL: api.url });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  for (const p of [
    '.agents/skills/levanto-sage/SKILL.md',
    '.agents/skills/levanto-sage/references/batch.md',
    '.agents/skills/levanto-llms/SKILL.md',
    '.claude/skills/levanto-sage/SKILL.md',
    '.claude/skills/levanto-llms/references/suggest-only.md',
    'AGENTS.md',
  ]) assert.ok(existsSync(join(dir, p)), p);
  assert.ok(readFileSync(join(dir, 'AGENTS.md'), 'utf8').includes('<!-- levanto:start -->'));
  assert.equal(existsSync(join(dir, '.env')), false, 'a key from the environment is not copied to .env');
  assert.deepEqual(api.calls, [{ url: '/decide', auth: `Bearer ${FAKE_KEY}` }]);
  assert.match(r.stdout, /✓ Sage answered "yes" \(p=0\.99\) in \d+ ms/);
  assert.match(r.stdout, /Find where Levanto fits in this project/);
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_KEY), 'never prints the key');
  assert.ok(!/\x1b\[/.test(r.stdout), 'no colour with NO_COLOR / no TTY');
});

test('e2e: key from .env, Claude-only project, re-run is idempotent', async (t) => {
  const api = await fakeApi(t);
  const dir = tempDir(t);
  writeFileSync(join(dir, '.env'), `OTHER=1\nLEVANTO_API_KEY=${FAKE_KEY}\n`);
  writeFileSync(join(dir, 'CLAUDE.md'), '# Notes\n');
  const env = { LEVANTO_BASE_URL: api.url };
  const first = await cli(['init', '--yes', '--dir', dir], env);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  assert.ok(existsSync(join(dir, '.claude/skills/levanto-sage/SKILL.md')));
  assert.equal(existsSync(join(dir, '.agents')), false);
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), '.env\n');
  const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  const second = await cli(['init', '--yes', '--dir', dir], env);
  assert.equal(second.code, 0);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), claude);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), '.env\n');
  assert.match(second.stdout, /Updated skills in \.claude\/skills\//);
});

test('e2e: no key, no TTY: prints where to get one and still installs the rest', async (t) => {
  const dir = tempDir(t);
  const r = await cli(['init', '--yes', '--dir', dir, '--agents', 'codex'], { LEVANTO_AUTH_TIMEOUT_MS: '300' });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\/cli\/auth\?port=\d+&state=[\w-]{43}&name=/);
  assert.match(r.stdout, /https:\/\/platform\.levanto\.ai\/intelligence\/keys/);
  assert.match(r.stdout, /Test decision skipped: no key yet/);
  assert.ok(existsSync(join(dir, '.agents/skills/levanto-llms/SKILL.md')));
  assert.equal(existsSync(join(dir, '.claude')), false);
});

test('e2e: 401 from the API exits 1', async (t) => {
  const s = createServer((req, res) => {
    res.writeHead(401);
    res.end('{}');
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => s.close());
  const dir = tempDir(t);
  const r = await cli(['init', '--yes', '--dir', dir], { LEVANTO_API_KEY: FAKE_KEY, LEVANTO_BASE_URL: `http://127.0.0.1:${s.address().port}` });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /✗ The key was rejected \(401\)/);
});

test('e2e: login writes .env 0600 after a browser callback', async (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'sub'));
  const child = execFile(process.execPath, [BIN, 'login', '--dir', dir], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', LEVANTO_NO_BROWSER: '1', LEVANTO_AUTH_TIMEOUT_MS: '10000' },
  });
  let stdout = '';
  child.stdout.on('data', (c) => (stdout += c));
  const url = await new Promise((resolve) => {
    const iv = setInterval(() => {
      const m = stdout.match(/(https:\/\/platform\.levanto\.ai\/cli\/auth\?\S+)/);
      if (m) {
        clearInterval(iv);
        resolve(new URL(m[1]));
      }
    }, 20);
  });
  const port = url.searchParams.get('port');
  const res = await fetch(`http://127.0.0.1:${port}/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://platform.levanto.ai' },
    body: JSON.stringify({ state: url.searchParams.get('state'), key: FAKE_KEY }),
  });
  assert.equal(res.status, 200);
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0, stdout);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), `LEVANTO_API_KEY=${FAKE_KEY}\n`);
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
  assert.match(stdout, /✓ Key lv_live_…cdef saved to new \.env \(created \.gitignore with \.env\)/);
  assert.ok(!stdout.includes(FAKE_KEY));
});
