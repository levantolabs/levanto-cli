import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { ASSETS_DIR, PACKAGE_ROOT, listFiles } from '../src/assets.js';

const source = resolve(process.env.LEVANTO_SKILLS_DIR ?? join(PACKAGE_ROOT, '..', 'levanto-skills'));
const present = existsSync(join(source, 'skills')) && existsSync(join(source, 'AGENTS-snippet.md'));

test('bundled assets are byte-identical to ../levanto-skills', { skip: !present && `source not found at ${source}` }, () => {
  const srcSkills = join(source, 'skills');
  const dstSkills = join(ASSETS_DIR, 'skills');
  const srcFiles = listFiles(srcSkills);
  assert.deepEqual(listFiles(dstSkills), srcFiles, 'same files (run: npm run bundle)');
  for (const f of srcFiles) {
    assert.ok(readFileSync(join(dstSkills, f)).equals(readFileSync(join(srcSkills, f))), `${f} differs (run: npm run bundle)`);
  }
  assert.ok(
    readFileSync(join(ASSETS_DIR, 'AGENTS-snippet.md')).equals(readFileSync(join(source, 'AGENTS-snippet.md'))),
    'AGENTS-snippet.md differs (run: npm run bundle)',
  );
});

test('assets are present in the package', () => {
  assert.ok(existsSync(join(ASSETS_DIR, 'AGENTS-snippet.md')));
  assert.ok(existsSync(join(ASSETS_DIR, 'skills', 'levanto-sage', 'SKILL.md')));
  assert.ok(existsSync(join(ASSETS_DIR, 'skills', 'levanto-llms', 'SKILL.md')));
});
