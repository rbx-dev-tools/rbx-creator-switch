# Contributing

Early days, and the shape of this extension is still being decided, so **open
an issue before writing code**. A pull request that arrives without one risks
being declined for scope reasons that have nothing to do with its quality.

## Setup

```sh
git clone https://github.com/rbx-dev-tools/rbx-creator-switch
cd rbx-creator-switch
npm install
lefthook install     # one-time: pre-commit runs format, lint and the coherence check
npm run dev          # a Chrome with the extension loaded, reloading on save
```

Node 22 or later. No credentials are needed: the extension carries none, it
borrows the session of whichever browser profile it runs in.

## What the checks are for

```sh
npm run format:check   # prettier
npm run lint           # eslint
npm test               # node --test
npm run check          # does this extension still hold together
```

The last one is the unusual one and the one worth knowing about. It walks the
manifest, the popup markup, the module imports and the `chrome.scripting` calls
and asserts that every path they name exists, that no shipped file is
unreferenced, and that no declared permission is unused. A moved file is
invisible to a linter and surfaces as `ERR_FILE_NOT_FOUND` when a browser tries
to open the popup, which is the worst possible moment to learn about it. That
check exists because exactly that happened during development.

## House style

- **Comments say why, not what.** The code already says what. A comment earns
  its place by recording a constraint, a measurement or a rejected alternative.
- **One responsibility per module.** `client.js` talks to the page, `picker.js`
  draws one dropdown and knows nothing about Roblox, `cache.js` decides what is
  painted before the answer arrives, `status.js` owns the bottom line.
  `main.js` holds the only thing specific to this extension: an account owns
  creators, a creator owns experiences.
- **`src/agent.js` stays a single file.** It is injected into a page as a
  script, not a module, so splitting it would mean files coupled through
  globals in a load order nothing enforces.
- **Measure before asserting.** Every claim about a Roblox endpoint in
  [docs/creator-hub-api.md](docs/creator-hub-api.md) says how it was verified,
  and the ones that were not verified say so. A plausible guess presented as a
  fact is worse than an open question.

## Working against a private API

Nothing this extension calls is documented or supported by Roblox. When you
change how an endpoint is used:

1. Capture the real request first. The method in `docs/creator-hub-api.md`
   describes how: wrap `fetch` and `XMLHttpRequest` in the page and drive the
   real UI.
2. Write down the shape you measured, and label anything you assumed.
3. Add the failure mode to the "What would break this" section, with the
   symptom someone would actually see.

## Commits

Conventional Commits, subject in the imperative. The body explains the
reasoning, not the diff. The changelog is written by hand at release time.
