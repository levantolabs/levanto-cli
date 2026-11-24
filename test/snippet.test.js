import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { END, START, applySnippet, installSnippet, loadSnippet } from '../src/snippet.js';
import { tempDir } from './helpers.js';

const snippet = loadSnippet();

test('the bundled snippet has both markers', () => {
  assert.ok(snippet.includes(START));
  assert.ok(snippet.includes(END));
});

test('creates AGENTS.md when missing; no CLAUDE.md is created', (t) => {
  const dir = tempDir(t);
  assert.deepEqual(installSnippet(dir, snippet), [{ file: 'AGENTS.md', status: 'created' }]);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), snippet.trimEnd() + '\n');
  assert.equal(existsSync(join(dir, 'CLAUDE.md')), false);
});

test('appends after a blank line, then is idempotent', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\nUse pnpm.\n');
  installSnippet(dir, snippet);
  const once = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(once, `# Project\n\nUse pnpm.\n\n${snippet.trimEnd()}\n`);
  assert.deepEqual(installSnippet(dir, snippet), [{ file: 'AGENTS.md', status: 'unchanged' }]);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), once);
});

test('replaces only what is between the markers', () => {
  const old = `# P\n\n${START}\nold text\n${END}\n\n## After\nkeep me\n`;
  const next = applySnippet(old, snippet);
  assert.equal(next, `# P\n\n${snippet.trimEnd()}\n\n## After\nkeep me\n`);
  assert.equal(applySnippet(next, snippet), next);
  assert.equal(next.split(START).length, 2, 'one section only');
});

test('CLAUDE.md gets the section too, idempotently', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'CLAUDE.md'), '# Claude notes\n');
  assert.deepEqual(installSnippet(dir, snippet), [
    { file: 'AGENTS.md', status: 'created' },
    { file: 'CLAUDE.md', status: 'updated' },
  ]);
  const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.startsWith('# Claude notes\n\n' + START));
  installSnippet(dir, snippet);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), claude);
});

test('CLAUDE.md that imports AGENTS.md is left alone', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  const r = installSnippet(dir, snippet);
  assert.deepEqual(r[1], { file: 'CLAUDE.md', status: 'imports AGENTS.md' });
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
});

test('CLAUDE.md symlinked to AGENTS.md is written once', { skip: process.platform === 'win32' }, (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'AGENTS.md'), '# A\n');
  symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'));
  const r = installSnippet(dir, snippet);
  assert.equal(r[1].status, 'imports AGENTS.md');
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8').split(START).length, 2);
});
