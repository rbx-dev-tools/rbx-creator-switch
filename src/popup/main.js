// Wires the three pickers together: an account owns creators, a creator owns
// experiences. Every step that talks to Roblox goes through client.js, every
// step that draws goes through Picker.

import { call } from './client.js';
import { Picker } from './picker.js';
import { peek, refresh, same, remember } from './cache.js';
import { status, guard } from './status.js';
import { mountThemeToggle } from './theme.js';
import { Search } from './search.js';
import * as catalog from './catalog.js';

const openButton = document.getElementById('open');
let activeUserId = null;

// Every catalogue this browser holds, keyed by account. Search reads all of
// them, not only the active one, so an experience under the other account is
// findable without switching first to discover it exists.
const catalogues = {};

const account = new Picker('account', guard(onAccountPicked));
const creator = new Picker('creator', guard(onCreatorPicked));
const game = new Picker('game', () => {
  openButton.disabled = !game.value;
});

const search = new Search(document.getElementById('search'), {
  onPick: guard(goTo),
  onRefresh: guard(() => buildCatalog({ force: true })),
  onExpand: () => {
    for (const picker of Picker.group) picker.open(false);
  },
});

// The other half of the same rule: a picker taking the floor puts the search
// results away. Two floating panels open at once overlap, and the one you did
// not just act on is the one in the way.
Picker.onOpen = () => search.collapse();
search.finder = (query) => catalog.search(catalogues, activeUserId, query);

async function loadAccounts() {
  status.say('reading the signed-in accounts');
  const { accounts, activeUserId: active, canSwitch } = await call('listAccounts');
  activeUserId = active;

  account.fill(
    accounts.map((a) => ({
      value: a.userId,
      label: a.displayName,
      sub: '@' + a.username,
    })),
    'not signed in'
  );

  if (accounts.length === 0) {
    status.say('sign in on roblox.com, then reopen this');
    return;
  }

  account.select(active);
  // Without the switcher blob the API only knows the account the cookies name,
  // so offering a switch would be a button that cannot work.
  account.button.disabled = !canSwitch || accounts.length < 2;
  status.clear();

  // Not awaited: the creator list is what the user is waiting for, and a face
  // arriving a moment later costs nothing. The creator picker gets the same
  // faces: its "My creations" row is keyed by the user id, and on a cold
  // cache it is drawn before this answer lands.
  paintImages(
    'accounts',
    accounts.map((a) => a.userId),
    [account, creator]
  );
  await loadCreators();
}

// Fills in the pictures of a list already on screen, and remembers the
// enriched list so the next open paints them at once.
async function paintImages(kind, ids, pickers, cacheKey) {
  if (ids.length === 0) return;
  try {
    const urls = await call('images', { kind, ids });
    let changed = false;
    for (const picker of [pickers].flat()) changed = picker.updateImages(urls) || changed;
    if (!changed || !cacheKey) return;
    await remember(cacheKey.kind, cacheKey.scope, cacheKey.value(urls));
  } catch {
    // A picture is a nicety. Losing one must not disturb the list it decorates.
  }
}

async function onAccountPicked(userId) {
  if (userId === activeUserId) return;
  const previous = activeUserId;
  activeUserId = userId;
  status.say('switching account');

  // The target account's creator list is already cached under its own key, so
  // it can go up now rather than after the switch returns. Nothing is fetched
  // here: a request made before the switch lands would be answered for the
  // account being left.
  const cached = await peek('groups', userId);
  if (cached) renderCreators(cached);

  try {
    await call('switchAccount', { fromUserId: previous, toUserId: userId });
  } catch (err) {
    activeUserId = previous;
    account.select(previous);
    throw err;
  }

  await loadCreators();
}

function renderCreators(list) {
  const me = account.selected;
  creator.fill(
    [
      {
        value: `User:${activeUserId}`,
        imageKey: activeUserId,
        label: 'My creations',
        sub: me && me.sub,
        imageUrl: me && me.imageUrl,
      },
    ].concat(
      list.map((g) => ({
        value: `Group:${g.id}`,
        imageKey: g.id,
        label: g.name,
        sub: g.roleSetName,
        imageUrl: g.imageUrl,
      }))
    ),
    'no creator'
  );
}

// Paints what is known and moves on. The refresh runs behind, and a late
// answer only repaints if it differs, so the experiences below do not wait on
// a group list this popup already had.
async function loadCreators() {
  const forAccount = activeUserId;
  const cached = await peek('groups', forAccount);
  if (cached) renderCreators(cached);
  else status.say('reading the groups');

  const pending = refresh('groups', forAccount, () => call('listGroups')).then((list) => {
    // The account may have changed while this was in flight.
    if (activeUserId !== forAccount) return list;
    if (!cached || !same(cached, list)) renderCreators(list);
    paintImages(
      'groups',
      list.map((g) => g.id),
      creator,
      {
        kind: 'groups',
        scope: forAccount,
        value: (urls) => list.map((g) => ({ ...g, imageUrl: urls[g.id] ?? g.imageUrl ?? null })),
      }
    );
    return list;
  });

  status.clear();
  // Experiences follow the creator on screen. With a cached list that is now;
  // without one there is no creator yet, so it has to wait for the answer.
  // And a fresh answer can move the selection (a group left, a first open),
  // in which case the experiences have to follow again. Measured on a cold
  // cache: skipping the second call left "pick a creator" on screen forever.
  const before = creator.value;
  if (before) await loadGames();
  await pending;
  if (activeUserId === forAccount && creator.value !== before) await loadGames();
  await loadCatalogues();
  await buildCatalog();
}

async function onCreatorPicked() {
  await loadGames();
}

function renderGames(list) {
  game.fill(
    list.map((g) => ({
      value: g.id,
      label: g.name,
      sub: g.privacyType,
      imageUrl: g.imageUrl,
    })),
    'no experience'
  );
  openButton.disabled = list.length === 0;
}

async function loadGames() {
  if (!creator.value) return;
  const scope = creator.value;
  const [creatorType, creatorTargetId] = scope.split(':');

  const cached = await peek('games', scope);
  if (cached) renderGames(cached);
  else status.say('reading the experiences');

  const games = await refresh('games', scope, () =>
    call('listGames', { creatorType, creatorTargetId })
  );
  // The creator may have changed while this was in flight.
  if (creator.value !== scope) return;

  if (!cached || !same(cached, games)) renderGames(games);
  status.say(games.length ? '' : 'this creator has no experience');
  paintImages(
    'games',
    games.map((g) => g.id),
    game,
    {
      kind: 'games',
      scope,
      value: (urls) => games.map((g) => ({ ...g, imageUrl: urls[g.id] ?? g.imageUrl ?? null })),
    }
  );
}

// --- search --------------------------------------------------------------

async function loadCatalogues() {
  for (const row of account.rows) {
    const stored = await catalog.read(row.value);
    if (stored) catalogues[row.value] = stored;
  }
  search.activeUserId = activeUserId;
}

// The crawl costs one request per creator, so it is never automatic. It runs
// when the refresh button is pressed, or once when there is nothing to search
// at all, since a search field that can only answer "nothing by that name" is
// worse than one that says it is filling up.
//
// One crawl at a time. The refresh button pressed twice, or pressed while the
// first automatic crawl runs, would otherwise start two crawls writing the
// same key in turns, each overwriting the other's progress.
let crawling = null;

function buildCatalog({ force = false } = {}) {
  if (crawling) return crawling;
  const known = catalogues[activeUserId];
  if (known && !known.partial && !force) return Promise.resolve();
  if (creator.rows.length === 0) return Promise.resolve();

  const me = account.selected;
  const userId = activeUserId;
  search.busy('indexing...');
  crawling = catalog
    .build({
      userId,
      username: me ? me.sub.replace('@', '') : '',
      creators: creator.rows,
      call,
      onProgress: (done, total) => search.busy(`indexing ${done}/${total}`),
    })
    .then((built) => {
      catalogues[userId] = built;
    })
    .finally(() => {
      crawling = null;
      search.busy(null);
    });
  return crawling;
}

// A search result is a whole (account, creator, experience) triple, so acting
// on one means setting all three, in that order, since each depends on the one
// before it.
async function goTo(match) {
  if (match.userId !== activeUserId) {
    account.select(match.userId);
    await onAccountPicked(match.userId);
  }
  creator.select(match.creator);

  // The catalogue already holds everything this row needs, so the destination
  // is shown at once instead of after the creator's whole list comes back. The
  // full list arrives behind and keeps this selection, since a picker refilled
  // with the same value stays on it.
  renderGames([
    {
      id: match.universeId,
      name: match.name,
      privacyType: match.privacyType,
      imageUrl: match.imageUrl,
    },
  ]);
  game.select(match.universeId);
  openButton.disabled = false;
  status.say(`${match.name} in ${match.creatorLabel}`);

  loadGames().catch(() => {
    // The row is already on screen and openable. A failure to fill in its
    // neighbours is not worth an error line over it.
  });
}

// A click anywhere else closes whatever is open, the way a real dropdown does.
document.addEventListener('click', (event) => {
  // Reaching for the search field puts the pickers away, whether or not the
  // field ends up focused: a click is the gesture, focus is only its usual
  // consequence.
  if (event.target.closest('.search')) {
    for (const picker of Picker.group) picker.open(false);
    return;
  }
  search.clear();
  if (!event.target.closest('.picker')) for (const picker of Picker.group) picker.open(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const picker of Picker.group) picker.open(false);
});

// Navigating the Creator Hub tab you are already looking at, rather than
// opening a second one beside it. A tab on another site is left alone, and so
// is one whose URL is unreadable, which is what a tab outside roblox.com looks
// like from here: without host permission for it, `url` simply is not there.
openButton.addEventListener(
  'click',
  guard(async () => {
    if (!game.value) return;
    const url = `https://create.roblox.com/dashboard/creations/experiences/${game.value}/overview`;

    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current?.url?.startsWith('https://create.roblox.com/')) {
      await chrome.tabs.update(current.id, { url });
      window.close();
      return;
    }
    await chrome.tabs.create({ url });
  })
);

mountThemeToggle(document.getElementById('theme'));
// The fastest path through this popup is to open it, type a name and press
// Enter, so the cursor starts where that path begins.
search.input.focus();
guard(loadAccounts)();
