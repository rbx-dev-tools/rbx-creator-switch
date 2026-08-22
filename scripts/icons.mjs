// Renders icons/icon.svg to the PNG sizes Chrome asks for.
//
//   node scripts/icons.mjs
//
// The SVG is the source; the PNGs are build output that happens to be
// committed, because an unpacked extension has no build step and Chrome will
// not read an SVG icon. Regenerating them is one command, so the pixels never
// become the only copy of the design.
//
// Chrome itself does the rasterising, through the same DevTools protocol
// scripts/dev.mjs uses. That keeps this repository free of an image toolchain
// for four small files.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];
const port = Number(process.env.CDP_PORT || 9250);

const chromePath =
  process.env.CHROME ||
  {
    win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: 'google-chrome',
  }[platform()];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = async (path, init) => (await fetch(`http://127.0.0.1:${port}${path}`, init)).json();

function connect(url) {
  const ws = new WebSocket(url);
  let n = 0;
  const ready = new Promise((ok, fail) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => fail(new Error('cannot reach the browser')), { once: true });
  });
  const send = (method, params) => {
    const id = ++n;
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
  return { ready, send };
}

// A real file beside the SVG, opened over file://, and the image sized to the
// viewport so one page serves every size.
//
// Two shortcuts were tried and neither works. Pasting the SVG into the markup
// puts it through the HTML tokeniser, which gave a document of the right size
// that drew nothing. Referencing it as a data: image from a data: page is
// refused by Chrome, which does not let a data: document load one. A file next
// to the SVG has neither problem.
const frame = join(root, 'icons', '.render.html');
writeFileSync(
  frame,
  '<!doctype html><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:transparent}' +
    'img{display:block;width:100vw;height:100vh}</style>' +
    '<img src="./icon.svg" alt="">'
);
const page = () => 'file:///' + frame.split('\\').join('/');

const profile = join(homedir(), '.rbx-creator-switch', 'icon-profile');
mkdirSync(join(root, 'icons'), { recursive: true });

const chrome = spawn(chromePath, [
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  'about:blank',
]);
chrome.on('error', (err) => {
  console.error(`cannot start ${chromePath}: ${err.message}`);
  process.exit(1);
});

try {
  for (let i = 0; i < 60; i++) {
    try {
      await cdp('/json/version');
      break;
    } catch {
      await wait(250);
    }
  }

  for (const size of SIZES) {
    const target = await cdp(`/json/new?${encodeURIComponent(page())}`, { method: 'PUT' });
    const tab = connect(target.webSocketDebuggerUrl);
    await tab.ready;
    await tab.send('Emulation.setDeviceMetricsOverride', {
      width: size,
      height: size,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Without this the capture comes back on white, and an extension icon has
    // to sit on whatever colour the toolbar happens to be.
    await tab.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    await wait(150);

    const shot = await tab.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
      captureBeyondViewport: false,
    });
    writeFileSync(join(root, 'icons', `icon-${size}.png`), Buffer.from(shot.data, 'base64'));
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
    console.log(`icons/icon-${size}.png`);
  }
} catch (err) {
  console.error(`icon rendering failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  chrome.kill();
  rmSync(frame, { force: true });
}
