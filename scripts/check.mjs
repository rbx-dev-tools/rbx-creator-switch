// Checks that the extension holds together before a browser is asked to load
// it. A moved file, a stale path in the manifest or in an injection call is
// invisible to a linter and shows up as ERR_FILE_NOT_FOUND at the worst moment.
//
//   node scripts/check.mjs

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (message) => failures.push(message);
const read = (path) => readFileSync(join(root, path), 'utf8');
const exists = (path) => existsSync(join(root, path));

// Paths end up compared as strings, so they have to agree on a separator. The
// manifest and the injection calls always use forward slashes; join does not,
// on Windows.
const slash = (path) => path.split(sep).join('/');

// Every path the browser will be asked to load, gathered from the places that
// can name one. Kept as a set so an unreferenced file can be spotted after.
const referenced = new Set();

function requireFile(path, why) {
  const normalised = slash(path);
  referenced.add(normalised);
  if (!exists(normalised)) fail(`${why} points at ${normalised}, which does not exist`);
}

function walk(dir) {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    return statSync(path).isDirectory()
      ? walk(relative(root, path))
      : [slash(relative(root, path))];
  });
}

// --- manifest -------------------------------------------------------------

let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
} catch (err) {
  fail(`manifest.json does not parse: ${err.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? '')) {
    fail(`manifest version ${manifest.version} is not x.y.z`);
  }

  const popup = manifest.action?.default_popup;
  if (!popup) fail('manifest declares no action.default_popup');
  else requireFile(popup, 'manifest action.default_popup');

  // Icons are the one asset a browser fails on quietly: a missing file gives a
  // grey puzzle piece rather than an error anyone would look for.
  for (const [size, path] of Object.entries(manifest.icons ?? {})) {
    requireFile(path, `manifest icons.${size}`);
  }
  for (const [size, path] of Object.entries(manifest.action?.default_icon ?? {})) {
    requireFile(path, `manifest action.default_icon.${size}`);
  }

  for (const script of manifest.content_scripts ?? []) {
    for (const file of script.js ?? []) requireFile(file, 'a content_scripts entry');
  }
  if (manifest.background?.service_worker) {
    requireFile(manifest.background.service_worker, 'manifest background.service_worker');
  }

  // A permission nothing uses is a permission a reviewer has to ask about, and
  // one more line in what the browser tells the user this extension may do.
  const sources = walk('src').map(read).join('\n');
  for (const permission of manifest.permissions ?? []) {
    if (!sources.includes(`chrome.${permission}.`)) {
      fail(`permission "${permission}" is declared but chrome.${permission} is never called`);
    }
  }

  const pkg = JSON.parse(read('package.json'));
  if (pkg.version && pkg.version !== manifest.version) {
    fail(`package.json version ${pkg.version} disagrees with manifest ${manifest.version}`);
  }
}

// --- what the popup pulls in ---------------------------------------------

const popupPath = manifest?.action?.default_popup;
if (popupPath && exists(popupPath)) {
  const popupDir = dirname(popupPath);
  for (const [, attribute] of read(popupPath).matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^[a-z]+:/i.test(attribute) || attribute.startsWith('//')) continue;
    requireFile(join(popupDir, attribute), popupPath);
  }
}

// Module imports, walked transitively from whatever the popup loaded.
function followImports(path) {
  if (!exists(path)) return;
  for (const [, spec] of read(path).matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = slash(join(dirname(path), spec));
    if (referenced.has(target)) continue;
    requireFile(target, `an import in ${path}`);
    followImports(target);
  }
}
for (const entry of [...referenced].filter((path) => path.endsWith('.js'))) followImports(entry);

// --- what gets injected at runtime ---------------------------------------

// chrome.scripting.executeScript names its files as plain strings, so nothing
// but a check like this one connects them to the filesystem.
for (const source of [...walk('src'), ...walk('scripts')]) {
  for (const [, list] of read(source).matchAll(/files:\s*\[([^\]]+)\]/g)) {
    for (const [, file] of list.matchAll(/['"]([^'"]+)['"]/g)) {
      requireFile(file, `an injection in ${source}`);
    }
  }
}

// --- hosts ----------------------------------------------------------------

// Every host the shipped code names must be one the manifest allows, or the
// request fails in the browser with a CORS error nothing here would predict.
// And the README and SECURITY.md each promise a complete list of those hosts,
// so they are held to it: a host added to the code without a line in the docs,
// or a host in the docs the code stopped calling, fails here. Those two lists
// drifted once already.
if (manifest) {
  const hostPatterns = (manifest.host_permissions ?? []).map(
    (pattern) =>
      new RegExp(
        '^' +
          pattern
            .replaceAll('.', String.raw`\.`)
            .replace(/\*/g, '.*')
            .replace(/\/$/, '')
      )
  );
  const hosts = new Set();
  for (const source of walk('src')) {
    for (const [, host] of read(source).matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]+)/gi)) {
      hosts.add(host.toLowerCase());
    }
  }
  for (const host of hosts) {
    if (!hostPatterns.some((pattern) => pattern.test(`https://${host}/`))) {
      fail(`src names https://${host} but no host_permissions entry allows it`);
    }
  }
  for (const doc of ['README.md', 'SECURITY.md']) {
    const text = read(doc);
    for (const host of hosts) {
      if (!text.includes(`\`${host}\``)) fail(`${doc} does not list \`${host}\``);
    }
    for (const [, host] of text.matchAll(/`([a-z0-9-]+\.roblox\.com)`/g)) {
      if (!hosts.has(host)) fail(`${doc} lists \`${host}\`, which nothing in src calls`);
    }
  }

  // The manifest's floor has to cover the newest API the code relies on.
  // executeScript's `world` option is the current high-water mark (Chrome 95).
  const floor = Number(manifest.minimum_chrome_version ?? 0);
  if (!(floor >= 95)) fail(`minimum_chrome_version ${manifest.minimum_chrome_version} is below 95`);
}

// --- files nobody asks for ------------------------------------------------

for (const file of [...walk('src'), ...walk('icons')]) {
  // The SVG is the source the PNGs are rendered from, kept beside them on
  // purpose rather than referenced by the manifest.
  if (file.endsWith('.svg')) continue;
  if (!referenced.has(file)) fail(`${file} is shipped but nothing references it`);
}

// --- report ---------------------------------------------------------------

if (failures.length) {
  console.error(`check failed:\n${failures.map((line) => `  - ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('check passed: manifest, popup, imports and injections all resolve');
