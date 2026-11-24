// Browser sign-in, loopback flow: a one-shot HTTP server on 127.0.0.1 that
// receives {state, key} from the dashboard page /cli/auth.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { isValidKey } from './key.js';

export const DEFAULT_DASHBOARD_URL = 'https://platform.levanto.ai';
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BODY = 8 * 1024;

export function dashboardUrl(env = process.env) {
  const raw = env.LEVANTO_DASHBOARD_URL?.trim();
  if (!raw) return DEFAULT_DASHBOARD_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return DEFAULT_DASHBOARD_URL;
    return u.origin;
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

/** Origins allowed to post the key: the dashboard, plus the override when set. */
export function allowedOrigins(env = process.env) {
  return [...new Set([DEFAULT_DASHBOARD_URL, dashboardUrl(env)])];
}

export function newState() {
  return randomBytes(32).toString('base64url');
}

/** Constant-time string compare (hashing first makes the lengths equal). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function authUrl({ port, state, name, env = process.env }) {
  const u = new URL('/cli/auth', dashboardUrl(env));
  u.searchParams.set('port', String(port));
  u.searchParams.set('state', state);
  u.searchParams.set('name', name);
  return u.toString();
}

/**
 * Starts the loopback server. Resolves once it listens, with
 *   { port, key: Promise<string>, close() }
 * `key` resolves with the key from the first valid callback, or rejects with
 * an Error whose `code` is 'TIMEOUT' or 'CANCELLED'.
 */
export function startAuthServer({ state, env = process.env, timeoutMs = AUTH_TIMEOUT_MS, signal } = {}) {
  const origins = allowedOrigins(env);
  let settle;
  const key = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  key.catch(() => {});
  let done = false;
  let timer;

  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    const allowed = typeof origin === 'string' && origins.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : origins[origins.length - 1],
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '60',
      Vary: 'Origin',
    };
    const send = (status, body) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // A request whose Host isn't this loopback address is a DNS-rebinding attempt.
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${server.address().port}` && host !== `localhost:${server.address().port}`) {
      return send(421, { ok: false, error: 'wrong host' });
    }
    if (url.pathname !== '/callback') return send(404, { ok: false, error: 'not found' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method !== 'POST') return send(405, { ok: false, error: 'method not allowed' });
    if (!allowed) return send(403, { ok: false, error: 'origin not allowed' });
    if (done) return send(409, { ok: false, error: 'already done' });

    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        send(413, { ok: false, error: 'too large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY || done) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(400, { ok: false, error: 'invalid JSON' });
      }
      if (!safeEqual(body?.state, state)) return send(403, { ok: false, error: 'state mismatch' });
      if (!isValidKey(body?.key)) return send(400, { ok: false, error: 'invalid key' });
      done = true;
      res.on('finish', () => finish(null, body.key));
      send(200, { ok: true });
    });
  });

  function finish(err, value) {
    clearTimeout(timer);
    done = true;
    server.close();
    server.closeAllConnections?.();
    if (err) settle.reject(err);
    else settle.resolve(value);
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(() => {
        const e = new Error('Timed out waiting for the browser sign-in.');
        e.code = 'TIMEOUT';
        finish(e);
      }, timeoutMs);
      timer.unref?.();
      signal?.addEventListener('abort', () => {
        if (done) return;
        const e = new Error('Browser sign-in cancelled.');
        e.code = 'CANCELLED';
        finish(e);
      });
      resolve({
        port: server.address().port,
        key,
        close: () => {
          if (!done) {
            const e = new Error('Browser sign-in cancelled.');
            e.code = 'CANCELLED';
            finish(e);
          }
        },
      });
    });
  });
}
