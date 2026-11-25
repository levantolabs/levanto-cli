// One test decision, to prove the key works end to end.

export const DEFAULT_BASE_URL = 'https://api.levanto.ai';
export const TEST_TIMEOUT_MS = 15_000;

export const TEST_BODY = {
  content: 'I was charged twice, please refund one of them.',
  question: { id: 'refund', kind: 'yesno', instructions: 'Is the customer asking for money back?' },
};

export function baseUrl(env = process.env) {
  return (env.LEVANTO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * Returns { ok: true, answer, probability, ms } or { ok: false, message }.
 * Never includes the key in a message.
 */
export async function testDecision(key, { env = process.env, timeoutMs = TEST_TIMEOUT_MS, retryDelayMs = 500, fetchImpl = globalThis.fetch } = {}) {
  const url = `${baseUrl(env)}/decide`;
  const started = performance.now();
  const send = () =>
    fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'levanto-cli' },
      body: JSON.stringify(TEST_BODY),
      signal: AbortSignal.timeout(timeoutMs),
    });
  let res;
  // A connection error (reset, DNS hiccup) gets one retry; a timeout does not.
  for (let attempt = 1; ; attempt++) {
    try {
      res = await send();
      break;
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        return { ok: false, message: `No answer from ${url} within ${Math.round(timeoutMs / 1000)} s.` };
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      const cause = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? 'network error';
      return { ok: false, message: `Could not reach ${url} (${cause}).` };
    }
  }
  const ms = Math.round(performance.now() - started);
  if (res.status === 401) return { ok: false, status: 401, message: 'The key was rejected (401). Check LEVANTO_API_KEY, or run `npx levanto login`.' };
  if (res.status === 402) return { ok: false, status: 402, message: "This plan's usage is used up (402). Upgrade or wait for the next period: https://platform.levanto.ai/billing" };
  if (!res.ok) return { ok: false, status: res.status, message: `The test decision failed (HTTP ${res.status}).` };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: 'The test decision returned an unreadable answer.' };
  }
  const result = body?.result ?? {};
  return { ok: true, answer: result.answer ?? null, probability: typeof result.probability === 'number' ? result.probability : null, ms };
}

export function describeDecision(r) {
  const answer = r.answer === null ? 'null (not sure)' : `"${r.answer}"`;
  const p = r.probability === null ? '' : ` (p=${r.probability.toFixed(2)})`;
  return `Sage answered ${answer}${p} in ${r.ms} ms`;
}
