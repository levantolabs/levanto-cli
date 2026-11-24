#!/usr/bin/env node
// Copies the skills and AGENTS snippet from ../levanto-skills into assets/,
// byte for byte. Run before packing (npm runs it as `prepack`).
// Override the source with LEVANTO_SKILLS_DIR.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ASSETS_DIR, PACKAGE_ROOT, bundledSkillNames, listFiles } from '../src/assets.js';

const source = resolve(process.env.LEVANTO_SKILLS_DIR ?? join(PACKAGE_ROOT, '..', 'levanto-skills'));

if (!existsSync(join(source, 'skills')) || !existsSync(join(source, 'AGENTS-snippet.md'))) {
  if (existsSync(join(ASSETS_DIR, 'skills'))) {
    console.warn(`bundle: ${source} not found; keeping the assets already in assets/.`);
    process.exit(0);
  }
  console.error(`bundle: ${source} not found and assets/ is empty. Set LEVANTO_SKILLS_DIR.`);
  process.exit(1);
}

rmSync(ASSETS_DIR, { recursive: true, force: true });
mkdirSync(ASSETS_DIR, { recursive: true });

let count = 0;
for (const name of bundledSkillNames(join(source, 'skills'))) {
  const from = join(source, 'skills', name);
  for (const rel of listFiles(from)) {
    const to = join(ASSETS_DIR, 'skills', name, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(from, rel), to);
    count++;
  }
}
copyFileSync(join(source, 'AGENTS-snippet.md'), join(ASSETS_DIR, 'AGENTS-snippet.md'));
count++;

console.log(`bundle: copied ${count} files from ${source} into assets/`);
