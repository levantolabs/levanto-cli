// Opens a URL in the default browser. Resolves true when the opener started.
import { spawn } from 'node:child_process';

export function openerFor(url, platform = process.platform) {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') {
    // `start` is a cmd builtin; the empty "" is the window title, ^& keeps the query intact.
    return { cmd: 'cmd', args: ['/c', 'start', '""', url.replace(/&/g, '^&')], windowsVerbatimArguments: true };
  }
  return { cmd: 'xdg-open', args: [url] };
}

export function openBrowser(url, { env = process.env, platform = process.platform } = {}) {
  if (env.LEVANTO_NO_BROWSER || env.CI) return Promise.resolve(false);
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return Promise.resolve(false);
  const { cmd, args, windowsVerbatimArguments } = openerFor(url, platform);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments });
    } catch {
      return resolve(false);
    }
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
    child.unref();
    // `open`/`xdg-open` return quickly; don't wait on a slow one.
    setTimeout(() => resolve(true), 1500).unref();
  });
}
