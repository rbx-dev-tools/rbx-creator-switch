// Every experience of every creator, in one searchable list.
//
// There is no server-side search: measured, `universes/v1/search` ignores
// Keyword, SearchQuery, Query and UniverseName, and answers 401 without a
// creator. So finding an experience by name means holding the whole catalogue
// locally, one request per creator.
//
// It is built on demand and kept until asked to refresh, because a list of
// experiences moves far more slowly than the number of times you look for one
// in it. Each creator is written down as it arrives, so a popup closed halfway
// through resumes instead of starting over.

const key = (userId) => `catalog:${userId}`;

// Three at a time. Enough to hide the latency of thirty-odd creators, few
// enough that a popup does not open thirty sockets to Roblox at once.
const CONCURRENCY = 3;

export async function read(userId) {
  const stored = (await chrome.storage.local.get(key(userId)))[key(userId)];
  return stored ?? null;
}

async function save(userId, catalogue) {
  await chrome.storage.local.set({ [key(userId)]: catalogue });
}

/**
 * Walks every creator and records their experiences.
 *
 * `creators` are the rows the creator picker already holds, so the crawl
 * reuses the names and pictures instead of asking for them a second time.
 * `onProgress` is called after each creator, which is what lets the caller
 * show something moving during a crawl that takes a few seconds.
 */
export async function build({ userId, username, creators, call, onProgress }) {
  const existing = (await read(userId)) ?? {};
  const entries = [];
  const done = [];

  const queue = [...creators];
  const worker = async () => {
    for (let creator = queue.shift(); creator; creator = queue.shift()) {
      const [creatorType, creatorTargetId] = creator.value.split(':');
      try {
        const games = await call('listGames', { creatorType, creatorTargetId });
        const images = games.length
          ? await call('images', { kind: 'games', ids: games.map((g) => g.id) })
          : {};
        for (const game of games) {
          entries.push({
            universeId: game.id,
            name: game.name,
            privacyType: game.privacyType,
            imageUrl: images[game.id] ?? null,
            creator: creator.value,
            creatorLabel: creator.label,
            creatorImageUrl: creator.imageUrl ?? null,
          });
        }
      } catch {
        // One creator that refuses is not a reason to lose the other thirty.
        // It simply stays out of the catalogue until the next refresh.
      }
      done.push(creator.value);
      onProgress?.(done.length, creators.length);
      // Written as it goes: a popup closed mid-crawl keeps what it had.
      await save(userId, {
        at: Date.now(),
        username,
        entries,
        partial: done.length < creators.length,
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  const catalogue = { at: Date.now(), username, entries, partial: false };
  await save(userId, catalogue);
  return { ...existing, ...catalogue };
}

/**
 * Matches on the name alone, since that is what the user is typing, and ranks
 * a prefix above a match in the middle: someone typing "pix" wants
 * "Pixel Farm" before "Happy Pixels".
 */
function score(name, needle) {
  const haystack = name.toLowerCase();
  const at = haystack.indexOf(needle);
  if (at === -1) return null;
  return at === 0 ? 0 : 1;
}

/**
 * Searches every catalogue this browser has, not only the active account's.
 *
 * A universe belongs to exactly one creator, so the same name in two creators
 * is two different experiences and both are shown. But two of your accounts
 * can be members of the same group, which lists the same universe twice under
 * different accounts. Those are one destination reached two ways, so they are
 * folded into one row, keeping the account that needs no switch.
 */
export function search(catalogues, activeUserId, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const best = new Map();
  for (const [userId, catalogue] of Object.entries(catalogues)) {
    for (const entry of catalogue.entries ?? []) {
      const rank = score(entry.name, needle);
      if (rank === null) continue;

      const candidate = { ...entry, userId, username: catalogue.username, rank };
      const rival = best.get(entry.universeId);
      if (!rival || (rival.userId !== activeUserId && userId === activeUserId)) {
        best.set(entry.universeId, candidate);
      }
    }
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.userId === activeUserId) - Number(a.userId === activeUserId) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
    .slice(0, 50);
}
