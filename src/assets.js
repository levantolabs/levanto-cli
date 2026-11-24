// Where the bundled skills and AGENTS snippet live, and how to list them.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ASSETS_DIR = join(PACKAGE_ROOT, 'assets');
export const SKILLS_DIR = join(ASSETS_DIR, 'skills');
export const SNIPPET_PATH = join(ASSETS_DIR, 'AGENTS-snippet.md');

/** Files the bundle never carries (editor and OS litter). */
export function isJunk(name) {
  return name === '.DS_Store' || name === 'Thumbs.db' || name.endsWith('~');
}

/** Every file under `dir`, as sorted relative paths with forward slashes. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (isJunk(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** Names of the bundled skills (one folder each). */
export function bundledSkillNames(skillsDir = SKILLS_DIR) {
  return readdirSync(skillsDir)
    .filter((n) => !isJunk(n) && statSync(join(skillsDir, n)).isDirectory())
    .sort();
}
