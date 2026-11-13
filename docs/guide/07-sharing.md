<!-- AUTHORED-BY Claude Opus 5.5 -->

# 7. Sharing and permissions

Sharing is where Solid servers differ most, and where mistakes cost the most: a wrong rule can
expose someone's private data. `@jeswr/pod-access` does the reading and writing of permissions
for you. This chapter says which part to use for which job, and what it will refuse to do.

## Find out what the server supports

`features.accessControl` from `createPodClient` tells you whether the storage uses WAC (`.acl`
documents), ACP (`.acr` documents), LWS grants (`odrl-grants`), or nothing you can manage
(`none`). `features.accessRequests` and `features.accessGrants` say whether the server has
services for asking for and granting access.

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;

const access = storage.features.accessControl;
const model = access.state === 'available' ? access.detail.model : null;
// 'wac' | 'acp' | 'odrl-grants' | 'none' | null (unknown)
```

A feature being available means the server supports it. It does not mean this user may change
permissions on a given resource. On Solid servers that send it, `read()` and `head()` fill
`result.allow` with `{ read, write, append, control }`. `null` means "the server did not say",
not "no". Always handle `forbidden` errors anyway.

## Which part to use

| Job | Use | Works on |
| --- | --- | --- |
| A share dialog: everyone with access, by role (viewer, commenter, editor, manager) | `@jeswr/pod-access/roles` | Solid (WAC, ACP) |
| Add, list or revoke rules on one item from code | `createAccessClient` from `@jeswr/pod-access` | Solid (WAC, ACP) and LWS |
| An inbox where the owner approves or denies access requests | `@jeswr/pod-access/requests-solid` | Solid (WAC) |
| Ask someone for access on LWS | `access.request()` from `createAccessClient` | LWS |
| Tell someone you shared something | `@jeswr/pod-access/notify`, or `useNotify()` from `@jeswr/suite-sdk` in React | Solid inboxes |

Both the roles layer and `createAccessClient` need to know some server details that the pod's own
data cannot be trusted to tell you. Pass them only from your app's own knowledge of the server,
for example its configuration, and never work them out from pod data:

- `createAccessClient` needs `acpDialect: 'css'` or `'ess'` for ACP servers. Without it, every ACP
  call fails with `unsupported` before it sends anything.
- `./roles` takes `implementation: 'css' | 'ess' | 'nss'` and assumes CSS when you leave it out.

## A share dialog with roles

A share dialog shows everyone who has access, lets the user change their roles, and saves the
whole list at once. `readGrants` returns the list, including rows inherited from parent folders,
with a version token. Pass the token back to `setGrants` so the save fails with a `conflict` if
someone else changed the permissions in the meantime.

```ts
import { type RoleGrant, readGrants, setGrants } from '@jeswr/pod-access/roles';
import type { PodAuth } from '@jeswr/pod-auth';

declare const auth: PodAuth;
declare const webId: string;
declare const fileUrl: string;
declare const friendWebId: string;

const options = { fetch: auth.fetch, webId, root: 'https://alice.example/' };
const snapshot = await readGrants(fileUrl, options);

const friend: RoleGrant = {
  agent: { type: 'webid', id: friendWebId },
  role: 'viewer',
  inherited: false,
  source: '',
};
// Replace the friend's own row if they have one: a second row for the same person is refused.
const others = snapshot.grants.filter(
  (row) => row.inherited || row.agent.type !== 'webid' || row.agent.id !== friendWebId,
);

try {
  const result = await setGrants([fileUrl], [...others, friend], { ...options, expected: snapshot });
  if (result.failed.length > 0) {
    // Per-item refusals such as 'conflict' or 'unsupported'. Re-read and show the current list.
  }
} catch (error) {
  // Whole-call refusals, such as 'owner-lockout', are thrown before anything is written.
}
```

Things to know:

- Roles are `viewer`, `commenter`, `editor` and `manager`. A commenter needs a
  `commentsContainer` in the options. Without one, a commenter gets only Read, the same as a
  viewer, and with `kind: 'document'` the call is refused with `comments-container-required`.
- Rows marked `inherited` come from a parent folder and are read-only here.
- **On WAC, the first save copies the folder's rules onto the item.** After that, changes made on
  the folder, such as removing someone, no longer apply to this item.
- The roles layer never removes the user's own manager access (`owner-lockout`), refuses rules
  it cannot represent, and never rounds a partial permission up to a role.
- Errors have a `code` but no exported class: check them with `isRoleError(error)`.
- For one person at a time, `addGrant` and `removeGrant` change only that person, and `addGrant`
  never lowers a higher role.
- Saving several URLs is not one transaction. Check `result.failed`, then re-read before trying
  again; nothing is retried for you.

## Rules on one item from code

`createAccessClient` works through the storage client you already have, so it uses the same
sign-in and the same storage boundary. Each `share` adds a new rule and returns it with an `id`
you can revoke later.

```ts
import { createAccessClient } from '@jeswr/pod-access';
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;
declare const fileUrl: string;

const access = createAccessClient({ storage });

const grant = await access.share(
  fileUrl,
  { agent: 'https://bob.example/profile/card#me', modes: ['read'] },
  { inherit: false },
);
const direct = await access.grants(fileUrl); // This item's own rules only.
await access.revoke(fileUrl, grant.id ?? 'https://bob.example/profile/card#me');
```

Things to know:

- **`grants()` is not "who has access".** On Solid it lists only the rules in the item's own
  access document, not rules inherited from its folders. Use `readGrants` for a full list.
- **On Solid, `share` edits an existing access document; it never creates one.** An item that
  only inherits from its folder fails with `not-found`. The roles layer handles that case.
- An agent is a WebID or `{ public: true }`. On Solid it can also be `{ authenticated: true }`,
  and on WAC `{ group: groupUrl }`. LWS supports neither, nor the `control` mode or `inherit`.
- Revoking by WebID, `{ public: true }` or `{ authenticated: true }` removes that agent from every
  rule on this item. When such a rule also covers other items, or on LWS other agents, the call
  fails with `unsupported` instead.
- **Refusals are errors, not silent changes.** Rules the client cannot fully understand make it
  throw a `StorageError` whose `code` is `unsupported`, rather than dropping them. Show the user
  that this item has to be managed in their pod manager.
- **Solid has no expiry or purpose.** WAC and ACP cannot say "until Friday" or "for this
  purpose", so the client refuses those fields on Solid. LWS supports both.
- **LWS needs the storage id.** Pass `storageId: description.id` from `createPodClient`. Pass
  `identity: () => webIdOrNull` as well if you call `effective()`.

## Access requests

Someone without access can send an access request to the owner's inbox. An owner-side app lists
the requests, and the owner approves or denies each one by hand:

```ts
import { type AccessRequestEntry, decide, listRequests } from '@jeswr/pod-access/requests-solid';
import type { PodAuth } from '@jeswr/pod-auth';

declare const auth: PodAuth;
declare const webId: string;

const options = { fetch: auth.fetch, webId, storage: 'https://alice.example/' };
const requests = await listRequests(options);
const pending = requests.filter((request) => request.status === 'pending');

// Called when the owner presses Approve on one request.
async function onApprove(request: AccessRequestEntry) {
  return decide(request, { approve: true, role: 'viewer' }, options);
}
```

Things to know:

- **`request.requester` is what the sender claims**, not a checked identity, and the same goes
  for `requesterName` and `purpose`. Say so to the owner.
- Never approve requests automatically. Each decision should come from the owner.
- Approval grants Viewer or Editor through the roles layer, never Control, and never on the
  storage root, the `settings/` folder or access documents.
- Each decision is recorded in an owner-only `settings/access-records/` folder, so a decision
  interrupted half-way can be retried safely.
- On WAC an expiry date is recorded but not enforced. The result says so with
  `expiryEnforced: false`, so do not tell the owner that access will end on that date.
- The requester is told about the decision only when you pass `publicFetch` (in Node, a
  DNS-checking one such as `createGuardedFetch()` from `@jeswr/guarded-fetch`). Otherwise the
  result has `notified: false`.
- On ACP, or when the model is unknown, `decide` throws `UnsupportedAccessModelError` before it
  writes anything.

## Tell people you shared something

Sharing does not tell anyone. Send a notification to the person's inbox:

```ts
import { createNotify, shareNotification } from '@jeswr/pod-access/notify';
import type { PodAuth } from '@jeswr/pod-auth';

declare const auth: PodAuth;
declare const webId: string;
declare const fileUrl: string;
declare const friendWebId: string;

// The notifier is bound to the signed-in WebID: an activity naming another actor is refused.
const notify = createNotify({ fetch: auth.fetch, webId });
const sent = await notify(friendWebId, { ...shareNotification(fileUrl, 'viewer'), actor: webId });
if (!sent.delivered) {
  // sent.reason: 'no-inbox' | 'forbidden' | 'network' | 'profile-unreadable' | ... (see the
  // NotifyResult type). The share itself still stands.
}
```

Delivery never throws and is best effort. In React, `useNotify()` from `@jeswr/suite-sdk` under
`PodAuthProvider` does the same with the signed-in user filled in.

## Rules for apps

- **Never write `.acl` or `.acr` files by hand.** Inheritance, auxiliary resources and the
  differences between servers make it easy to grant far more than you meant. The rules live in
  the [solid-wac skill](../../skills/solid-wac/SKILL.md) and in `@jeswr/pod-access`.
- When the server is `none`, or a call fails with `unsupported`, show sharing as unavailable for
  that item with a short reason, rather than half-working.
- Design your data layout with sharing in mind: put things the user is likely to share together in
  one container, because permissions usually apply per container.
- **Translating between WAC and ACP** (for moving pods) uses the offline translation core in
  `@jeswr/pod-access`, which proves a translated policy is never wider than the original. Apps
  rarely need it; the pod migrator does.

Next: [the user interface](08-user-interface.md).
