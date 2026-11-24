import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'levanto-cli-test-'));
  t?.after?.(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Raw HTTP call (full control over Origin and Host). Resolves { status, headers, body }. */
export function http(port, { method = 'POST', path = '/callback', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

export const FAKE_KEY = 'lv_live_' + '0123456789abcdef'.repeat(3);
