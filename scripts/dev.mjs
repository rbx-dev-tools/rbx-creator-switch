// One command to iterate on this extension:
//
//   node scripts/dev.mjs
//
// It opens Chrome with the extension installed, then reinstalls it on every
// save and refreshes any roblox.com tab so no stale content script survives.
//
// Chrome ignores --load-extension since version 137 or so, so the install goes
// through the DevTools protocol. Calling Extensions.loadUnpacked again on the
// same path returns the same extension id, which makes it a reload in place.
//
// CHROME       path to the browser binary
// DEV_PROFILE  where the dev profile lives (default ~/.rbx-creator-switch/profile)
// CDP_PORT     debugging port (default 9222)

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.CDP_PORT || 9222);
const profile = process.env.DEV_PROFILE || join(homedir(), '.rbx-creator-switch', 'profile');
const watched = ['manifest.json', 'src'];

const chromePath =
  process.env.CHROME ||
  {
    win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: 'google-chrome',
  }[platform()];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();

// The profile is persistent and separate: the debugging port stays out of the
// everyday browser, and signing in to Roblox here is a one-off.
const chrome = spawn(chromePath, [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--no-first-run',
  '--no-default-browser-check',
  'https://www.roblox.com/home',
]);
chrome.on('error', (err) => {
  console.error(`cannot start ${chromePath}: ${err.message}`);
  process.exit(1);
});

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => fail(new Error(`cannot reach ${url}`)), { once: true });
  });
  let nextId = 0;
  const send = (method, params) => {
    const id = ++nextId;
    return new Promise((ok, fail) => {
      const onMessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id !== id) return;
        ws.removeEventListener('message', onMessage);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { send, close: () => ws.close() };
}

async function browser() {
  for (let i = 0; i < 40; i++) {
    try {
      return await connect((await cdp('/json/version')).webSocketDebuggerUrl);
    } catch {
      await wait(500);
    }
  }
  throw new Error('Chrome never opened its debugging port');
}

// A content script injected before the reload keeps running against a dead
// extension context, so the pages it lives in have to be refreshed too.
async function refreshRobloxTabs() {
  const targets = await cdp('/json/list');
  for (const target of targets.filter((t) => t.type === 'page' && t.url.includes('roblox.com'))) {
    try {
      const page = await connect(target.webSocketDebuggerUrl);
      await page.send('Page.reload', {});
      page.close();
    } catch {
      // A tab that closed mid-reload is not worth reporting.
    }
  }
}

const cdpBrowser = await browser();

async function install(reason) {
  try {
    const { id } = await cdpBrowser.send('Extensions.loadUnpacked', { path: root });
    await refreshRobloxTabs();
    console.log(`${new Date().toLocaleTimeString()}  ${reason}  ${id}`);
  } catch (err) {
    console.error(`${new Date().toLocaleTimeString()}  ${reason} failed: ${err.message}`);
  }
}

await install('installed');

// Editors save in bursts, so collapse the events into one reinstall.
let pending = null;
for (const target of watched) {
  watch(join(root, target), { recursive: true }, (_event, file) => {
    if (file && !/\.(js|html|json|css)$/.test(file)) return;
    clearTimeout(pending);
    pending = setTimeout(() => install(`reloaded (${file || target})`), 150);
  });
}

console.log(`watching ${watched.join(', ')}, Ctrl+C to stop`);

const stop = () => {
  chrome.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
chrome.on('exit', stop);
