// The cache has one rule worth stating twice: it decides what is painted
// first, never what is fetched. `peek` and `refresh` are kept apart so a
// caller can paint and carry on instead of awaiting an answer it already has a
// usable version of.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// cache.js reads chrome.storage.local at call time, so a plain object standing
// in for it is enough. Installed before the import so nothing captures the
// real one, which does not exist here.
const store = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key === null) return Object.fromEntries(store);
        return store.has(key) ? { [key]: store.get(key) } : {};
      },
      async set(entries) {
        for (const [key, value] of Object.entries(entries)) store.set(key, value);
      },
      async remove(keys) {
        for (const key of [keys].flat()) store.delete(key);
      },
    },
  },
};

const { peek, refresh, same, remember } = await import('../src/popup/cache.js');

beforeEach(() => store.clear());

test('peek answers nothing before anything is stored', async () => {
  assert.equal(await peek('groups', 'user'), null);
});

test('peek never fetches', async () => {
  let fetched = 0;
  await refresh('groups', 'user', async () => {
    fetched += 1;
    return ['a'];
  });

  assert.deepEqual(await peek('groups', 'user'), ['a']);
  assert.equal(fetched, 1, 'the only request was the refresh');
});

test('refresh stores what it fetched, so the next peek is warm', async () => {
  const fresh = await refresh('games', 'Group:1', async () => ['one']);

  assert.deepEqual(fresh, ['one']);
  assert.deepEqual(await peek('games', 'Group:1'), ['one']);
});

test('an entry past its lifetime is not served', async () => {
  await refresh('games', 'Group:1', async () => ['old']);

  const [key] = [...store.keys()];
  store.set(key, { ...store.get(key), at: Date.now() - 365 * 24 * 60 * 60 * 1000 });

  assert.equal(await peek('games', 'Group:1'), null, 'nothing stale reaches the screen');
});

test('two scopes never read each other', async () => {
  await refresh('games', 'User:1', async () => ['mine']);

  assert.equal(await peek('games', 'Group:2'), null);
  assert.deepEqual(await peek('games', 'User:1'), ['mine']);
});

test('same tells a caller when a second paint would change nothing', () => {
  assert.ok(same([{ id: '1' }], [{ id: '1' }]));
  assert.ok(!same([{ id: '1' }], [{ id: '2' }]));
});

test('a remembered value is what the next peek serves', async () => {
  await refresh('groups', 'user', async () => [{ id: '1' }]);

  // What paintImages does once the pictures land.
  await remember('groups', 'user', [{ id: '1', imageUrl: 'icon' }]);

  assert.deepEqual(
    await peek('groups', 'user'),
    [{ id: '1', imageUrl: 'icon' }],
    'pictures survive to the next open'
  );
});
