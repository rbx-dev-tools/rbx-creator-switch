// The popup, in a plain browser tab, running on stand-in data.
//
//   node scripts/screenshots.mjs          # then open http://127.0.0.1:8765/
//
// It serves this folder and, on the popup page alone, slips a stand-in for
// `chrome.*` in ahead of main.js. The stand-in answers every agent request
// from a fixture instead of a Roblox session. Nothing here is shipped: the
// extension's own code runs untouched, only the browser it talks to is fake.
//
// The fixture is built at startup from public endpoints, so the pictures are
// the real icons of well-known experiences and the names are ones a reader
// recognises. Without network it falls back to invented names and drawn
// initials, which is enough to look at the layout.
//
//   node scripts/screenshots.mjs --capture   # writes docs/screenshots/*.png and exits:
//                                            # the README views at 2x, and the
//                                            # 1280x800 Web Store pictures
//
//   PORT        listening port (default 8765)
//   CHROME      path to the browser binary, for --capture
//
// The page accepts `?theme=light` or `?theme=dark` to pin a theme, `?open=`
// account, creator, game or search to start with that list open, and `?q=`
// for the search text.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8765);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// --- the fixture ----------------------------------------------------------

// Well-known places. Their universe, name and creator are looked up, so the
// list here only has to be right about which places exist.
const PLACES = [
  920587237, 4924922222, 2753915549, 606849621, 142823291, 1962086868, 189707, 192800, 370731277,
  735030788, 286090429, 4623386862, 6516141723, 6872265039, 185655149, 69184822, 13822889,
  292439477, 15101393044,
];
// Roblox's own accounts, so the "signed in" rows name nobody in particular.
const USERS = [1, 156];
const ROLES = ['Owner', 'Developer', 'Admin', 'Scripter', 'Builder'];

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
};

async function realFixture() {
  const universes = [];
  for (const place of PLACES) {
    const { universeId } = await json(
      `https://apis.roblox.com/universes/v1/places/${place}/universe`
    );
    universes.push(universeId);
  }
  const { data: games } = await json(
    `https://games.roblox.com/v1/games?universeIds=${universes.join(',')}`
  );
  const users = await Promise.all(
    USERS.map((id) => json(`https://users.roblox.com/v1/users/${id}`))
  );

  const accounts = users.map((u) => ({
    userId: String(u.id),
    username: u.name,
    displayName: u.displayName,
  }));

  // Group-owned experiences go under their real group; user-owned ones are
  // shown as "My creations" of the first account, which is a fiction the
  // screenshot needs and the names do not contradict.
  const groups = new Map();
  const byCreator = {};
  for (const g of games) {
    const key = g.creator.type === 'Group' ? `Group:${g.creator.id}` : `User:${accounts[0].userId}`;
    if (g.creator.type === 'Group' && !groups.has(String(g.creator.id))) {
      groups.set(String(g.creator.id), {
        id: String(g.creator.id),
        name: g.creator.name,
        roleSetName: ROLES[groups.size % ROLES.length],
      });
    }
    (byCreator[key] ??= []).push({
      id: String(g.id),
      name: g.name,
      rootPlaceId: g.rootPlaceId,
      privacyType: 'Public',
    });
  }
  // The second account sees a few of the same groups, so a search result can
  // show the "switches" badge.
  const all = [...groups.values()];
  return {
    accounts,
    groups: {
      [accounts[0].userId]: all,
      [accounts[1].userId]: all.slice(0, 3),
    },
    games: { ...byCreator, [`User:${accounts[1].userId}`]: [] },
    images: true,
  };
}

function inventedFixture() {
  const accounts = [
    { userId: '1001', username: 'main_account', displayName: 'Main Account' },
    { userId: '1002', username: 'studio_account', displayName: 'Studio Account' },
  ];
  const names = {
    'User:1001': ['Pixel Farm', 'Rooftop Runners', 'Tiny Tycoon', 'Orbit Drift'],
    'User:1002': [],
    'Group:2001': ['Aster Arena', 'Glacier Raid', 'Neon Harbor', 'Skybound Tycoon'],
    'Group:2002': ['Lantern Quest', 'Marsh Kingdom'],
    'Group:2003': ['Copper Rush', 'Mine Cart Mania', 'Rail Baron'],
    'Group:2004': ['Driftwood Bay'],
  };
  const groups = [
    { id: '2001', name: 'Aster Interactive', roleSetName: 'Owner' },
    { id: '2002', name: 'Blue Lantern Games', roleSetName: 'Developer' },
    { id: '2003', name: 'Copperline Studio', roleSetName: 'Scripter' },
    { id: '2004', name: 'Driftwood Collective', roleSetName: 'Builder' },
  ];
  let next = 5000;
  const games = Object.fromEntries(
    Object.entries(names).map(([key, list]) => [
      key,
      list.map((name, i) => ({
        id: String(next++),
        name,
        rootPlaceId: 1,
        privacyType: ['Public', 'Private', 'FriendsOnly'][i % 3],
      })),
    ])
  );
  return {
    accounts,
    groups: { 1001: groups, 1002: groups.slice(0, 1) },
    games,
    images: false,
  };
}

let fixture;
try {
  fixture = await realFixture();
  console.log('fixture: real names and icons from public endpoints');
} catch (err) {
  fixture = inventedFixture();
  console.log(`fixture: invented (${err.message})`);
}

// Thumbnails are fetched here rather than in the page: the page is on
// localhost and thumbnails.roblox.com is not obliged to answer it.
const THUMBS = {
  accounts: ['users/avatar-headshot', 'userIds', '48x48'],
  groups: ['groups/icons', 'groupIds', '150x150'],
  games: ['games/icons', 'universeIds', '128x128'],
};
async function thumbnails(kind, ids) {
  const [path, param, size] = THUMBS[kind];
  const url = new URL(`https://thumbnails.roblox.com/v1/${path}`);
  url.searchParams.set(param, ids.join(','));
  url.searchParams.set('size', size);
  url.searchParams.set('format', 'Png');
  const { data = [] } = await json(url);
  return Object.fromEntries(
    data.filter((t) => t.state === 'Completed').map((t) => [String(t.targetId), t.imageUrl])
  );
}

// --- the fake browser, as page source ------------------------------------

// Sent to the page as text, so it is written as a string rather than as code
// this file would run. Everything the popup calls on `chrome` is here.
const stub = String.raw`
(() => {
  const params = new URLSearchParams(location.search);
  const fixture = fetch('/__fixture.json').then((r) => r.json());

  // A face for the offline fixture: two initials on a tinted disc.
  const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const face = (name, round) => {
    const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const h = hue(name);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      (round
        ? '<circle cx="32" cy="32" r="32" fill="hsl(' + h + ' 55% 62%)"/>'
        : '<rect width="64" height="64" rx="12" fill="hsl(' + h + ' 45% 48%)"/>') +
      '<text x="32" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" font-weight="600" fill="#fff">' + initials + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  };

  let active = null;
  const handlers = {
    async listAccounts() {
      const f = await fixture;
      active ??= f.accounts[0].userId;
      return { accounts: f.accounts, activeUserId: active, canSwitch: true };
    },
    async switchAccount({ toUserId }) { active = toUserId; return { ok: true }; },
    async listGroups() { return (await fixture).groups[active] ?? []; },
    async listGames({ creatorType, creatorTargetId }) {
      return (await fixture).games[creatorType + ':' + creatorTargetId] ?? [];
    },
    async images({ kind, ids }) {
      const f = await fixture;
      if (f.images) {
        return (await fetch('/__images?kind=' + kind + '&ids=' + ids.join(','))).json();
      }
      const label = (id) => kind === 'accounts'
        ? f.accounts.find((a) => a.userId === id)?.displayName
        : kind === 'groups'
          ? Object.values(f.groups).flat().find((g) => g.id === id)?.name
          : Object.values(f.games).flat().find((g) => g.id === id)?.name;
      return Object.fromEntries(ids.map((id) => [id, face(label(id) ?? id, kind === 'accounts')]));
    },
  };

  // A little latency, so the paint-then-refresh path of the popup is
  // exercised rather than short-circuited.
  const latency = () => new Promise((r) => setTimeout(r, 120));

  const store = new Map();
  if (params.get('theme')) store.set('theme', params.get('theme'));
  const tab = { id: 1, url: 'https://www.roblox.com/home', status: 'complete', discarded: false, active: false };

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return store.has(key) ? { [key]: store.get(key) } : {};
          return Object.fromEntries(store);
        },
        async set(entries) { for (const [k, v] of Object.entries(entries)) store.set(k, v); },
        async remove(keys) { for (const k of [keys].flat()) store.delete(k); },
      },
    },
    permissions: {
      async contains() { return true; },
      async request() { return true; },
    },
    tabs: {
      async query() { return [tab]; },
      async get() { return tab; },
      async create() { return { id: 2 }; },
      async update() {},
      async reload() {},
      async remove() {},
      onActivated: { addListener() {} },
    },
    scripting: {
      async executeScript({ files, args }) {
        if (files) return [];
        await latency();
        const [type, payload] = args;
        const handler = handlers[type];
        if (!handler) return [{ result: { ok: false, error: 'unknown request: ' + type } }];
        return [{ result: { ok: true, data: await handler(payload || {}) } }];
      },
    },
  };

  // Opening a list for the picture, once the popup has filled it.
  const open = params.get('open');
  if (open) {
    const tick = setInterval(() => {
      const target = document.getElementById(open);
      if (!target) return clearInterval(tick);
      // A search only answers once the catalogue is built, which the
      // placeholder reports by going back to its resting text.
      const ready = open === 'search'
        ? document.querySelector('#game .list li') &&
          target.querySelector('input').placeholder === 'Search an experience'
        : target.querySelector('.list li');
      if (!ready) return;
      clearInterval(tick);
      if (open === 'search') {
        const input = target.querySelector('input');
        input.value = params.get('q') || 'to';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        target.querySelector('.current').click();
      }
    }, 100);
  }
})();
`;

// --- the server -----------------------------------------------------------

const popup = 'src/popup/popup.html';

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };

  // The popup's stylesheet and script are relative paths, so it has to be
  // served from its own folder rather than aliased at the root.
  if (url.pathname === '/') {
    res.writeHead(302, { location: `/${popup}${url.search}` });
    return res.end();
  }
  if (url.pathname === '/__stub.js') return send(200, types['.js'], stub);
  if (url.pathname === '/__store') return send(200, types['.html'], storePage(url.searchParams));
  if (url.pathname === '/__fixture.json') {
    return send(200, types['.json'], JSON.stringify(fixture));
  }
  if (url.pathname === '/__images') {
    try {
      const kind = url.searchParams.get('kind');
      const ids = url.searchParams.get('ids').split(',');
      return send(200, types['.json'], JSON.stringify(await thumbnails(kind, ids)));
    } catch {
      return send(200, types['.json'], '{}');
    }
  }

  const file = normalize(join(root, url.pathname));
  if (!file.startsWith(root)) return send(403, 'text/plain', '');
  try {
    let body = await readFile(file);
    if (url.pathname === `/${popup}`) {
      body = body
        .toString()
        .replace(
          '<script type="module"',
          '<script src="/__stub.js"></script>\n<script type="module"'
        );
    }
    send(200, types[extname(file)] ?? 'application/octet-stream', body);
  } catch {
    send(404, 'text/plain', 'not found');
  }
}).listen(port, '127.0.0.1', async () => {
  console.log(`popup on stand-in data: http://127.0.0.1:${port}/`);
  console.log('  ?theme=light|dark   ?open=account|creator|game|search   ?q=<search text>');
  if (process.argv.includes('--capture')) {
    try {
      await capture();
      process.exit(0);
    } catch (err) {
      console.error(`capture failed: ${err.message}`);
      process.exit(1);
    }
  }
});

// --- the Web Store listing ------------------------------------------------

// The Chrome Web Store wants 1280x800 pictures. Each is the popup, drawn
// through an iframe so it is the real thing, on a field in the Hub's colours
// with one line saying what is being looked at. The data is the fixture, so
// nothing of anyone's account is in them.
const STORE = [
  {
    name: 'store-1-pickers',
    query: 'theme=dark&open=creator',
    title: 'Account, creator, experience.',
    line: 'Three linked pickers, each row with its picture, in one popup.',
  },
  {
    name: 'store-2-search',
    query: 'theme=dark&open=search&q=to',
    title: 'Type a name, press Enter.',
    line: 'Search every experience of every creator you can see, across accounts.',
  },
  {
    name: 'store-3-light',
    query: 'theme=light&open=game',
    title: 'Light, dark, or whatever the system says.',
    line: 'Opens the experience in the Creator Hub tab you already have.',
  },
];

function storePage(params) {
  const shot = STORE.find((s) => s.name === params.get('shot')) ?? STORE[0];
  const dark = !shot.query.includes('theme=light');
  const esc = (t) =>
    t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body {
    display: flex; align-items: center; gap: 72px; padding: 0 96px; box-sizing: border-box;
    background: ${dark ? '#121215' : '#f7f7f8'}; color: ${dark ? '#f7f7f8' : '#202227'};
    font-family: 'Builder Sans', system-ui, 'Segoe UI', Roboto, sans-serif;
  }
  .copy { flex: 1; }
  h1 { margin: 0 0 14px; font-size: 44px; line-height: 1.1; font-weight: 800; letter-spacing: -0.01em; }
  p { margin: 0; font-size: 20px; line-height: 1.4; font-weight: 500; color: ${dark ? '#bcbec8' : '#6a6f81'}; }
  .tag { display: inline-block; margin-bottom: 22px; padding: 6px 12px; border-radius: 999px;
    background: ${dark ? 'rgba(208,217,251,.12)' : 'rgba(27,37,75,.08)'}; font-size: 14px; font-weight: 700; }
  iframe {
    flex: none; width: ${WIDTH}px; height: 540px; zoom: 1.3; border: 0; border-radius: 12px;
    box-shadow: 0 24px 64px rgba(0,0,0,${dark ? '.6' : '.18'}), 0 0 0 1px ${dark ? 'rgba(208,217,251,.12)' : 'rgba(27,37,75,.12)'};
    background: ${dark ? '#121215' : '#f7f7f8'};
  }
</style>
<div class="copy">
  <div class="tag">rbx-creator-switch</div>
  <h1>${esc(shot.title)}</h1>
  <p>${esc(shot.line)}</p>
</div>
<iframe src="/src/popup/popup.html?${shot.query}"></iframe>
`;
}

// --- capture ---------------------------------------------------------------

// The views the README shows, each at twice the popup's own size so they
// stay sharp on a high-density screen. Chrome headless draws them through
// the DevTools protocol; nothing else is needed.
const SHOTS = [
  { name: 'creator-dark', query: 'theme=dark&open=creator' },
  { name: 'creator-light', query: 'theme=light&open=creator' },
  { name: 'game-dark', query: 'theme=dark&open=game' },
  { name: 'search-dark', query: 'theme=dark&open=search&q=to' },
  { name: 'search-light', query: 'theme=light&open=search&q=to' },
];
const WIDTH = 368; // 340px of popup plus its 14px of padding either side

async function capture() {
  const out = join(root, 'docs', 'screenshots');
  await mkdir(out, { recursive: true });
  const cdpPort = port + 1;
  const chromePath =
    process.env.CHROME ||
    {
      win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      linux: 'google-chrome',
    }[platform()];
  const chrome = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--no-first-run',
    `--window-size=${WIDTH},800`,
    '--hide-scrollbars',
    'about:blank',
  ]);
  try {
    const version = await retry(() =>
      fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json())
    );
    const browser = await connect(version.webSocketDebuggerUrl);
    for (const shot of SHOTS) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { webSocketDebuggerUrl } = (
        await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json())
      ).find((t) => t.id === targetId);
      const page = await connect(webSocketDebuggerUrl);
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH,
        height: 800,
        deviceScaleFactor: 2,
        mobile: false,
      });
      await page.send('Page.navigate', { url: `http://127.0.0.1:${port}/?${shot.query}` });
      // Long enough for the fixture, the lists, the pictures and the fade.
      await new Promise((r) => setTimeout(r, 6000));
      // The page is as tall as the viewport, so the content's own height has
      // to be measured: the bottom of the lowest visible block. An open list
      // counts by its own box, not by the rows scrolled away inside it.
      const { result } = await page.send('Runtime.evaluate', {
        expression: `Math.ceil(Math.max(...[...document.querySelectorAll(
            '.search, .picker, .picker.open .list, .search.open .list, #open, .footer'
          )].map((e) => e.getBoundingClientRect().bottom)))`,
        returnByValue: true,
      });
      const height = result.value + 14;
      // Drawn as the popup looks in Chrome: its own rounded panel, nothing
      // around it. The body is stretched to the measured height so an open
      // list hanging below the footer still sits on the panel.
      await page.send('Runtime.evaluate', {
        expression: `document.documentElement.style.background = 'transparent';
          Object.assign(document.body.style, {
            boxSizing: 'border-box', minHeight: '${height}px', borderRadius: '12px' });`,
      });
      await page.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
      const { data } = await page.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: WIDTH, height, scale: 2 },
      });
      await writeFile(join(out, `${shot.name}.png`), Buffer.from(data, 'base64'));
      console.log(`wrote docs/screenshots/${shot.name}.png (${WIDTH}x${height} at 2x)`);
      page.close();
      await browser.send('Target.closeTarget', { targetId });
    }
    for (const shot of STORE) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const { webSocketDebuggerUrl } = (
        await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json())
      ).find((t) => t.id === targetId);
      const page = await connect(webSocketDebuggerUrl);
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.send('Page.navigate', {
        url: `http://127.0.0.1:${port}/__store?shot=${shot.name}`,
      });
      await new Promise((r) => setTimeout(r, 7000));
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(out, `${shot.name}.png`), Buffer.from(data, 'base64'));
      console.log(`wrote docs/screenshots/${shot.name}.png (1280x800)`);
      page.close();
      await browser.send('Target.closeTarget', { targetId });
    }
    browser.close();
  } finally {
    chrome.kill();
  }
}

async function retry(fn, times = 40) {
  for (let i = 0; ; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (i >= times) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

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
