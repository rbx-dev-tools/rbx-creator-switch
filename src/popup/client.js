// Talks to the page. Finds a roblox.com tab, injects the agent, runs one
// request. Nothing here knows what a creator or an experience is.

// The one host this extension is allowed to touch. Declared in the manifest,
// but a declared host permission can be withheld: Chrome lets anyone set an
// extension's site access to "on click" from chrome://extensions, and then
// every injection fails with "Cannot access contents of the page".
const ROBLOX = 'https://*.roblox.com/*';
const HOME = 'https://www.roblox.com/home';

let cachedTabId = null;

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
const isUsable = (tab) => tab && tab.status === 'complete' && !tab.discarded;

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

  const candidates = await chrome.tabs.query({ url: ROBLOX });
  const ready = candidates.find(isUsable);
  if (ready) {
    cachedTabId = ready.id;
    return cachedTabId;
  }

  const asleep = candidates.find((tab) => tab.discarded);
  if (asleep) {
    await chrome.tabs.reload(asleep.id);
    await waitUntilUsable(asleep.id);
    cachedTabId = asleep.id;
    return cachedTabId;
  }

  const loading = candidates.find((tab) => tab.status !== 'complete');
  if (loading) {
    await waitUntilUsable(loading.id);
    cachedTabId = loading.id;
    return cachedTabId;
  }

  const created = await chrome.tabs.create({ url: HOME, active: false });
  await waitUntilUsable(created.id);
  cachedTabId = created.id;
  return cachedTabId;
}

// The agent is re-injected on every call and invoked straight away, so the code
// answering is always the code currently installed. Injecting once and talking
// to it later would let a version left over from before an extension reload
// answer instead, which looks like a working extension returning wrong data.
async function injectAgent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/agent.js'] });
    return tabId;
  } catch (err) {
    // The tab was ready a moment ago and is not any more: it navigated, or it
    // was unloaded between the check and the injection. Worth one clean retry
    // on a tab of our own before giving up, since the popup has no other way
    // to reach the page.
    cachedTabId = null;
    const fallback = await chrome.tabs.create({ url: HOME, active: false });
    await waitUntilUsable(fallback.id);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: fallback.id },
        files: ['src/agent.js'],
      });
      cachedTabId = fallback.id;
      return fallback.id;
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
