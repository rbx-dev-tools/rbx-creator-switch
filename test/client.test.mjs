// Which roblox.com tab the popup works through. The order of preference is
// the whole logic, and it is pure, so it is pinned here without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// client.js reaches for chrome.permissions and friends only inside functions,
// but it registers a pagehide listener at import time. A stub keeps that
// import honest under Node.
globalThis.chrome = {};
globalThis.addEventListener = () => {};

const { pickTab, isUsable } = await import('../src/popup/client.js');

const tab = (id, overrides = {}) => ({ id, status: 'complete', discarded: false, ...overrides });

test('a tab that is ready now wins over everything else', () => {
  const picked = pickTab([
    tab(1, { status: 'loading' }),
    tab(2, { discarded: true, status: 'unloaded' }),
    tab(3),
  ]);
  assert.deepEqual(picked, { tab: tab(3), action: 'use' });
});

test('an unloaded tab is a reload away, and preferred to one still loading', () => {
  const picked = pickTab([tab(1, { status: 'loading' }), tab(2, { discarded: true })]);
  assert.equal(picked.action, 'reload');
  assert.equal(picked.tab.id, 2);
});

test('a loading tab is waited for rather than duplicated', () => {
  const picked = pickTab([tab(1, { status: 'loading' })]);
  assert.deepEqual(picked, { tab: tab(1, { status: 'loading' }), action: 'wait' });
});

test('no tab at all means opening one', () => {
  assert.deepEqual(pickTab([]), { tab: null, action: 'create' });
});

test('a discarded tab is never usable, whatever its status says', () => {
  assert.equal(isUsable(tab(1, { discarded: true })), false);
  assert.equal(isUsable(tab(1, { status: 'loading' })), false);
  assert.equal(isUsable(tab(1)), true);
  assert.equal(isUsable(undefined), false);
});
