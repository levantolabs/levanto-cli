// The Levanto section in AGENTS.md (and CLAUDE.md, which Claude Code reads instead).
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SNIPPET_PATH } from './assets.js';

export const START = '<!-- levanto:start -->';
export const END = '<!-- levanto:end -->';

export function loadSnippet(path = SNIPPET_PATH) {
  return readFileSync(path, 'utf8');
}

/** Returns the new text with the snippet in place: replaced between the
 *  markers when they exist, appended after a blank line otherwise. */
export function applySnippet(text, snippet) {
  const block = snippet.replace(/\s+$/, '');
  const s = text.indexOf(START);
  const e = s === -1 ? -1 : text.indexOf(END, s);
  if (s !== -1 && e !== -1) {
    return text.slice(0, s) + block + text.slice(e + END.length);
  }
  if (text.trim() === '') return `${block}\n`;
  const base = text.replace(/\s+$/, '');
  return `${base}\n\n${block}\n`;
}

/** Writes the snippet into <dir>/<file>. Returns 'created' | 'updated' | 'unchanged'. */
export function writeSnippet(dir, file, snippet) {
  const path = join(dir, file);
  const exists = existsSync(path);
  const before = exists ? readFileSync(path, 'utf8') : '';
  const after = applySnippet(before, snippet);
  if (exists && after === before) return 'unchanged';
  writeFileSync(path, after);
  return exists ? 'updated' : 'created';
}

/** CLAUDE.md that only points at AGENTS.md (an `@AGENTS.md` import or a symlink) needs no copy. */
export function claudeMdImportsAgents(dir) {
  const claude = join(dir, 'CLAUDE.md');
  const agents = join(dir, 'AGENTS.md');
  try {
    if (existsSync(agents) && realpathSync(claude) === realpathSync(agents)) return true;
  } catch {
    return false;
  }
  return /^\s*@\.?\/?AGENTS\.md\s*$/m.test(readFileSync(claude, 'utf8'));
}

/** AGENTS.md always; CLAUDE.md when it exists and doesn't already import AGENTS.md. */
export function installSnippet(dir, snippet = loadSnippet()) {
  const results = [{ file: 'AGENTS.md', status: writeSnippet(dir, 'AGENTS.md', snippet) }];
  if (existsSync(join(dir, 'CLAUDE.md'))) {
    if (claudeMdImportsAgents(dir)) results.push({ file: 'CLAUDE.md', status: 'imports AGENTS.md' });
    else results.push({ file: 'CLAUDE.md', status: writeSnippet(dir, 'CLAUDE.md', snippet) });
  }
  return results;
}
