// What the popup already knew, so opening it shows something at once instead
// of three spinners.
//
// Two operations, deliberately separate. `peek` answers from storage and never
// touches the network; `refresh` fetches and stores. Keeping them apart is what
// lets the caller paint immediately and carry on to the next step, instead of
// awaiting a request whose answer it already has a usable version of. Bundling
// them into one "paint then await" helper is how the popup ended up spending
// half a second on a switch where every list was already cached.
//
// The cache still decides only what is painted first, never what is fetched:
// every peek is followed by a refresh, so an icon its owner changed this
// morning appears on this very open, right after the stale one.
//
// The lifetimes below are an upper bound on how stale a first paint may be,
// which matters when the network is slow or the request fails, not a window
// during which changes are ignored.

const TTL = {
  // A group you belong to is a fact about the account, not about the moment.
  groups: 24 * 60 * 60 * 1000,
  // Experiences move more: one created a minute ago should not be missing
  // from the first paint for long.
  games: 60 * 60 * 1000,
};

// The account is part of the key: two accounts must never read each other's
// lists out of a shared cache. Icons need no key of their own, they travel
// inside the list that names them.
const keyFor = (kind, scope) => `cache:${kind}:${scope}`;

const write = (kind, scope, value) =>
  chrome.storage.local.set({ [keyFor(kind, scope)]: { at: Date.now(), value } });

/** The stored answer, or null. Never fetches. */
export async function peek(kind, scope) {
  const key = keyFor(kind, scope);
  const stored = (await chrome.storage.local.get(key))[key];
  if (!stored) return null;
  if (Date.now() - stored.at > TTL[kind]) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return stored.value;
}

/** The real answer, stored on the way out. */
export async function refresh(kind, scope, fetcher) {
  const fresh = await fetcher();
  await write(kind, scope, fresh);
  return fresh;
}

/** True when two answers differ, so a second paint can be skipped. */
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Pictures land after the list they belong to. Storing the enriched version
// means the next open paints them immediately instead of repeating the wait.
export async function remember(kind, scope, value) {
  await write(kind, scope, value);
}
