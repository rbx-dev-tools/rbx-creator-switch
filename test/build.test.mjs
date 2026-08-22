// The crawl side of the catalogue: what it writes as it goes, and what it
// keeps when a creator refuses to answer.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return store.has(key) ? { [key]: store.get(key) } : {};
      },
      async set(entries) {
        for (const [key, value] of Object.entries(entries)) store.set(key, value);
      },
    },
  },
};

const { build, read } = await import('../src/popup/catalog.js');

beforeEach(() => store.clear());

const creators = [
  { value: 'User:1', label: 'My creations', imageUrl: 'me.png' },
  { value: 'Group:2', label: 'Studio', imageUrl: null },
];

const fakeCall = (gamesByCreator) => async (type, payload) => {
  if (type === 'listGames') {
    const games = gamesByCreator[`${payload.creatorType}:${payload.creatorTargetId}`];
    if (games instanceof Error) throw games;
    return games;
  }
  if (type === 'images') return Object.fromEntries(payload.ids.map((id) => [id, `${id}.png`]));
  throw new Error(`unexpected call ${type}`);
};

test('every creator is walked and each entry knows where it came from', async () => {
  const progress = [];
  const catalogue = await build({
    userId: '1',
    username: 'me',
    creators,
    call: fakeCall({
      'User:1': [{ id: '10', name: 'Mine', privacyType: 'Private' }],
      'Group:2': [{ id: '20', name: 'Ours', privacyType: 'Public' }],
    }),
    onProgress: (done, total) => progress.push([done, total]),
  });

  assert.equal(catalogue.partial, false);
  assert.equal(catalogue.username, 'me');
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);

  const ours = catalogue.entries.find((e) => e.universeId === '20');
  assert.deepEqual(ours, {
    universeId: '20',
    name: 'Ours',
    privacyType: 'Public',
    imageUrl: '20.png',
    creator: 'Group:2',
    creatorLabel: 'Studio',
    creatorImageUrl: null,
  });

  assert.deepEqual(await read('1'), catalogue, 'and the result is what was stored');
});

test('a creator that fails keeps what the last crawl knew about it', async () => {
  await build({
    userId: '1',
    username: 'me',
    creators,
    call: fakeCall({
      'User:1': [{ id: '10', name: 'Mine', privacyType: 'Private' }],
      'Group:2': [{ id: '20', name: 'Ours', privacyType: 'Public' }],
    }),
  });

  const again = await build({
    userId: '1',
    username: 'me',
    creators,
    call: fakeCall({
      'User:1': [{ id: '11', name: 'Newer', privacyType: 'Private' }],
      'Group:2': new Error('503'),
    }),
  });

  assert.deepEqual(
    again.entries.map((e) => e.universeId).sort(),
    ['11', '20'],
    'the creator that answered is fresh, the one that did not is as before'
  );
  assert.equal(again.partial, false, 'a kept entry is not a missing one');
});

test('a creator that fails with nothing known before simply has no entries', async () => {
  const catalogue = await build({
    userId: '1',
    username: 'me',
    creators,
    call: fakeCall({ 'User:1': [], 'Group:2': new Error('503') }),
  });
  assert.deepEqual(catalogue.entries, []);
});
