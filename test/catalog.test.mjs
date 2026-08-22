// The search side of the catalogue, which is where the only real rule lives:
// what to do when more than one (account, creator, experience) triple answers
// to the same name.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {},
    },
  },
};

const { search } = await import('../src/popup/catalog.js');

const entry = (name, universeId, creatorLabel) => ({
  universeId,
  name,
  creator: `Group:${creatorLabel}`,
  creatorLabel,
  imageUrl: null,
});

const catalogues = {
  1: { username: 'me', entries: [entry('Pixel Farm', '100', 'Studio A')] },
  2: { username: 'alt', entries: [entry('pixel farm', '200', 'Studio B')] },
};

test('matching ignores case', () => {
  assert.equal(search(catalogues, '1', 'PIXEL').length, 2);
  assert.equal(search(catalogues, '1', 'pixel').length, 2);
});

test('an empty query matches nothing rather than everything', () => {
  assert.deepEqual(search(catalogues, '1', '   '), []);
});

test('a prefix outranks a match in the middle', () => {
  const shelf = {
    1: {
      username: 'me',
      entries: [entry('Happy Pixels', '1', 'A'), entry('Pixel Farm', '2', 'A')],
    },
  };

  assert.deepEqual(
    search(shelf, '1', 'pix').map((m) => m.name),
    ['Pixel Farm', 'Happy Pixels']
  );
});

test('the same name under two creators stays two results', () => {
  const shelf = {
    1: {
      username: 'me',
      entries: [entry('Tycoon', '10', 'Studio A'), entry('Tycoon', '11', 'Studio B')],
    },
  };

  const found = search(shelf, '1', 'tycoon');
  assert.equal(found.length, 2, 'two universes are two experiences, whatever they are called');
  assert.deepEqual(
    found.map((m) => m.creatorLabel).sort(),
    ['Studio A', 'Studio B'],
    'the creator is what tells them apart'
  );
});

test('the same universe seen from two accounts folds into one, on the active account', () => {
  // Both accounts are in the same group, so the group's universe is listed
  // under each of them. One destination, two ways to reach it.
  const shared = {
    1: { username: 'me', entries: [entry('Shared Game', '500', 'Common Studio')] },
    2: { username: 'alt', entries: [entry('Shared Game', '500', 'Common Studio')] },
  };

  const found = search(shared, '2', 'shared');
  assert.equal(found.length, 1, 'one destination is one row');
  assert.equal(found[0].userId, '2', 'the account that needs no switch wins');

  assert.equal(search(shared, '1', 'shared')[0].userId, '1', 'and it follows whoever is active');
});

test('results from another account are offered, and say which account they need', () => {
  const found = search(catalogues, '1', 'pixel');
  const other = found.find((m) => m.userId === '2');

  assert.ok(other, 'an experience under the other account is still findable');
  assert.equal(other.username, 'alt', 'and carries the account name for the warning');
  assert.equal(found[0].userId, '1', 'the active account is listed first');
});
