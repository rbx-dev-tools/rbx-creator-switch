# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The search field is focused again when the popup opens. The no-flash
  change kept the page hidden for a frame, and a focus given to a hidden
  element is dropped.

## [0.1.0] - 2026-08-22

### Added

- **Every page of a creator's experiences.** `universes/v1/search` pages by
  fifty and the popup used to read only the first page, so a creator with more
  experiences than that silently lost the rest, from the picker and from the
  search catalogue alike. The walk now continues until a short page.
- **The roblox.com tab the popup opens for itself is closed** when the popup
  closes, unless it was brought to the front in between. Before, every use
  without a roblox.com tab open left one behind.
- **A creator that fails during a catalogue crawl keeps its entries** from the
  previous crawl instead of dropping out of search until the next manual
  refresh.
- **Experiences load on a cold cache.** On a first open, or once the cached
  group list had expired, the experience picker stayed on "pick a creator"
  until a creator was chosen by hand: the list was asked for before the
  creators had arrived, and never again. The account's own face also reaches
  the "My creations" row now instead of only the account picker.
- **Chevrons drawn in CSS**, larger, pointing right when closed and down when
  open, instead of a small glyph whose size depended on the system font.
- **`npm run demo` and `npm run screenshots`**: the popup in a plain tab on
  stand-in data built from well-known public experiences, for looking at it
  without a Roblox session and for the README pictures.
- **Errors that mean "not signed in"** say so, instead of showing a bare 401.
- `minimum_chrome_version` is declared, and `src/agent.js` is injected into
  the isolated world explicitly rather than by default.
- `npm run check` now also verifies that every host named in `src/` is allowed
  by `host_permissions` and listed in both the README and SECURITY.md, after
  those two lists were found to disagree with the code.
- Tests for the agent (CSRF retry, paging, the blob rule, image filtering),
  the tab choice and the catalogue crawl.
- Issue templates and a code of conduct.

- **The popup**: an account, a creator and an experience in three linked
  pickers, each row carrying its picture. The Creator Hub spreads that choice
  over three places on the page, and a list of bare names makes you read where
  a list of icons lets you recognise.
- **Search by experience name**, filling in the account and creator that reach
  it. There is no server-side search to lean on, so the popup keeps its own
  catalogue, one request per creator, built on demand and rebuilt only from the
  button next to the field. Where several results share a name, two creators
  with the same name stay two results because they are two universes, while one
  universe seen from two accounts folds into one row on the account that needs
  no switch.
- **Opening an experience reuses the Creator Hub tab** you are already looking
  at instead of stacking a second one beside it. A tab on any other site is
  left alone, which includes a tab whose URL cannot be read: without host
  permission there is no `url` to inspect, and that is the correct answer.
- **A keyboard path through the whole thing**: `Ctrl+Shift+Y` opens the popup
  with the cursor already in the search field, arrows move through any list,
  Enter takes the highlighted row and Escape closes it. A suggested shortcut is
  only a suggestion: Chrome drops it if another extension holds the
  combination, and refuses some outright, `Alt+Shift+R` among them.
  `chrome://extensions/shortcuts` is where to see what it got and to set your
  own.
- **An icon**, two arrows swapping places on a blue badge, drawn for 16px
  first since that is where it lives. `icons/icon.svg` is the source and
  `npm run icons` renders the PNG sizes Chrome asks for, so the pixels never
  become the only copy of the design.
- **A theme switch**, light, dark or auto. Auto is the native behaviour and
  costs nothing; the switch exists for the two cases where someone wants to
  override the system and expects that choice to be remembered.
- **`npm run dev`**: a Chrome with the extension installed, reinstalling on
  every save and refreshing open roblox.com tabs. Chrome ignores
  `--load-extension` as of version 151, so the install goes through the
  DevTools protocol.
- **`npm run check`**: walks the manifest, the popup markup, the module imports
  and the `chrome.scripting` calls and asserts every path resolves, that no
  shipped file is unreferenced, and that no declared permission is unused.
- **[docs/creator-hub-api.md](docs/creator-hub-api.md)**: the private endpoints
  behind the Creator Hub menus, what was measured against the live site, what
  was only assumed, and what breakage would look like when Roblox changes them.

### Fixed

- **The injected agent is re-injected on every request instead of listening.**
  A script injected into a page outlives the extension version that put it
  there, so a listener registered before a reload kept answering with the
  shapes it used to return. The symptom was a current popup talking to old
  code: missing thumbnails, and `groups.map is not a function`. An extension
  that looks alive and is wrong is worse than one that fails.
- **A tab is used only once its document is really the roblox.com one.**
  `tab.url` says where a tab is going, not what it is showing, so a tab still
  committing its navigation or unloaded by Chrome's memory saver advertised
  roblox.com while its live document was still `about:blank`. Injecting there
  failed with a permission error naming a host the extension does have, which
  sent the search in exactly the wrong direction. A sleeping tab is now woken,
  a loading one waited for, and a tab that changes under the injection is
  retried once on a fresh one.
- **The switcher blob is written back only when the request carried one.**
  Calling `getLoggedInUsersMetadata` without it still answers `200`, describing
  the single account the cookies name, and storing that shorter blob would have
  dropped every other signed-in account from the switcher.

[Unreleased]: https://github.com/rbx-dev-tools/rbx-creator-switch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rbx-dev-tools/rbx-creator-switch/releases/tag/v0.1.0
