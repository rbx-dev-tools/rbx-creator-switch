# Privacy policy

Last updated: 2026-11-08

rbx-creator-switch is a Chrome extension that lets you pick a Roblox account,
a creator (you or a group) and an experience in one popup. This page says what
it reads, what it stores, and where anything is sent. The short version: it
collects nothing, and the only server it talks to is Roblox.

## What the extension collects

Nothing. There is no server operated by the author, no telemetry, no
analytics, no crash reporting and no remote configuration. The author never
receives any data from the extension, because the extension has nowhere to
send it.

## What the extension reads

While the popup is open, it reads from a roblox.com tab you are signed in on:

- **Your signed-in accounts**: user id, username and display name, from the
  account switcher endpoint, to list the accounts you can switch between.
- **The account switcher record**, `localStorage.RBXASBlob` on
  `www.roblox.com`. It identifies which accounts are signed in in this browser
  profile. It is sent only to the Roblox endpoint that the Roblox site itself
  sends it to, and is written back only after a switch you asked for.
- **Your creators and experiences**: the groups you can create under, and the
  name, id, root place and visibility of each experience, plus their pictures
  from `thumbnails.roblox.com`.

The extension never reads your cookies. It does not request the `cookies`
permission. Its requests are sent with `credentials: "include"`, which makes
the browser attach your Roblox session itself, the same way the Creator Hub's
own requests work. The cookie value never passes through the extension's code.

## What the extension stores

In `chrome.storage.local`, on your machine only:

- a per-account cache of your group and experience lists, and the account's
  username, so the popup can show something immediately and search by name;
- your theme choice.

This data never leaves your browser profile. Removing the extension, or
clearing its storage, deletes it.

## Where data is sent

Only to Roblox, from a page on `www.roblox.com`:

- `apis.roblox.com`
- `thumbnails.roblox.com`

It also opens tabs on `www.roblox.com` and `create.roblox.com`. No other host
is contacted. The source is public, and a check in the repository fails the
build if the code names a host that is not on this list.

## Sharing and selling

Nothing is shared with, sold to or transferred to any third party. Nothing is
used for advertising, creditworthiness or any purpose other than the single
feature described above, which is navigating to a creator's experience in the
Creator Hub.

## Remote code

None. Every line of code that runs ships inside the extension package.

## Children

The extension has no accounts of its own and collects no data, so it does not
knowingly collect anything from anyone, children included. Your use of Roblox
itself is governed by Roblox's own privacy policy.

## Not affiliated with Roblox

This is an independent project. It uses endpoints Roblox does not document.

## Changes and questions

If this policy changes, the date above changes and the history is in this
repository. Questions or concerns: open an issue at
<https://github.com/rbx-dev-tools/rbx-creator-switch/issues>. For a security
problem, use the private advisory described in [SECURITY.md](SECURITY.md).
