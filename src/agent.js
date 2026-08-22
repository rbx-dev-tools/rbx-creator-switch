// Injected into a roblox.com tab. Every call to apis.roblox.com has to happen
// from a page on that origin: the session cookies are HttpOnly, and the account
// switcher blob only exists in www.roblox.com's localStorage.

(() => {
  const API = 'https://apis.roblox.com';
  let csrfToken = null;

  // Roblox answers an unauthenticated POST with 403 and hands back the token in
  // a response header. One retry is enough; the token then lasts the session.
  async function post(path, body) {
    const send = () =>
      fetch(API + path, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify(body),
      });

    let res = await send();
    if (res.status === 403 && res.headers.get('x-csrf-token')) {
      csrfToken = res.headers.get('x-csrf-token');
      res = await send();
    }
    if (!res.ok) throw failure('POST', path, res.status);
    return res.json();
  }

  async function get(path, params) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw failure('GET', path, res.status);
    return res.json();
  }

  // The status line is the only place a popup user reads. A bare "401" there
  // says nothing; what it means is that the session is gone.
  function failure(method, path, status) {
    if (status === 401 || status === 403) {
      return new Error(`${method} ${path} -> ${status}: signed out, or the request was refused`);
    }
    return new Error(`${method} ${path} -> ${status}`);
  }

  // The switcher blob lives on www.roblox.com only. A content script shares the
  // page's storage, so this reads the real thing rather than the copy the
  // Creator Hub receives over postMessage from its hidden iframe.
  function readBlob() {
    const raw = localStorage.getItem('RBXASBlob');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  // Only ever write back a blob that came from a call made with a real one.
  // Calling the endpoint without a blob still answers 200, but with a blob
  // describing the active account alone. Storing that would drop every other
  // signed-in account from the switcher.
  function writeBlob(blob, hadBlob) {
    if (blob && hadBlob) localStorage.setItem('RBXASBlob', JSON.stringify(blob));
  }

  const THUMBS = 'https://thumbnails.roblox.com/v1';

  // One image per id, keyed by target id. Roblox reports a not-yet-rendered
  // image as state "Pending", and a bad id as state "Error" with the grey
  // placeholder URL filled in, so the state is what decides, never the URL.
  // Ids go out in batches of 50, the size the neighbouring endpoints tolerate.
  async function thumbnails(path, param, ids, size) {
    const found = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const url = new URL(`${THUMBS}/${path}`);
      url.searchParams.set(param, ids.slice(i, i + 50).join(','));
      url.searchParams.set('size', size);
      url.searchParams.set('format', 'Png');
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) continue;
        for (const t of (await res.json()).data || []) {
          // The URL ends up inside a CSS url(). Only an https one is worth
          // having; anything else is a surprise from the API, not an image.
          if (t.state === 'Completed' && /^https:\/\//.test(t.imageUrl || '')) {
            found.set(String(t.targetId), t.imageUrl);
          }
        }
      } catch {
        // An image is a nicety. Losing one must not lose the list it decorates.
      }
    }
    return found;
  }

  const handlers = {
    // -> { accounts: [{ userId, username, displayName }], activeUserId }
    async listAccounts() {
      // Cookies alone identify the active account. Without the blob the call
      // still succeeds, it just reports that one account, which is enough to
      // browse creators and experiences but not to switch.
      const blob = readBlob();
      const data = await post('/account-switcher/v1/getLoggedInUsersMetadata', {
        encrypted_users_data_blob: blob || '',
        remove_invalid_active_user: false,
      });
      // The response carries a rotated blob, and the site writes that one back.
      // This is a read, so nothing here needs it: storing it would make this
      // extension a second writer of the switcher state, racing the page over
      // which rotation wins. Reading changes nothing; writing could.
      const accounts = (data.logged_in_users_metadata || []).map((u) => ({
        userId: String(u.user_id),
        username: u.username,
        displayName: u.display_name,
      }));
      return { activeUserId: String(data.active_user_id), canSwitch: Boolean(blob), accounts };
    },

    // The blob rotates on every switch, so the response has to be written back
    // before the page reloads or the next call works from a stale one.
    async switchAccount({ fromUserId, toUserId }) {
      const blob = readBlob();
      if (!blob) throw new Error('no RBXASBlob in this profile: sign in on www.roblox.com first');
      const data = await post('/account-switcher/v1/switch', {
        encrypted_users_data_blob: blob,
        switched_from_user_id: String(fromUserId),
        switched_to_user_id: String(toUserId),
      });
      if (data.errors) throw new Error(JSON.stringify(data.errors));
      writeBlob(data.encrypted_users_data_blob, true);
      return { ok: true };
    },

    // -> [{ id, name, roleSetName, imageUrl }] for the groups the active
    // account can create under. The endpoint carries no image of its own.
    async listGroups() {
      const { groups = [] } = await get('/creator-home-api/v1/groups', { surface: 'CreatorHub' });
      return (
        groups
          .map((g) => ({
            id: String(g.id),
            name: g.name,
            roleSetName: g.roleSetName,
          }))
          // The endpoint happens to answer in alphabetical order today, which is
          // the order a picker of 34 groups wants. Sorting here means the popup
          // keeps that order the day the endpoint stops bothering.
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      );
    },

    // creatorType is 'User' or 'Group'; creatorTargetId the user id or group id.
    // -> [{ id, name, rootPlaceId, privacyType, imageUrl }]
    //
    // The endpoint pages, and the dashboard walks the pages by incrementing
    // PageIndex. A creator with more than one page of experiences would
    // otherwise lose the rest silently, from the picker and from the search
    // catalogue alike.
    //
    // The walk stops when `totalResults` says everything is in, or on a page
    // shorter than asked, with a hard ceiling in case the endpoint ever
    // answers full pages forever. Only the first page is allowed to fail the
    // call: this endpoint answers 401 to a request it dislikes, a page past
    // the end included, and a refused second page must not throw away the
    // first one.
    async listGames({ creatorType, creatorTargetId, isArchived = false }) {
      const PAGE = 50;
      const MAX_PAGES = 40;
      const all = [];
      for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
        let page;
        try {
          page = await get('/universes/v1/search', {
            CreatorType: creatorType,
            CreatorTargetId: String(creatorTargetId),
            Surface: 'CreatorHubCreations',
            PageSize: PAGE,
            PageIndex: pageIndex,
            IsArchived: isArchived,
            SortParam: 'LastUpdated',
            SortOrder: 'Desc',
            NeedsAssetOptions: true,
          });
        } catch (err) {
          if (pageIndex === 0) throw err;
          break;
        }
        const data = page.data || [];
        all.push(...data);
        if (data.length < PAGE) break;
        if (Number.isInteger(page.totalResults) && all.length >= page.totalResults) break;
      }
      // SortParam above asks for most recently updated first, which is the
      // useful order for a list of things you are working on, and unlike the
      // groups it is the server that applies it.
      return all.map((u) => ({
        id: String(u.id),
        name: u.name,
        rootPlaceId: u.rootPlaceId,
        privacyType: u.privacyType,
      }));
    },

    // Pictures are asked for separately so a list never waits on them. The
    // popup paints names as soon as it has them and fills the frames after.
    // -> { "<id>": "<url>" } for the ids that have a rendered image
    async images({ kind, ids }) {
      const source = {
        accounts: ['users/avatar-headshot', 'userIds', '48x48'],
        groups: ['groups/icons', 'groupIds', '150x150'],
        games: ['games/icons', 'universeIds', '128x128'],
      }[kind];
      if (!source) throw new Error(`unknown image kind: ${kind}`);
      return Object.fromEntries(await thumbnails(...source.slice(0, 2), ids, source[2]));
    },
  };

  // Overwritten by every injection, and the popup calls it in the same breath
  // it injects this file. There is deliberately no long-lived message listener:
  // one left behind by an earlier version of the extension would keep answering
  // with the shapes it used to return, and a stale answer is harder to notice
  // than no answer at all.
  window.__rbxCreatorSwitchAgent = async (type, payload) => {
    const handler = handlers[type];
    if (!handler) throw new Error(`unknown request: ${type}`);
    return handler(payload || {});
  };
})();
