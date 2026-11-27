import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handleMessage, PROTOCOL_VERSIONS } from '../src/mcp.js';
import { FAKE_KEY, tempDir } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/levanto.js', import.meta.url));

function mockFetch(...replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = replies.length > 1 ? replies.shift() : replies[0];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
  return { fetchImpl, calls };
}

const ctx = (fetchImpl, env = { LEVANTO_API_KEY: FAKE_KEY }, cwd = '/nonexistent') => ({ env, cwd, version: '9.9.9', fetchImpl, retryDelayMs: 1 });
const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('initialize negotiates the protocol version and lists two tools', async () => {
  const init = await handleMessage({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } }, ctx());
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.version, '9.9.9');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  const newer = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, ctx());
  assert.equal(newer.result.protocolVersion, PROTOCOL_VERSIONS[0]);

  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx());
  assert.deepEqual(list.result.tools.map((t) => t.name), ['decide', 'extract']);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');

  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx()), null);
  assert.deepEqual((await handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' }, ctx())).result, {});
  assert.equal((await handleMessage({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, ctx())).error.code, -32601);
  assert.equal((await handleMessage(call('nope', {}), ctx())).error.code, -32602);
});

test('decide maps a yes/no question and returns the result', async () => {
  const { fetchImpl, calls } = mockFetch({ body: { id: 'yesno', kind: 'yesno', result: { answer: 'yes', probability: 0.99 }, meta: {} } });
  const r = await handleMessage(call('decide', { kind: 'yesno', instructions: 'Refund?', content: 'Refund me', reasoning: 'auto' }), ctx(fetchImpl));
  assert.equal(calls[0].url, 'https://api.levanto.ai/decide');
  assert.equal(calls[0].headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.match(calls[0].headers['User-Agent'], /^levanto-mcp\/9\.9\.9$/);
  assert.deepEqual(calls[0].body, { content: 'Refund me', question: { id: 'yesno', kind: 'yesno', instructions: 'Refund?' }, reasoning: 'auto' });
  assert.deepEqual(r.result.structuredContent, { answer: 'yes', probability: 0.99 });
  assert.deepEqual(JSON.parse(r.result.content[0].text), { answer: 'yes', probability: 0.99 });
  assert.equal(r.result.isError, undefined);
});

test('decide reads files: text after content, images as a data URI', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'policy.txt'), 'Refunds within 30 days.');
  writeFileSync(join(dir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 0, 2]));
  const { fetchImpl, calls } = mockFetch({ body: { result: { answer: 'no', probability: 0.1 } } });
  await handleMessage(call('decide', { kind: 'yesno', instructions: 'OK?', content: 'Bought 41 days ago.', file: join(dir, 'policy.txt') }), ctx(fetchImpl));
  assert.equal(calls[0].body.content, 'Bought 41 days ago.\n\nRefunds within 30 days.');
  await handleMessage(call('decide', { kind: 'yesno', instructions: 'Bug shown?', content: 'Checkout button missing', file: join(dir, 'shot.png') }), ctx(fetchImpl));
  assert.deepEqual(calls[1].body.content, { kind: 'image', media: 'data:image/png;base64,iVBORw==', text: 'Checkout button missing' });

  const bin = await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', file: join(dir, 'blob.bin') }), ctx(fetchImpl));
  assert.match(bin.result.content[0].text, /isn't a text file/);
  const missing = await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', file: join(dir, 'nope.txt') }), ctx(fetchImpl));
  assert.match(missing.result.content[0].text, /File not found/);
  const imageExtract = await handleMessage(call('extract', { fields: { a: '' }, file: join(dir, 'shot.png') }), ctx(fetchImpl));
  assert.match(imageExtract.result.content[0].text, /extract reads text only/);
  assert.equal(calls.length, 2);
});

test('decide builds choice, sort and web search requests, and returns web sources', async () => {
  const { fetchImpl, calls } = mockFetch({
    body: { result: { chosen: 'billing' }, grounding_meta: { triggered: true, sources: [{ url: 'https://x.test', title: 'X', snippet: 'long' }] } },
  });
  const options = [{ option: 'billing', description: 'Charges' }, { option: 'tech', description: 'Bugs' }];
  const r = await handleMessage(call('decide', { kind: 'choice', instructions: 'Team?', content: 'Charged twice', options, web_search: true }), ctx(fetchImpl));
  assert.deepEqual(calls[0].body.question.options, options);
  assert.deepEqual(calls[0].body.grounding, { trigger: 'low_confidence' });
  assert.deepEqual(r.result.structuredContent, { chosen: 'billing', web_sources: [{ title: 'X', url: 'https://x.test' }] });

  const items = [{ id: 'a', content: 'typo' }, { id: 'b', content: 'db down' }];
  await handleMessage(call('decide', { kind: 'sort', instructions: 'Most urgent first', items }), ctx(fetchImpl));
  assert.deepEqual(calls[1].body.content, { kind: 'list', value: items });

  for (const [args, re] of [
    [{ kind: 'choice', instructions: 'x', content: 'y' }, /choice needs options/],
    [{ kind: 'sort', instructions: 'x', items: [items[0]] }, /at least 2 items/],
    [{ kind: 'maybe', instructions: 'x', content: 'y' }, /kind must be one of/],
    [{ kind: 'yesno', instructions: 'x' }, /Give content or file/],
  ]) {
    const e = await handleMessage(call('decide', args), ctx(fetchImpl));
    assert.equal(e.result.isError, true);
    assert.match(e.result.content[0].text, re);
  }
  assert.equal(calls.length, 2);
});

test('extract returns values and per-field sources', async () => {
  const { fetchImpl, calls } = mockFetch({
    body: {
      values: { total: { amount: 540, currency: 'EUR' }, products: ['Service', 'Kit'], po: null },
      results: {
        total: { value: { amount: 540, currency: 'EUR' }, text: '540.00 EUR', start: 1, end: 2, probability: 0.99, probabilities: [] },
        products: { values: [{ value: 'Service', text: 'Service', probability: 0.92 }, { value: 'Kit', text: 'Kit', probability: 0.91 }] },
        po: { value: null, text: null, probability: 1 },
      },
      meta: {},
    },
  });
  const fields = { total: { type: 'money' }, products: ['a product billed'], po: 'purchase order number' };
  const r = await handleMessage(call('extract', { content: 'INVOICE ...', fields }), ctx(fetchImpl));
  assert.equal(calls[0].url, 'https://api.levanto.ai/v1/extract');
  assert.deepEqual(calls[0].body, { content: 'INVOICE ...', extract: fields });
  assert.deepEqual(r.result.structuredContent, {
    values: { total: { amount: 540, currency: 'EUR' }, products: ['Service', 'Kit'], po: null },
    sources: {
      total: { text: '540.00 EUR', probability: 0.99 },
      products: [{ text: 'Service', probability: 0.92 }, { text: 'Kit', probability: 0.91 }],
      po: null,
    },
  });
  const empty = await handleMessage(call('extract', { content: 'x', fields: {} }), ctx(fetchImpl));
  assert.match(empty.result.content[0].text, /fields must map/);
});

test('retries 503 and dropped connections, not 400; explains 401 and 402', async () => {
  let m = mockFetch({ status: 503, body: { detail: 'busy' } }, new TypeError('fetch failed'), { body: { result: { answer: 'yes' } } });
  let r = await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', content: 'y' }), ctx(m.fetchImpl));
  assert.equal(m.calls.length, 3);
  assert.deepEqual(r.result.structuredContent, { answer: 'yes' });

  m = mockFetch({ status: 400, body: { detail: [{ msg: 'levels must be distinct' }] } });
  r = await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', content: 'y' }), ctx(m.fetchImpl));
  assert.equal(m.calls.length, 1);
  assert.equal(r.result.isError, true);
  assert.equal(r.result.content[0].text, 'Sage returned 400: levels must be distinct');

  m = mockFetch({ status: 401, body: {} });
  r = await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', content: 'y' }), ctx(m.fetchImpl));
  assert.match(r.result.content[0].text, /key was rejected/);
  assert.ok(!r.result.content[0].text.includes(FAKE_KEY));
  m = mockFetch({ status: 402, body: {} });
  r = await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', content: 'y' }), ctx(m.fetchImpl));
  assert.match(r.result.content[0].text, /usage is used up/);
});

test('reads the key from the environment, then <cwd>/.env, and explains a missing one', async (t) => {
  const dir = tempDir(t);
  const m = mockFetch({ body: { result: { answer: 'yes' } } });
  const none = await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', content: 'y' }), ctx(m.fetchImpl, {}, dir));
  assert.equal(none.result.isError, true);
  assert.match(none.result.content[0].text, /No Levanto key\. Set LEVANTO_API_KEY/);
  writeFileSync(join(dir, '.env'), `LEVANTO_API_KEY=${FAKE_KEY}\n`);
  await handleMessage(call('decide', { kind: 'yesno', instructions: 'x', content: 'y' }), ctx(m.fetchImpl, { LEVANTO_BASE_URL: 'http://127.0.0.1:1/' }, dir));
  assert.equal(m.calls[0].url, 'http://127.0.0.1:1/decide');
  assert.equal(m.calls[0].headers.Authorization, `Bearer ${FAKE_KEY}`);
});

test('a cancelled call gets no response', async () => {
  const inflight = new Map();
  const fetchImpl = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const p = handleMessage(call('decide', { kind: 'yesno', instructions: 'x', content: 'y' }, 7), ctx(fetchImpl), inflight);
  await new Promise((r) => setImmediate(r));
  assert.ok(inflight.has(7));
  await handleMessage({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } }, ctx(), inflight);
  assert.equal(await p, null);
  assert.equal(inflight.size, 0);
});

test('`levanto mcp` speaks newline-delimited JSON-RPC on stdio and prints nothing else', async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ path: req.url, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'yesno', kind: 'yesno', result: { answer: 'yes', probability: 0.97 }, meta: {} }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const dir = tempDir(t);
  const child = spawn(process.execPath, [BIN, 'mcp'], {
    cwd: dir,
    env: { PATH: process.env.PATH, LEVANTO_API_KEY: FAKE_KEY, LEVANTO_BASE_URL: `http://127.0.0.1:${server.address().port}` },
  });
  let stdout = '';
  child.stdout.on('data', (c) => (stdout += c));
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    call('decide', { kind: 'yesno', instructions: 'Refund?', content: 'Refund me' }, 3),
  ];
  child.stdin.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0);
  const out = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(out.map((m) => m.id).sort(), [1, 2, 3]);
  assert.equal(out.find((m) => m.id === 3).result.structuredContent.answer, 'yes');
  assert.equal(seen[0].path, '/decide');
});
