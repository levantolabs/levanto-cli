// Terminal prompts: a y/N confirm and a masked key input. Both need a TTY.
import { createInterface } from 'node:readline';

export function isInteractive(stdin = process.stdin, stdout = process.stdout) {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/** Asks a yes/no question; Enter takes the default. */
export function confirm(question, { defaultYes = true, input = process.stdin, output = process.stdout } = {}) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const rl = createInterface({ input, output });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(`${question} (${hint}) `, (a) => {
      answered = true;
      rl.close();
      const t = a.trim().toLowerCase();
      if (!t) return resolve(defaultYes);
      resolve(t === 'y' || t === 'yes');
    });
    rl.once('close', () => {
      if (!answered) resolve(false);
    });
  });
}

/** Waits for Enter. Returns { promise, cancel }. */
export function waitForEnter({ input = process.stdin } = {}) {
  const rl = createInterface({ input });
  let cancel;
  const promise = new Promise((resolve) => {
    rl.once('line', () => resolve(true));
    rl.once('close', () => resolve(false));
    cancel = () => rl.close();
  });
  return { promise, cancel };
}

/** Reads a secret without echoing it (one • per character). Ctrl-C exits. */
export function readSecret(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    output.write(question);
    let value = '';
    const wasRaw = input.isRaw;
    input.setRawMode?.(true);
    input.resume();
    input.setEncoding('utf8');
    const done = (v) => {
      input.removeListener('data', onData);
      input.setRawMode?.(wasRaw ?? false);
      input.pause();
      output.write('\n');
      resolve(v);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(value);
        if (ch === '\u0003') {
          output.write('\n');
          process.exit(130);
        }
        if (ch === '\u0004') return done(value);
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue;
        value += ch;
        output.write('•');
      }
    };
    input.on('data', onData);
  });
}
