import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { SKILLS_DIR, bundledSkillNames, listFiles } from '../src/assets.js';
import { detectTargets, installSkills, parseAgentsFlag } from '../src/agents.js';
import { tempDir } from './helpers.js';

const names = bundledSkillNames();

test('bundles levanto-sage and levanto-llms', () => {
  assert.deepEqual(names, ['levanto-llms', 'levanto-sage']);
});

test('detection: nothing found -> both targets', (t) => {
  assert.deepEqual(detectTargets(tempDir(t)), { targets: ['agents', 'claude'], detected: false });
});

test('detection: .claude/ or CLAUDE.md -> claude only', (t) => {
  const a = tempDir(t);
  mkdirSync(join(a, '.claude'));
  assert.deepEqual(detectTargets(a).targets, ['claude']);
  const b = tempDir(t);
  writeFileSync(join(b, 'CLAUDE.md'), '');
  assert.deepEqual(detectTargets(b).targets, ['claude']);
});

test('detection: Codex / Cursor / Copilot signs -> agents', (t) => {
  for (const sign of ['AGENTS.md', '.cursor', '.codex', '.github/copilot-instructions.md', '.junie']) {
    const d = tempDir(t);
    const p = join(d, sign);
    if (sign.includes('.md')) {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, '');
    } else mkdirSync(p);
    assert.deepEqual(detectTargets(d).targets, ['agents'], sign);
  }
});

test('detection: both kinds -> both', (t) => {
  const d = tempDir(t);
  writeFileSync(join(d, 'CLAUDE.md'), '');
  mkdirSync(join(d, '.cursor'));
  assert.deepEqual(detectTargets(d).targets, ['claude', 'agents']);
});

test('--agents parsing with aliases; unknown names rejected', () => {
  assert.deepEqual(parseAgentsFlag('claude,agents'), ['claude', 'agents']);
  assert.deepEqual(parseAgentsFlag('codex, cursor'), ['agents']);
  assert.deepEqual(parseAgentsFlag('Claude-Code'), ['claude']);
  assert.throws(() => parseAgentsFlag('vim'), /Unknown agent/);
  assert.throws(() => parseAgentsFlag(','), /at least one/);
});

test('installs whole skill folders into each target', (t) => {
  const d = tempDir(t);
  const r = installSkills(d, ['claude', 'agents']);
  assert.equal(r.length, 4);
  assert.ok(r.every((x) => x.status === 'installed'));
  for (const base of ['.claude/skills', '.agents/skills']) {
    for (const n of names) {
      const src = join(SKILLS_DIR, n);
      const dest = join(d, base, n);
      assert.deepEqual(listFiles(dest), listFiles(src));
      for (const f of listFiles(src)) assert.ok(readFileSync(join(dest, f)).equals(readFileSync(join(src, f))));
    }
  }
});

test('updates older Levanto copies (removing stale files) and never touches other skills', (t) => {
  const d = tempDir(t);
  installSkills(d, ['agents']);
  const stale = join(d, '.agents/skills/levanto-sage/references/old.md');
  writeFileSync(stale, 'old');
  const other = join(d, '.agents/skills/my-skill');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'SKILL.md'), '---\nname: my-skill\n---\n');
  const r = installSkills(d, ['agents']);
  assert.ok(r.every((x) => x.status === 'updated'));
  assert.equal(existsSync(stale), false);
  assert.equal(readFileSync(join(other, 'SKILL.md'), 'utf8'), '---\nname: my-skill\n---\n');
});

test('a foreign folder with a Levanto skill name is left alone', (t) => {
  const d = tempDir(t);
  const foreign = join(d, '.claude/skills/levanto-sage');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'SKILL.md'), '---\nname: levanto-sage\nmetadata:\n  author: someone-else\n---\nmine\n');
  const r = installSkills(d, ['claude']);
  assert.equal(r.find((x) => x.name === 'levanto-sage').status, 'skipped');
  assert.equal(r.find((x) => x.name === 'levanto-llms').status, 'installed');
  assert.ok(readFileSync(join(foreign, 'SKILL.md'), 'utf8').includes('mine'));
});
