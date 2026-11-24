import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedOrigins, authUrl, dashboardUrl, newState, safeEqual, startAuthServer } from '../src/auth-server.js';
import { shortHostName } from '../src/login.js';
import { FAKE_KEY, http } from './helpers.js';

const ORIGIN = 'https://platform.levanto.ai';

async function server(t, opts = {}) {
  const state = newState();
  const s = await startAuthServer({ state, env: {}, timeoutMs: 5000, ...opts });
  t.after(() => s.close());
  return { ...s, state };
}

const post = (port, origin, body) =>
  http(port, { headers: { Origin: origin, 'Content-Type': 'application/json', Host: `127.0.0.1:${port}` }, body });

test('state is 32 random bytes, base64url', () => {
  const s = newState();
  assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(s, newState());
});

test('safeEqual', () => {
  assert.ok(safeEqual('abc', 'abc'));
  assert.ok(!safeEqual('abc', 'abd'));
  assert.ok(!safeEqual('abc', 'abcd'));
  assert.ok(!safeEqual(undefined, 'abc'));
});

test('dashboard URL and allowed origins honour LEVANTO_DASHBOARD_URL', () => {
  assert.equal(dashboardUrl({}), ORIGIN);
  assert.deepEqual(allowedOrigins({}), [ORIGIN]);
  const env = { LEVANTO_DASHBOARD_URL: 'http://localhost:3000/' };
  assert.equal(dashboardUrl(env), 'http://localhost:3000');
  assert.deepEqual(allowedOrigins(env), [ORIGIN, 'http://localhost:3000']);
  assert.equal(dashboardUrl({ LEVANTO_DASHBOARD_URL: 'javascript:alert(1)' }), ORIGIN);
  const url = new URL(authUrl({ port: 4321, state: 'st', name: 'my mac', env: {} }));
  assert.equal(url.origin + url.pathname, `${ORIGIN}/cli/auth`);
  assert.equal(url.searchParams.get('port'), '4321');
  assert.equal(url.searchParams.get('name'), 'my mac');
});

test('host name is short and printable', () => {
  assert.equal(shortHostName('marcos-mbp.local'), 'marcos-mbp');
  assert.equal(shortHostName('\u0001'), 'this computer');
  assert.equal(shortHostName('x'.repeat(100)).length, 64);
});

test('preflight answers with the CORS and Private Network headers', async (t) => {
  const s = await server(t);
  const r = await http(s.port, {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(r.headers['access-control-allow-methods'], 'POST');
  assert.equal(r.headers['access-control-allow-headers'], 'Content-Type');
  assert.equal(r.headers['access-control-allow-private-network'], 'true');
});

test('the server listens on 127.0.0.1 only', async (t) => {
  const s = await server(t);
  assert.ok(s.port > 0);
});

test('wrong origin is rejected', async (t) => {
  const s = await server(t);
  const r = await post(s.port, 'https://evil.example', { state: s.state, key: FAKE_KEY });
  assert.equal(r.status, 403);
  assert.notEqual(r.headers['access-control-allow-origin'], 'https://evil.example');
  const none = await http(s.port, { headers: { 'Content-Type': 'application/json' }, body: { state: s.state, key: FAKE_KEY } });
  assert.equal(none.status, 403);
});

test('localhost:3000 is only allowed when LEVANTO_DASHBOARD_URL points there', async (t) => {
  const s = await server(t);
  assert.equal((await post(s.port, 'http://localhost:3000', { state: s.state, key: FAKE_KEY })).status, 403);
  const s2 = await server(t, { env: { LEVANTO_DASHBOARD_URL: 'http://localhost:3000' } });
  const r = await post(s2.port, 'http://localhost:3000', { state: s2.state, key: FAKE_KEY });
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.equal(await s2.key, FAKE_KEY);
});

test('wrong state is rejected and the server keeps waiting', async (t) => {
  const s = await server(t);
  assert.equal((await post(s.port, ORIGIN, { state: newState(), key: FAKE_KEY })).status, 403);
  assert.equal((await post(s.port, ORIGIN, { key: FAKE_KEY })).status, 403);
  assert.equal((await post(s.port, ORIGIN, { state: s.state, key: FAKE_KEY })).status, 200);
  assert.equal(await s.key, FAKE_KEY);
});

test('bad key format is rejected', async (t) => {
  const s = await server(t);
  for (const key of ['lv_live_short', FAKE_KEY.toUpperCase(), 42, `${FAKE_KEY}\n`]) {
    assert.equal((await post(s.port, ORIGIN, { state: s.state, key })).status, 400);
  }
  assert.equal((await post(s.port, ORIGIN, 'not json')).status, 400);
});

test('wrong Host header (DNS rebinding) is rejected', async (t) => {
  const s = await server(t);
  const r = await http(s.port, { headers: { Origin: ORIGIN, Host: 'evil.example' }, body: { state: s.state, key: FAKE_KEY } });
  assert.equal(r.status, 421);
});

test('good callback answers {ok:true}, resolves the key and closes', async (t) => {
  const s = await server(t);
  const r = await post(s.port, ORIGIN, { state: s.state, key: FAKE_KEY });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true });
  assert.equal(r.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(await s.key, FAKE_KEY);
  await assert.rejects(post(s.port, ORIGIN, { state: s.state, key: FAKE_KEY }), /ECONNREFUSED|ECONNRESET|socket hang up/);
});

test('times out with code TIMEOUT', async (t) => {
  const s = await server(t, { timeoutMs: 50 });
  await assert.rejects(s.key, (e) => e.code === 'TIMEOUT');
});

test('abort signal cancels', async (t) => {
  const ac = new AbortController();
  const s = await server(t, { signal: ac.signal });
  ac.abort();
  await assert.rejects(s.key, (e) => e.code === 'CANCELLED');
});
