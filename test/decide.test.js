import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { TEST_BODY, describeDecision, testDecision } from '../src/decide.js';
import { FAKE_KEY } from './helpers.js';

function fakeApi(t, handler) {
  return new Promise((resolve) => {
    const seen = [];
    const s = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: JSON.parse(body || 'null') });
        handler(req, res);
      });
    });
    s.listen(0, '127.0.0.1', () => {
      t.after(() => {
        s.closeAllConnections();
        s.close();
      });
      resolve({ env: { LEVANTO_BASE_URL: `http://127.0.0.1:${s.address().port}/` }, seen });
    });
  });
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

test('posts the refund question with the bearer key and reads the answer', async (t) => {
  const api = await fakeApi(t, (req, res) => json(res, 200, { id: 'refund', kind: 'yesno', result: { answer: 'yes', probability: 0.994 } }));
  const r = await testDecision(FAKE_KEY, { env: api.env });
  assert.equal(r.ok, true);
  assert.equal(r.answer, 'yes');
  assert.equal(r.probability, 0.994);
  assert.deepEqual(api.seen[0], { method: 'POST', url: '/decide', auth: `Bearer ${FAKE_KEY}`, body: TEST_BODY });
  assert.match(describeDecision(r), /^Sage answered "yes" \(p=0\.99\) in \d+ ms$/);
});

test('null answer is described as not sure', () => {
  assert.equal(describeDecision({ answer: null, probability: 0.5, ms: 9 }), 'Sage answered null (not sure) (p=0.50) in 9 ms');
});

for (const [status, re] of [
  [401, /rejected \(401\)/],
  [402, /used up \(402\)/],
  [500, /HTTP 500/],
]) {
  test(`HTTP ${status} gives a clear message without the key`, async (t) => {
    const api = await fakeApi(t, (req, res) => json(res, status, { error: 'x' }));
    const r = await testDecision(FAKE_KEY, { env: api.env });
    assert.equal(r.ok, false);
    assert.match(r.message, re);
    assert.ok(!r.message.includes(FAKE_KEY));
  });
}

test('network error', async () => {
  const r = await testDecision(FAKE_KEY, { env: { LEVANTO_BASE_URL: 'http://127.0.0.1:1' }, retryDelayMs: 1 });
  assert.equal(r.ok, false);
  assert.match(r.message, /Could not reach/);
});

test('a connection reset is retried once', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return new Response(JSON.stringify({ result: { answer: 'yes', probability: 0.9 } }), { status: 200 });
  };
  const r = await testDecision(FAKE_KEY, { fetchImpl, retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.equal(r.ok, true);
  assert.equal(r.answer, 'yes');
});

test('two connection errors give up after the retry', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  };
  const r = await testDecision(FAKE_KEY, { fetchImpl, retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.match(r.message, /ECONNRESET/);
});

test('timeout', async (t) => {
  const api = await fakeApi(t, () => {});
  const r = await testDecision(FAKE_KEY, { env: api.env, timeoutMs: 100 });
  assert.equal(r.ok, false);
  assert.match(r.message, /No answer/);
});
