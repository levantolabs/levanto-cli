// `levanto mcp`: a Model Context Protocol server over stdio with two tools,
// decide and extract, that call Sage. Newline-delimited JSON-RPC 2.0 on
// stdin/stdout; nothing else may be written to stdout. No dependencies.
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { baseUrl } from './decide.js';
import { readEnvKey } from './env.js';
import { ENV_NAME } from './key.js';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXT_FILE = 2 * 1024 * 1024;
const MAX_IMAGE_FILE = 4 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const RETRY_STATUS = new Set([429, 502, 503]);

const INSTRUCTIONS = `Sage answers a question about content with a typed result instead of text, in well under a second.
Use decide for a judgment (yes/no, one option, a score, an order, labels), decide_batch for many at once, and extract for values in a document.
null means Sage isn't sure: treat it as "ask a person" or a safe default, never as "no".
Pass long documents as file (a path) instead of pasting them into content.`;

const KINDS = ['yesno', 'choice', 'scale', 'sort', 'tags'];

export const TOOLS = [
  {
    name: 'decide',
    title: 'Decide with Sage',
    description: `Answer a question about content with a typed decision. kind:
- yesno: answer "yes", "no" or null, and probability (P(yes)).
- choice: one of options (2-120, each with a one-line description); chosen is null when too close to call.
- scale: levels (2-26 whole numbers, each described); returns expectation (fractional level) and confidence.
- sort: items to order best first by the instructions; returns sorted item ids.
- tags: which tags apply (1-120); each tag's applies is true, false or null.
Put the rule in instructions and the facts in content (or file). null means not sure: never read it as "no".`,
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS, description: 'The type of decision.' },
        instructions: { type: 'string', description: 'The question or rule, as you would brief a careful colleague.' },
        content: { type: 'string', description: 'The text to judge. With an image file, the context to judge it with.' },
        file: {
          type: 'string',
          description: 'Path to a local text file or a PNG, JPEG or WebP image to judge. Text is added after content.',
        },
        options: {
          type: 'array',
          description: 'choice only.',
          items: {
            type: 'object',
            properties: { option: { type: 'string' }, description: { type: 'string' } },
            required: ['option', 'description'],
          },
        },
        levels: {
          type: 'array',
          description: 'scale only. Distinct whole numbers, e.g. 1 to 5.',
          items: {
            type: 'object',
            properties: { level: { type: 'integer' }, description: { type: 'string' } },
            required: ['level', 'description'],
          },
        },
        tags: {
          type: 'array',
          description: 'tags only. name is the label plus one line of meaning.',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        },
        items: {
          type: 'array',
          description: 'sort only: the things to order (2-120).',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, content: { type: 'string' } },
            required: ['id', 'content'],
          },
        },
        reasoning: {
          type: 'string',
          enum: ['off', 'auto', 'on'],
          description: 'off (default) answers at once. auto thinks first when the rule is long or multi-step; on always thinks.',
        },
        web_search: {
          type: 'boolean',
          description: "Search the web before deciding, for factual or recent questions the content doesn't settle. Not with images. Each search is charged.",
        },
      },
      required: ['kind', 'instructions'],
    },
    annotations: { title: 'Decide with Sage', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'extract',
    title: 'Extract with Sage',
    description: `Pull typed values out of a document. fields maps each name to:
- a description string ("" if the name says it all),
- {"type", "definition"} with type text (default), integer, decimal, money, date, time or duration,
- or a one-item list of either, for every mention (["a product billed"]).
Returns values (null when the document doesn't state it or Sage isn't sure) and, per field, the source text and probability.
Values come only from what the text states: extract the parts and compute in code.`,
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The document text.' },
        file: { type: 'string', description: 'Path to a local text file to read instead of, or after, content.' },
        fields: {
          type: 'object',
          description: 'Field name → description, {type, definition}, or a one-item list for every mention. Up to 64.',
          additionalProperties: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['text', 'integer', 'decimal', 'money', 'date', 'time', 'duration'] },
                  definition: { type: 'string' },
                },
              },
              { type: 'array', maxItems: 1 },
            ],
          },
        },
      },
      required: ['fields'],
    },
    annotations: { title: 'Extract with Sage', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
];

// decide_batch: several documents, each with its own questions, in one call. Its
// questions take the same fields as decide (sort excluded), so the schema is shared.
{
  const d = TOOLS[0].inputSchema.properties;
  TOOLS.splice(1, 0, {
    name: 'decide_batch',
    title: 'Decide with Sage, in batch',
    description: `Several decisions in one call: a list of documents, each with one or more questions about it.
Use it instead of many decide calls, e.g. the same question over many items, or several questions about one document.
Each question takes the same fields as decide (kind yesno, choice, scale or tags; sort isn't batched) plus an optional id.
Returns, per document in order, each question's answer as decide returns it, or its error. null means not sure.`,
    inputSchema: {
      type: 'object',
      properties: {
        documents: {
          type: 'array',
          description: 'The documents, each with content or file, and its questions.',
          items: {
            type: 'object',
            properties: {
              content: d.content,
              file: d.file,
              questions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Your name for the answer. Defaults to q1, q2...' },
                    kind: { type: 'string', enum: ['yesno', 'choice', 'scale', 'tags'] },
                    instructions: d.instructions,
                    options: d.options,
                    levels: d.levels,
                    tags: d.tags,
                    web_search: d.web_search,
                  },
                  required: ['kind', 'instructions'],
                },
              },
            },
            required: ['questions'],
          },
        },
        reasoning: d.reasoning,
      },
      required: ['documents'],
    },
    annotations: { title: 'Decide with Sage, in batch', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  });
}

class ToolError extends Error {}

function readText(path) {
  const size = statSync(path).size;
  if (size > MAX_TEXT_FILE) throw new ToolError(`${path} is ${Math.round(size / 1024)} KB; Sage reads up to about 16k tokens, so pass the part that matters.`);
  const buf = readFileSync(path);
  if (buf.includes(0)) throw new ToolError(`${path} isn't a text file. Images must be PNG, JPEG or WebP.`);
  return buf.toString('utf8');
}

/** The request `content`: text, or an image with its context. */
export function buildContent(args, { allowImage }) {
  const text = typeof args.content === 'string' ? args.content : '';
  if (!args.file) {
    if (!text.trim()) throw new ToolError('Give content or file.');
    return text;
  }
  const path = resolve(String(args.file));
  let type;
  try {
    statSync(path);
    type = IMAGE_TYPES[extname(path).toLowerCase()];
  } catch {
    throw new ToolError(`File not found: ${path}`);
  }
  if (type) {
    if (!allowImage) throw new ToolError('extract reads text only. For an image, use decide.');
    const size = statSync(path).size;
    if (size > MAX_IMAGE_FILE) throw new ToolError(`${path} is over 4 MB; images can be up to 4 MiB.`);
    const media = `data:${type};base64,${readFileSync(path).toString('base64')}`;
    return text.trim() ? { kind: 'image', media, text } : { kind: 'image', media };
  }
  const fileText = readText(path);
  return text.trim() ? `${text}\n\n${fileText}` : fileText;
}

/** One question from tool arguments. `where` prefixes error messages in a batch. */
function buildQuestion(q, id, where = '') {
  if (!KINDS.includes(q?.kind)) throw new ToolError(`${where}kind must be one of ${KINDS.join(', ')}.`);
  if (typeof q.instructions !== 'string' || !q.instructions.trim()) throw new ToolError(`${where}instructions is required.`);
  const question = { id, kind: q.kind, instructions: q.instructions };
  const need = { choice: 'options', scale: 'levels', tags: 'tags' }[q.kind];
  if (need) {
    if (!Array.isArray(q[need]) || !q[need].length) throw new ToolError(`${where}${q.kind} needs ${need}.`);
    question[need] = q[need];
  }
  return question;
}

const isImage = (content) => typeof content === 'object' && content?.kind === 'image';

export function decideRequest(args) {
  const question = buildQuestion(args, args?.kind);
  let content;
  if (args.kind === 'sort') {
    if (!Array.isArray(args.items) || args.items.length < 2) throw new ToolError('sort needs at least 2 items.');
    content = { kind: 'list', value: args.items };
  } else {
    content = buildContent(args, { allowImage: true });
  }
  const body = { content, question };
  if (args.reasoning && args.reasoning !== 'off') body.reasoning = args.reasoning;
  if (args.web_search) {
    if (isImage(content)) throw new ToolError("web_search doesn't work with images.");
    body.grounding = { trigger: 'always' };
  }
  return body;
}

export function decideBatchRequest(args) {
  const groups = args?.documents;
  if (!Array.isArray(groups) || !groups.length) throw new ToolError('documents must list at least one document with its questions.');
  const requests = groups.map((g, i) => {
    const at = `documents[${i}]`;
    if (!Array.isArray(g?.questions) || !g.questions.length) throw new ToolError(`${at} needs questions.`);
    let content;
    try {
      content = buildContent(g, { allowImage: true });
    } catch (e) {
      throw e instanceof ToolError ? new ToolError(`${at}: ${e.message}`) : e;
    }
    const ids = new Set();
    const questions = g.questions.map((q, j) => {
      const where = `${at}.questions[${j}]: `;
      if (q?.kind === 'sort') throw new ToolError(`${where}sort isn't batched; use decide.`);
      const id = typeof q?.id === 'string' && q.id.trim() ? q.id : `q${j + 1}`;
      if (ids.has(id)) throw new ToolError(`${where}id "${id}" is used twice in this document.`);
      ids.add(id);
      const question = buildQuestion(q, id, where);
      if (q.web_search) {
        if (isImage(content)) throw new ToolError(`${where}web_search doesn't work with images.`);
        question.grounding = { trigger: 'always' };
      }
      return question;
    });
    return { content, questions };
  });
  const body = { requests };
  if (args.reasoning && args.reasoning !== 'off') body.reasoning = args.reasoning;
  return body;
}

export function extractRequest(args) {
  const fields = args.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length) {
    throw new ToolError('fields must map at least one field name to a description.');
  }
  return { content: buildContent(args, { allowImage: false }), extract: fields };
}

/** What the agent gets back from decide: the result, plus web sources if Sage searched. */
export function decideResult(body) {
  const out = { ...(body?.result ?? {}) };
  const sources = body?.grounding_meta?.sources;
  if (body?.grounding_meta?.triggered && Array.isArray(sources) && sources.length) {
    out.web_sources = sources.map((s) => ({ title: s.title, url: s.url }));
  }
  return out;
}

/** decide_batch results: per document, each question's answer (as decide returns it) or its error. */
export function decideBatchResult(body, request) {
  return {
    documents: (body?.results ?? []).map((group, i) => ({
      answers: (group?.answers ?? []).map((a, j) => {
        const id = request?.requests?.[i]?.questions?.[j]?.id ?? a?.result?.id;
        return a?.ok ? { id, ...decideResult(a.result) } : { id, error: a?.error ?? 'failed' };
      }),
    })),
  };
}

const evidence = (r) => (r?.value === null || r?.value === undefined ? null : { text: r.text, probability: r.probability });

/** What the agent gets back from extract: values, and per field the source text and probability. */
export function extractResult(body) {
  const sources = {};
  for (const [name, r] of Object.entries(body?.results ?? {})) {
    sources[name] = Array.isArray(r?.values) ? r.values.map(evidence) : evidence(r);
  }
  return { values: body?.values ?? {}, sources };
}

function apiError(status, body, text) {
  if (status === 401) return `The key was rejected (401). Check ${ENV_NAME} in this server's environment.`;
  if (status === 402) return "This plan's usage is used up (402). Upgrade or wait for the next period: https://platform.levanto.ai/billing";
  let detail = body?.detail ?? body?.message ?? body?.error?.message ?? body?.error;
  if (Array.isArray(detail)) detail = detail.map((d) => d?.msg ?? JSON.stringify(d)).join('; ');
  if (typeof detail !== 'string') detail = text?.slice(0, 300) || 'no details';
  return `Sage returned ${status}: ${detail}`;
}

const sleep = (ms, signal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), rej(signal.reason)), { once: true });
  });

/** A signal that aborts on `signal` or after `ms` (AbortSignal.any is Node 20.3+). */
function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (AbortSignal.any) return AbortSignal.any([signal, timeout]);
  const c = new AbortController();
  const abort = (s) => () => c.abort(s.reason);
  signal.addEventListener('abort', abort(signal), { once: true });
  timeout.addEventListener('abort', abort(timeout), { once: true });
  return c.signal;
}

/** POST to Sage with retries on 429/502/503 and dropped connections, never on timeouts. */
export async function callSage(path, payload, { key, env, fetchImpl, signal, timeoutMs, version, retryDelayMs = 500 }) {
  const url = `${baseUrl(env)}${path}`;
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= 2;
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': `levanto-mcp/${version}` },
        body: JSON.stringify(payload),
        signal: withTimeout(signal, timeoutMs),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ToolError(`No answer from Sage within ${Math.round(timeoutMs / 1000)} s.`);
      if (last) throw new ToolError(`Could not reach ${url} (${e?.cause?.code ?? e?.message ?? 'network error'}).`);
      await sleep(retryDelayMs * 2 ** attempt, signal);
      continue;
    }
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}
    if (res.ok && body) return body;
    if (res.ok) throw new ToolError('Sage returned an unreadable answer.');
    if (RETRY_STATUS.has(res.status) && !last) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : retryDelayMs * 2 ** attempt, signal);
      continue;
    }
    throw new ToolError(apiError(res.status, body, text));
  }
}

function resolveKey(env, cwd) {
  const k = env[ENV_NAME]?.trim() || readEnvKey(cwd);
  if (!k) {
    throw new ToolError(
      `No Levanto key. Set ${ENV_NAME} in this MCP server's environment (in the client's MCP config), then restart it. Create a key at https://platform.levanto.ai`,
    );
  }
  return k;
}

export async function callTool(name, args, ctx) {
  args = args ?? {};
  let path, payload, shape, timeoutMs;
  if (name === 'decide') {
    payload = decideRequest(args);
    path = '/decide';
    shape = decideResult;
    timeoutMs = payload.reasoning || payload.grounding ? 60_000 : 15_000;
  } else if (name === 'decide_batch') {
    payload = decideBatchRequest(args);
    path = '/decide/batch';
    shape = (body) => decideBatchResult(body, payload);
    const searches = payload.requests.some((r) => r.questions.some((q) => q.grounding));
    timeoutMs = payload.reasoning || searches ? 90_000 : 30_000;
  } else if (name === 'extract') {
    payload = extractRequest(args);
    path = '/v1/extract';
    shape = extractResult;
    timeoutMs = 30_000;
  } else {
    return null;
  }
  const key = resolveKey(ctx.env, ctx.cwd);
  return shape(await callSage(path, payload, { ...ctx, key, timeoutMs }));
}

/**
 * Handles one JSON-RPC message. Returns the response object, or null for
 * notifications. `inflight` maps request ids to AbortControllers.
 */
export async function handleMessage(msg, ctx, inflight = new Map()) {
  const isRequest = msg && typeof msg === 'object' && msg.id !== undefined && msg.id !== null;
  const reply = (result) => (isRequest ? { jsonrpc: '2.0', id: msg.id, result } : null);
  const fail = (code, message) => (isRequest ? { jsonrpc: '2.0', id: msg.id, error: { code, message } } : null);
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg)) return null; // a client response; we send no requests
    return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
  }
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'levanto', title: 'Levanto Sage', version: ctx.version, websiteUrl: 'https://docs.levanto.ai/integrations/mcp' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args } = msg.params ?? {};
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      const controller = new AbortController();
      if (isRequest) inflight.set(msg.id, controller);
      try {
        const result = await callTool(name, args, { ...ctx, signal: controller.signal });
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
      } catch (e) {
        if (controller.signal.aborted) return null; // cancelled: the spec says not to answer
        const message = e instanceof ToolError ? e.message : `Unexpected error: ${e?.message ?? e}`;
        return reply({ content: [{ type: 'text', text: message }], isError: true });
      } finally {
        inflight.delete(msg.id);
      }
    }
    case 'notifications/cancelled':
      inflight.get(msg.params?.requestId)?.abort(new Error('cancelled'));
      return null;
    default:
      if (msg.method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

/** Runs the server until stdin closes. */
export function serve({ input = process.stdin, output = process.stdout, env = process.env, cwd = process.cwd(), version, fetchImpl = globalThis.fetch } = {}) {
  const ctx = { env, cwd, version, fetchImpl };
  const inflight = new Map();
  const pending = new Set();
  const send = (obj) => obj && output.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const msgs = Array.isArray(msg) ? msg : [msg];
    for (const m of msgs) {
      const p = handleMessage(m, ctx, inflight).then(send, (e) => send({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32603, message: String(e?.message ?? e) } }));
      pending.add(p);
      p.finally(() => pending.delete(p));
    }
  });
  return new Promise((res) => rl.on('close', () => Promise.allSettled([...pending]).then(() => res(0))));
}
