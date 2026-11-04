<!-- AUTHORED-BY Claude Opus 5.5 -->

# 7. Sharing and permissions

Sharing is where Solid servers differ most, and where mistakes cost the most: a wrong rule can
expose someone's private data. This chapter says plainly what the SDK supports today.

## What exists today

**Knowing which model a server uses.** `features.accessControl` from `createPodClient` tells you
whether the storage uses WAC (`.acl` documents), ACP (`.acr` documents), LWS grants
(`odrl-grants`), or nothing you can manage (`none`). `features.accessRequests` and
`features.accessGrants` say whether the server has services for asking and granting access.

```ts
import type { StorageClient } from '@jeswr/storage-client';

declare const storage: StorageClient;

const access = storage.features.accessControl;
const model = access.state === 'available' ? access.detail.model : null;
// 'wac' | 'acp' | 'odrl-grants' | 'none' | null (unknown)
```

A feature being available means the server supports it. It does not mean this user may change
permissions on a given resource.

**What the current user can do.** On Solid servers that send it, `read()` and `head()` fill
`result.allow` with `{ read, write, append, control }`. `null` means "the server did not say",
not "no". Always handle `forbidden` errors anyway.

**Translating between WAC and ACP.** `@jeswr/pod-access` has a careful, offline translation core
(used by the pod migrator) that reads and writes WAC and ACP documents and proves a translated
policy is never wider than the original. It does not talk to a server.

## Not ready yet

- A `share()` call, a list of who has access, and grant or revoke actions.
- Role presets (viewer, commenter, editor, manager).
- Solid access requests (asking someone for access through their inbox).

These are planned in `@jeswr/pod-access`.

## What to do until then

- **Do not write `.acl` or `.acr` files by hand from an app.** Inheritance, auxiliary resources
  and the differences between servers make it easy to grant far more than you meant. The suite's
  rules for this live in the [solid-wac skill](../../skills/solid-wac/SKILL.md), which is written
  for server authors.
- Show sharing controls as unavailable, with a short explanation, rather than half-working.
- If your app needs to read data the user did not create, ask the user to grant access in their
  pod manager, and handle `forbidden` gracefully.
- Design your data layout with sharing in mind: put things the user is likely to share together in
  one container, because permissions usually apply per container.

Next: [the user interface](08-user-interface.md).
