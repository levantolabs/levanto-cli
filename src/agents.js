// Which coding agents a project uses, and where their skills go.
//   claude -> .claude/skills/<name>/   (Claude Code)
//   agents -> .agents/skills/<name>/   (Codex, Cursor, Copilot, Antigravity,
//                                        opencode, Junie, Devin, Kilo, ...)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SKILLS_DIR, bundledSkillNames, listFiles } from './assets.js';

export const TARGETS = {
  claude: { label: 'Claude Code', dir: '.claude/skills' },
  agents: { label: 'Codex, Cursor, Copilot and others', dir: '.agents/skills' },
};

const CLAUDE_SIGNS = ['.claude', 'CLAUDE.md'];
const AGENTS_SIGNS = [
  '.agents',
  'AGENTS.md',
  '.codex',
  '.cursor',
  '.cursorrules',
  '.github/copilot-instructions.md',
  '.github/instructions',
  '.agent',
  '.antigravity',
  '.opencode',
  'opencode.json',
  '.junie',
  '.devin',
  '.kilocode',
  '.windsurf',
  'GEMINI.md',
];

const ALIASES = {
  claude: 'claude',
  'claude-code': 'claude',
  claudecode: 'claude',
  agents: 'agents',
  codex: 'agents',
  cursor: 'agents',
  copilot: 'agents',
  antigravity: 'agents',
  opencode: 'agents',
  junie: 'agents',
  devin: 'agents',
  kilo: 'agents',
  gemini: 'agents',
  windsurf: 'agents',
};

/** Targets for the agents found in <dir>; both when none is found. */
export function detectTargets(dir) {
  const found = [];
  if (CLAUDE_SIGNS.some((p) => existsSync(join(dir, p)))) found.push('claude');
  if (AGENTS_SIGNS.some((p) => existsSync(join(dir, p)))) found.push('agents');
  return { targets: found.length ? found : ['agents', 'claude'], detected: found.length > 0 };
}

/** Parses `--agents claude,codex`. Throws on an unknown name. */
export function parseAgentsFlag(value) {
  const out = new Set();
  for (const raw of String(value).split(',')) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    const t = ALIASES[name];
    if (!t) throw new Error(`Unknown agent "${raw.trim()}". Use: claude, agents (or codex, cursor, copilot, ...).`);
    out.add(t);
  }
  if (out.size === 0) throw new Error('--agents needs at least one name, e.g. --agents claude,agents');
  return [...out];
}

/** Is the folder at `path` one of ours (or empty)? Other skills are never touched. */
function isOurs(path, name) {
  const skill = join(path, 'SKILL.md');
  if (!existsSync(path)) return true;
  if (!existsSync(skill)) return false;
  const text = readFileSync(skill, 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return false;
  return new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(fm[1]) && /author:\s*"?levanto"?/i.test(fm[1]);
}

/** Copies every bundled skill into each target. Returns one entry per (target, skill). */
export function installSkills(dir, targets, { skillsDir = SKILLS_DIR } = {}) {
  const results = [];
  for (const target of targets) {
    const base = join(dir, TARGETS[target].dir);
    for (const name of bundledSkillNames(skillsDir)) {
      const dest = join(base, name);
      const rel = `${TARGETS[target].dir}/${name}`;
      if (!isOurs(dest, name)) {
        results.push({ target, name, path: rel, status: 'skipped', reason: 'a different skill already uses this folder' });
        continue;
      }
      const existed = existsSync(dest);
      rmSync(dest, { recursive: true, force: true });
      const src = join(skillsDir, name);
      for (const f of listFiles(src)) {
        const to = join(dest, f);
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(join(src, f), to);
      }
      results.push({ target, name, path: rel, status: existed ? 'updated' : 'installed' });
    }
  }
  return results;
}
