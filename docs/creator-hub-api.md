# Creator Hub private API notes

Captured on 2026-08-22 from `https://create.roblox.com/dashboard/creations` by
patching `fetch` and `XMLHttpRequest` in the page and driving the real UI. None
of this is documented or supported by Roblox, so treat every line as something
that can change without notice. Each section says how it was verified, so a
future reader can tell a measurement from an assumption.

All identifiers below are placeholders. No account, group, or universe id from
the machine used for the capture appears in this file.

## Summary

The Creator Hub picker is three independent layers:

| Layer                    | Where the state lives                                  | What it costs                     |
| ------------------------ | ------------------------------------------------------ | --------------------------------- |
| Account                  | Server session, driven by the account switcher service | One POST, then a full page reload |
| Creator (you or a group) | `localStorage`, client only                            | Zero requests                     |
| Experience               | Nothing, it is a query parameter                       | One GET                           |

The useful consequence: to list the experiences of any creator you do not need
to switch anything. You call one endpoint with a `CreatorType` and a
`CreatorTargetId`.

## 1. Accounts

### The blob

Every account switcher call carries an `encrypted_users_data_blob`, an opaque
string of roughly 3700 characters. It is the switcher's whole state: the set of
signed-in accounts and which one is active.

It lives in `localStorage.RBXASBlob` **on the `www.roblox.com` origin**, stored
as a JSON string, so `JSON.parse(localStorage.getItem('RBXASBlob'))` gives the
value the API expects.

`create.roblox.com` does not have it. The Creator Hub embeds a hidden iframe,
`https://www.roblox.com/account-switcher/iframe`, and receives the blob from it
over `postMessage`. Verified by elimination: the blob is absent from
`document.cookie`, from `localStorage` and `sessionStorage` on
`create.roblox.com`, and from the page HTML, while a direct visit to the iframe
URL shows `RBXASBlob` with a matching length.

The blob rotates. Both endpoints below return a fresh one, and a client that
keeps using the old value will drift out of sync with the server.

The blob is not authentication. Measured by calling
`getLoggedInUsersMetadata` with `encrypted_users_data_blob` set to `""`, and
again with the field left out entirely: both answer `200` and describe the
active account, which the session cookies identify on their own. What the blob
adds is the _other_ signed-in accounts. On a profile holding two accounts, the
real blob returns both, an empty one returns only the active account.

Two consequences. A client without the blob can still browse creators and
experiences, it just cannot switch. And the shorter blob returned by such a
degraded call must never be written back to `RBXASBlob`: it describes one
account, so storing it would drop the others from the switcher.

### List the signed-in accounts

```http
POST https://apis.roblox.com/account-switcher/v1/getLoggedInUsersMetadata
Content-Type: application/json
x-csrf-token: <12 characters>
credentials: include

{
  "encrypted_users_data_blob": "<blob>",
  "remove_invalid_active_user": false
}
```

```jsonc
{
  "logged_in_users_metadata": [
    { "user_id": <number>, "display_name": "<string>", "username": "<string>" }
  ],
  "active_user_id": <number>,
  "encrypted_users_data_blob": "<rotated blob>"
}
```

Worth knowing: opening the profile menu in the top right already fires this
call. Opening the "Switch accounts" modal fires it a second time and then loads
the avatars from `https://thumbnails.roblox.com/v1/users/avatar-headshot`.

### Switch account

```http
POST https://apis.roblox.com/account-switcher/v1/switch
Content-Type: application/json
x-csrf-token: <12 characters>
credentials: include

{
  "encrypted_users_data_blob": "<blob>",
  "switched_from_user_id": "<user id>",
  "switched_to_user_id": "<user id>"
}
```

```jsonc
{ "encrypted_users_data_blob": "<rotated blob>", "errors": null }
```

The user ids are sent as **strings**, not numbers. The Creator Hub reloads the
page right after a successful call. Both accounts stay signed in, so switching
back needs no password.

### Headers

Measured on `getLoggedInUsersMetadata`: `Content-Type: application/json`, an
`x-csrf-token` of 12 characters, and `credentials: "include"`. Nothing else, no
`Authorization` header. The same contract is assumed but not measured for
`/switch`, which is a POST on the same service.

The CSRF token follows the usual Roblox pattern: send the POST without it, take
the `403`, read the `x-csrf-token` response header, retry. The token then lasts
the session. Note that `apis.roblox.com` is a different origin from
`www.roblox.com`, so this only works because Roblox exposes that header through
CORS.

## 2. Creators

```http
GET https://apis.roblox.com/creator-home-api/v1/groups?surface=CreatorHub
```

This is what the dashboard calls on load to fill the creator menu on the left.

Selecting a creator sends **no request at all**. The choice is client state,
persisted in `localStorage` on `create.roblox.com`:

| Key                            | Value                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `creatorHubGroup.<userId>`     | The selected group id, or the user's own id for the personal creator                          |
| `creatorHubGroupData.<userId>` | `{"<groupId>": {"lastSelected": <epoch ms>, "priority": <number>}}`, the ordering of the menu |
| `creatorHubGroups.<userId>`    | A cache of the group list: `id`, `name`, `roleSetName`, `createdAt`                           |

In the DOM each entry is an `li[data-value="<id>"]` with no `href`, so the menu
cannot be driven by navigation.

Switching creator triggers a refetch of the page content: the experience search
below, plus `groups.roblox.com/v1/groups/<groupId>`,
`apis.roblox.com/orgs/v1/organizations?groupId=<groupId>`,
`apis.roblox.com/orgs/v1/organizations/<orgId>/users/<userId>/permissions`,
`apis.roblox.com/affiliate-links/v1/groups/<groupId>/eligibility` and
`/links/metadata`, and three POSTs used for the experience cards:
`experience-guidelines-service/v1beta1/multi-age-recommendation`,
`experience-releases/v1beta1/experience_releases_api/multi_release_statuses`,
and `team-create-service/v1/AreUniversesImpacted`. None of them are needed to
list experiences.

## 3. Experiences

```http
GET https://apis.roblox.com/universes/v1/search
      ?CreatorType=User            # or Group
      &CreatorTargetId=<user id or group id>
      &Surface=CreatorHubCreations
      &PageSize=50
      &PageIndex=0
      &IsArchived=false
      &SortParam=LastUpdated
      &SortOrder=Desc
      &NeedsAssetOptions=true
```

`PageIndex` is omitted on the first call by the dashboard and then incremented
for each further page. `SortParam` was only observed as `LastUpdated`; other
values are likely but untested.

## Images

Neither `creator-home-api/v1/groups` nor `universes/v1/search` carries an image.
Their measured shapes are `{groups: [{id, name, roleSetName, createdAt}]}` and
`{data: [{id, name, description, isArchived, rootPlaceId, privacyType,
creatorType, creatorTargetId, creatorName, created, updated, isFriendsOnly,
isTeamCreateEnabled, audiences}], totalResults, totalHits, nextResultIndex}`.
Pictures therefore take a second call, to `thumbnails.roblox.com`:

```http
GET https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=<ids>&size=48x48&format=Png&isCircular=true
GET https://thumbnails.roblox.com/v1/groups/icons?groupIds=<ids>&size=150x150&format=Png
GET https://thumbnails.roblox.com/v1/games/icons?universeIds=<ids>&size=128x128&format=Png
```

All three answer the same shape, `{data: [{targetId, state, imageUrl,
version}]}`, and all three were verified to return `state: "Completed"` with a
usable URL for every id tested.

Two traps, both inherited from
[rbx-observe](https://github.com/rbx-forge/rbx-observe), which documents
this service in depth:

- An image that has not been rendered yet comes back as `state: "Pending"`,
  sometimes with an empty URL and sometimes with none. A bad id comes back as
  `state: "Error"` **with** a URL, the grey placeholder. So the state decides
  whether an image exists, never the presence of a URL.
- Only a fixed set of sizes is accepted, anything else answers `400`. For game
  icons that set is 50x50, 128x128, 150x150, 256x256, 420x420, 512x512,
  1024x1024.

Ids are batched, 50 per request.

## What would break this

- A rename of `RBXASBlob`, or a move of the blob behind an HttpOnly cookie.
  Symptom: the account list stops loading while the site still works.
- A change to the shape of the switcher payload. Symptom: a `4xx` on
  `getLoggedInUsersMetadata` with a valid blob.
- A rename of the `creatorHubGroup.*` keys. Symptom: the creator selection stops
  persisting across reloads, on the site as well.
- `universes/v1/search` gaining a required parameter. Symptom: a `400` with a
  request that used to work.

## Method

The Chrome extension's network reader only reports URL, method, and status, so
request and response bodies were captured by wrapping `window.fetch` and
`XMLHttpRequest.prototype.send` in the page and recording each call. Captures
that had to survive the reload triggered by an account switch were written to
`localStorage` as they were sent, then read back afterwards.
