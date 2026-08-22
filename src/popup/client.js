// Talks to the page. Finds a roblox.com tab, injects the agent, runs one
// request. Nothing here knows what a creator or an experience is.

// The one host this extension is allowed to touch. Declared in the manifest,
// but a declared host permission can be withheld: Chrome lets anyone set an
// extension's site access to "on click" from chrome://extensions, and then
// every injection fails with "Cannot access contents of the page".
const ROBLOX = 'https://*.roblox.com/*';
const HOME = 'https://www.roblox.com/home';
// The isolated world is Chrome's default, and it is also a security property:
// the page's own scripts cannot see or call `__rbxCreatorSwitchAgent`, and
// cannot redefine `fetch` under it. Spelled out so that it stays a decision
// rather than a default nobody remembers relying on.
const WORLD = 'ISOLATED';

let cachedTabId = null;

// The tab this popup opened for itself, if any. It is closed when the popup
// goes away: a tab nobody asked for, left behind every time the popup is used
// without a roblox.com tab open, is the kind of thing people file issues over.
let ownTabId = null;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Asks for the host back when it has been withheld. Opening the popup is a
// user gesture, which is what makes the prompt allowed here, and a permission
// already granted resolves without showing anything.
async function ensureHostAccess() {
  if (await chrome.permissions.contains({ origins: [ROBLOX] })) return;

  const granted = await chrome.permissions.request({ origins: [ROBLOX] });
  if (!granted) {
    throw new Error('access to roblox.com is off: set site access to "On all sites"');
  }
}

// A tab is only usable once its document is the roblox.com one. `tab.url` is
// not that proof: it shows where a tab is going, so a tab still committing its
// navigation, or one Chrome unloaded to save memory, advertises roblox.com
// while the live document is still about:blank. Injecting there fails with a
// permission error naming a host the extension does in fact have.
export const isUsable = (tab) => Boolean(tab && tab.status === 'complete' && !tab.discarded);

// Which of the roblox.com tabs to use, and what it needs first. Pure, so the
// order of preference is testable without a browser: a tab that is ready
// now, then one Chrome unloaded (a reload away), then one still loading (a
// wait away), and nothing when a new tab is the only option.
export function pickTab(candidates) {
  const ready = candidates.find(isUsable);
  if (ready) return { tab: ready, action: 'use' };
  const asleep = candidates.find((tab) => tab.discarded);
  if (asleep) return { tab: asleep, action: 'reload' };
  const loading = candidates.find((tab) => tab.status !== 'complete');
  if (loading) return { tab: loading, action: 'wait' };
  return { tab: null, action: 'create' };
}

async function waitUntilUsable(tabId, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('the roblox.com tab went away');
    if (isUsable(tab)) return tab;
    if (Date.now() > deadline) {
      throw new Error(`roblox.com is still ${tab.discarded ? 'unloaded' : tab.status}`);
    }
    await wait(150);
  }
}

// Prefers a tab that is ready right now, wakes a sleeping one, and only opens
// its own when there is nothing to work with.
async function robloxTab() {
  if (cachedTabId !== null) return cachedTabId;

  const { tab, action } = pickTab(await chrome.tabs.query({ url: ROBLOX }));
  if (action === 'use') {
    cachedTabId = tab.id;
  } else if (action === 'reload') {
    await chrome.tabs.reload(tab.id);
    await waitUntilUsable(tab.id);
    cachedTabId = tab.id;
  } else if (action === 'wait') {
    await waitUntilUsable(tab.id);
    cachedTabId = tab.id;
  } else {
    cachedTabId = await openOwnTab();
  }
  return cachedTabId;
}

async function openOwnTab() {
  const created = await chrome.tabs.create({ url: HOME, active: false });
  ownTabId = created.id;
  await waitUntilUsable(created.id);
  return created.id;
}

// pagehide is the one event a closing popup reliably fires, and by then the
// document is on its way out: a promise chain started here never gets its
// continuation, so the removal has to be a single call, sent and forgotten.
// Measured: tabs.get(id).then(remove) left the tab open every time.
//
// A tab the user has since brought to the front is theirs now. Activating it
// is what closes the popup, so the event lands before pagehide does, and
// forgetting the id then is what keeps that tab alive.
chrome.tabs?.onActivated?.addListener(({ tabId }) => {
  if (tabId === ownTabId) ownTabId = null;
});
globalThis.addEventListener?.('pagehide', () => {
  if (ownTabId === null) return;
  chrome.tabs.remove(ownTabId).catch(() => {
    // Already gone, which is the outcome wanted.
  });
  ownTabId = null;
});

// The agent is re-injected on every call and invoked straight away, so the code
// answering is always the code currently installed. Injecting once and talking
// to it later would let a version left over from before an extension reload
// answer instead, which looks like a working extension returning wrong data.
async function injectAgent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/agent.js'],
      world: WORLD,
    });
    return tabId;
  } catch (err) {
    // The tab was ready a moment ago and is not any more: it navigated, or it
    // was unloaded between the check and the injection. Worth one clean retry
    // on a tab of our own before giving up, since the popup has no other way
    // to reach the page.
    cachedTabId = null;
    const fallbackId = await openOwnTab();
    try {
      await chrome.scripting.executeScript({
        target: { tabId: fallbackId },
        files: ['src/agent.js'],
        world: WORLD,
      });
      cachedTabId = fallbackId;
      return fallbackId;
    } catch (retryError) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      throw new Error(
        `cannot reach ${tab ? tab.url : 'the tab'} (${tab ? tab.status : 'gone'}${
          tab && tab.discarded ? ', unloaded' : ''
        }): ${err.message}`,
        { cause: retryError }
      );
    }
  }
}

export async function call(type, payload) {
  await ensureHostAccess();

  const tabId = await injectAgent(await robloxTab());
  const [outcome] = await chrome.scripting.executeScript({
    target: { tabId },
    world: WORLD,
    func: (t, p) =>
      window.__rbxCreatorSwitchAgent(t, p).then(
        (data) => ({ ok: true, data }),
        (err) => ({ ok: false, error: String(err && err.message ? err.message : err) })
      ),
    args: [type, payload || {}],
  });

  const res = outcome && outcome.result;
  if (!res || !res.ok) throw new Error((res && res.error) || 'the agent did not answer');
  return res.data;
}
