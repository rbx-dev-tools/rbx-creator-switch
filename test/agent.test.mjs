// The agent is the only code that talks to Roblox, and the only code that
// touches the account switcher blob. These tests pin the rules that would be
// expensive to relearn from a bug report: one CSRF retry, pages walked to the
// end, the blob written back only after a switch, and the shapes the popup
// relies on.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// agent.js is an IIFE written for a page. It needs a window to hang its entry
// point on, a localStorage for the blob, and a fetch to talk through. All
// three are stood up here before the import, then swapped per test.
const storage = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
};

let requests = [];
let respond = () => json({});

const json = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
});

globalThis.fetch = async (url, init = {}) => {
  const request = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
  requests.push(request);
  return respond(request);
};

await import('../src/agent.js');
const agent = globalThis.__rbxCreatorSwitchAgent;

beforeEach(() => {
  storage.clear();
  requests = [];
  respond = () => json({});
});

test('an unknown request is refused rather than answered with nothing', async () => {
  await assert.rejects(agent('nope'), /unknown request/);
});

// --- CSRF -----------------------------------------------------------------

test('a 403 carrying a token is retried once with that token', async () => {
  let calls = 0;
  respond = ({ init }) => {
    calls += 1;
    if (!init.headers['x-csrf-token']) {
      return json({}, { status: 403, headers: { 'x-csrf-token': 'tok' } });
    }
    return json({ logged_in_users_metadata: [], active_user_id: 1 });
  };

  await agent('listAccounts');
  assert.equal(calls, 2);
  assert.equal(requests[1].init.headers['x-csrf-token'], 'tok');
});

test('a 401 is reported as a missing session, not as a number', async () => {
  respond = () => json({}, { status: 401 });
  await assert.rejects(agent('listAccounts'), /signed out/);
});

// --- accounts and the blob ----------------------------------------------

test('listAccounts maps the metadata and reports whether a switch is possible', async () => {
  respond = () =>
    json({
      active_user_id: 7,
      logged_in_users_metadata: [
        { user_id: 7, username: 'me', display_name: 'Me' },
        { user_id: 8, username: 'alt', display_name: 'Alt' },
      ],
      encrypted_users_data_blob: 'rotated',
    });

  const noBlob = await agent('listAccounts');
  assert.equal(noBlob.activeUserId, '7', 'ids are strings throughout');
  assert.equal(noBlob.canSwitch, false, 'without the blob there is nothing to switch with');
  assert.deepEqual(noBlob.accounts[1], { userId: '8', username: 'alt', displayName: 'Alt' });
  assert.equal(storage.has('RBXASBlob'), false, 'a read never writes the blob');

  storage.set('RBXASBlob', JSON.stringify('real'));
  const withBlob = await agent('listAccounts');
  assert.equal(withBlob.canSwitch, true);
  assert.equal(requests.at(-1).body.encrypted_users_data_blob, 'real');
  assert.equal(storage.get('RBXASBlob'), JSON.stringify('real'), 'and still never writes it');
});

test('switchAccount refuses without a blob, and writes the rotated one back after', async () => {
  await assert.rejects(agent('switchAccount', { fromUserId: 7, toUserId: 8 }), /no RBXASBlob/);
  assert.equal(requests.length, 0, 'nothing was sent');

  storage.set('RBXASBlob', JSON.stringify('before'));
  respond = () => json({ encrypted_users_data_blob: 'after', errors: null });
  await agent('switchAccount', { fromUserId: 7, toUserId: 8 });

  const sent = requests[0].body;
  assert.equal(sent.encrypted_users_data_blob, 'before');
  assert.equal(sent.switched_from_user_id, '7');
  assert.equal(sent.switched_to_user_id, '8');
  assert.equal(storage.get('RBXASBlob'), JSON.stringify('after'), 'the rotation is kept');
});

test('a switch the server rejects leaves the blob alone', async () => {
  storage.set('RBXASBlob', JSON.stringify('before'));
  respond = () => json({ encrypted_users_data_blob: 'short', errors: [{ code: 1 }] });

  await assert.rejects(agent('switchAccount', { fromUserId: 7, toUserId: 8 }));
  assert.equal(storage.get('RBXASBlob'), JSON.stringify('before'));
});

// --- groups ---------------------------------------------------------------

test('listGroups sorts by name whatever order the endpoint answers in', async () => {
  respond = () =>
    json({
      groups: [
        { id: 2, name: 'zeta', roleSetName: 'Owner' },
        { id: 1, name: 'Alpha', roleSetName: 'Member' },
      ],
    });

  const groups = await agent('listGroups');
  assert.deepEqual(
    groups.map((g) => g.name),
    ['Alpha', 'zeta']
  );
  assert.deepEqual(groups[0], { id: '1', name: 'Alpha', roleSetName: 'Member' });
});

// --- games and pages -----------------------------------------------------

test('listGames walks every page until a short one', async () => {
  const page = (n, size) =>
    Array.from({ length: size }, (_, i) => ({
      id: n * 100 + i,
      name: `g${n}-${i}`,
      rootPlaceId: 1,
      privacyType: 'Public',
    }));
  respond = ({ url }) => {
    const index = Number(new URL(url).searchParams.get('PageIndex'));
    return json({ data: [page(0, 50), page(1, 50), page(2, 3)][index] ?? [] });
  };

  const games = await agent('listGames', { creatorType: 'Group', creatorTargetId: 9 });
  assert.equal(games.length, 103, 'nothing past the first page is lost');
  assert.equal(requests.length, 3, 'and the walk stops at the short page');
  assert.deepEqual(games[0], { id: '0', name: 'g0-0', rootPlaceId: 1, privacyType: 'Public' });

  const first = new URL(requests[0].url).searchParams;
  assert.equal(first.get('CreatorType'), 'Group');
  assert.equal(first.get('CreatorTargetId'), '9');
  assert.equal(first.get('PageSize'), '50');
});

test('listGames stops when totalResults says the list is complete', async () => {
  respond = () =>
    json({ data: Array.from({ length: 50 }, (_, i) => ({ id: i })), totalResults: 50 });
  const games = await agent('listGames', { creatorType: 'User', creatorTargetId: 1 });
  assert.equal(games.length, 50);
  assert.equal(requests.length, 1, 'a full page that is also the whole list asks for no more');
});

test('a refused later page keeps the pages before it', async () => {
  respond = ({ url }) => {
    const index = Number(new URL(url).searchParams.get('PageIndex'));
    if (index > 0) return json({}, { status: 401 });
    return json({ data: Array.from({ length: 50 }, (_, i) => ({ id: i })) });
  };
  const games = await agent('listGames', { creatorType: 'Group', creatorTargetId: 1 });
  assert.equal(games.length, 50, 'the first page is not lost to the second');
});

test('a refused first page is still an error', async () => {
  respond = () => json({}, { status: 401 });
  await assert.rejects(agent('listGames', { creatorType: 'Group', creatorTargetId: 1 }), /401/);
});

test('listGames stops on a hard ceiling if the endpoint never runs dry', async () => {
  respond = () => json({ data: Array.from({ length: 50 }, (_, i) => ({ id: i })) });
  await agent('listGames', { creatorType: 'User', creatorTargetId: 1 });
  assert.ok(requests.length < 100, `${requests.length} requests is not a bounded walk`);
});

// --- images ---------------------------------------------------------------

test('images keeps only rendered https pictures, batched by fifty', async () => {
  respond = ({ url }) => {
    const ids = new URL(url).searchParams.get('universeIds').split(',');
    return json({
      data: ids.map((id) => ({
        targetId: Number(id),
        state: id === '1' ? 'Pending' : id === '2' ? 'Error' : 'Completed',
        imageUrl: id === '3' ? 'http://plain.example/x.png' : `https://cdn.example/${id}.png`,
      })),
    });
  };

  const ids = Array.from({ length: 60 }, (_, i) => String(i));
  const urls = await agent('images', { kind: 'games', ids });

  assert.equal(requests.length, 2, 'sixty ids is two batches');
  assert.equal(urls['1'], undefined, 'a pending image is not an image yet');
  assert.equal(urls['2'], undefined, 'an errored one never will be');
  assert.equal(urls['3'], undefined, 'and a non-https URL is not trusted into a CSS url()');
  assert.equal(urls['4'], 'https://cdn.example/4.png');
});

test('an image batch that fails loses the pictures, not the call', async () => {
  respond = () => {
    throw new Error('network');
  };
  assert.deepEqual(await agent('images', { kind: 'groups', ids: ['1'] }), {});
});

test('an unknown image kind is an error, not an empty answer', async () => {
  await assert.rejects(agent('images', { kind: 'planets', ids: ['1'] }), /unknown image kind/);
});
