# Security policy

## Reporting a vulnerability

**Use GitHub private security advisories:**
<https://github.com/rbx-dev-tools/rbx-creator-switch/security/advisories/new>

Not a public issue. Include what you ran, what happened, and why it is a
security problem rather than a bug.

**What to expect.** Solo-maintained: an acknowledgement within a week is the
realistic commitment, a fix as fast as the severity warrants. Credit in the
advisory unless you ask otherwise. No bounty program.

## Supported versions

Only the latest release.

## Threat model

This extension stores no credentials and asks for none. It runs inside a
browser profile that is already signed in to Roblox and borrows that session,
the same way the Creator Hub does. What it does hold is access to that session,
which makes the interesting reports these:

- **Anything that sends session material off roblox.com.** The extension talks
  to `apis.roblox.com`, `thumbnails.roblox.com` and `users.roblox.com`, from a
  page on `roblox.com`, and nowhere else. There is no telemetry, no analytics
  and no remote configuration. A code path that reaches another host is a bug
  worth reporting even if it looks harmless.
- **Anything that widens the permissions.** The manifest asks for `scripting`,
  `tabs`, `storage` and host access to `https://*.roblox.com/*`. `npm run
check` fails the build on a declared permission nothing calls, precisely so
  the list cannot quietly grow.
- **Mishandling of the account switcher blob.** `localStorage.RBXASBlob` on
  `www.roblox.com` records which accounts are signed in. Writing a wrong value
  there can drop accounts from the switcher, which is data loss rather than
  disclosure but is still the extension damaging something it did not create.
  It is only ever written back from a response to a request that carried a real
  one, and [docs/creator-hub-api.md](docs/creator-hub-api.md) explains why.
- **Injection through Roblox-controlled strings.** Group and experience names
  come from other people. They are written to the DOM as text, never as markup.
  A path that puts one into `innerHTML` is a real finding.

## Out of scope

- Roblox's own endpoints. Report those to Roblox.
- Anything requiring an attacker who already controls the browser profile. At
  that point they have the session itself and do not need this extension.
- The dev tooling in `scripts/`, which never ships to a browser.
