// Plain output: one short line per step, ✓ / ✗ marks, colour only on a TTY
// and never when NO_COLOR is set.

export function useColor(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined) return false;
  return Boolean(stream.isTTY);
}

export function createOutput({ stream = process.stdout, errStream = process.stderr, env = process.env } = {}) {
  const color = useColor(stream, env);
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const out = {
    color,
    line: (s = '') => stream.write(`${s}\n`),
    ok: (s) => stream.write(`${paint('32', '✓')} ${s}\n`),
    fail: (s) => errStream.write(`${paint('31', '✗')} ${s}\n`),
    skip: (s) => stream.write(`${paint('2', '-')} ${s}\n`),
    note: (s) => stream.write(`  ${paint('2', s)}\n`),
    bold: (s) => paint('1', s),
    dim: (s) => paint('2', s),
  };
  return out;
}
