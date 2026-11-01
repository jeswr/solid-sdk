---
name: build-solid-app
description: Use when starting, structuring or reviewing a Solid or LWS application built on the @jeswr suite SDK, choosing which SDK package does which job, wiring sign-in to storage and live updates, modelling app data as RDF, testing against the memory backend, or checking what the SDK does not provide yet.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Build a Solid app on the suite SDK

## Quick reference

An app's data layer is three calls: `createPodAuth` (sign-in and a credential-bounded `fetch`),
`createPodClient` (one storage API over Solid and LWS) and `createNotifications` (change events).
Domain packages turn RDF into typed objects. UI packages supply the chrome. Everything else is
the app's own code.

- Pass `auth.fetch` everywhere. Never patch global fetch or build `Authorization` headers.
- Sign-in says who, not where: read the pod from the WebID profile (`pim:storage`).
- Run `ui.getCode` in a popup; full-page redirect sign-in is not resumable yet.
- Keep the URL and ETag the server returns. Never predict a URL from a container and a name.
- Every edit is conditional (`ifMatch`). On `precondition-failed`, re-read and reapply.
- Read and write RDF through a domain model or `@solid/object` / `@rdfjs/wrapper` accessors.
  Never hand-build Turtle or triples.
- Treat notifications as "this changed, re-read it". The pod is the source of truth.
- Branch on `features.<name>.state === 'available'`, never on the server's hostname.
- Develop and test against `@jeswr/storage-client/memory` in both `solid` and `lws` modes.

The human-readable version of this skill is the developer guide in
[`docs/guide/`](../../docs/guide/README.md). Its tutorial code runs in the gate from
[`tools/guide-examples`](../../tools/guide-examples/src/reading-list.ts).

## Which package does which job

| Job | Package | Read |
| --- | --- | --- |
| Sign in, restore, log out, Node agents | `@jeswr/pod-auth` | [pod-auth](../../packages/pod-auth/SKILL.md) |
| Discover what a server supports | `@jeswr/storage-capabilities` | [storage-capabilities](../../packages/storage-capabilities/SKILL.md) |
| Read, list, create, edit, move, delete | `@jeswr/storage-client` | [storage-client](../../packages/storage-client/SKILL.md) |
| React to changes | `@jeswr/pod-notifications` | [pod-notifications](../../packages/pod-notifications/SKILL.md) |
| Parse RDF from a response | `@jeswr/fetch-rdf` | [fetch-rdf](../../packages/fetch-rdf/SKILL.md) |
| Serialise RDF | `@jeswr/rdf-serialize` | [rdf-serialize](../../packages/rdf-serialize/SKILL.md) |
| Typed RDF accessors | `@solid/object`, `@rdfjs/wrapper` | [solid-object](../solid-object/SKILL.md) |
| Suite vocabulary IRIs | `@jeswr/suite-vocab` | [suite-vocab](../../packages/suite-vocab/SKILL.md) |
| Domain models | `@jeswr/solid-bookmark`, `@jeswr/solid-task-model`, … | each package README |
| Collaborative documents (Solid only today) | `@jeswr/y-solid` (Yjs) | [y-solid](../../packages/y-solid/SKILL.md) |
| Offline cache | `solid-offline` | [solid-offline](../../packages/solid-offline/SKILL.md), [patterns](../solid-offline-patterns/SKILL.md) |
| React chrome, theming, account menu | `@jeswr/app-shell` | [app-shell](../../packages/app-shell/SKILL.md) |
| Framework-free web components | `@jeswr/solid-elements` | [solid-elements](../../packages/solid-elements/SKILL.md) |
| Local SPARQL, SHACL | `@jeswr/rdf-engine` (lazy WASM) | [rdf-engine](../../packages/rdf-engine/SKILL.md) |
| Seed test pods | `@jeswr/solid-seed`, `@jeswr/synthetic-rdf` | [solid-seed](../../packages/solid-seed/SKILL.md) |

Cross-cutting patterns: [lws-vs-solid](../lws-vs-solid/SKILL.md),
[solid-optimistic-ui](../solid-optimistic-ui/SKILL.md),
[solid-test-infrastructure](../solid-test-infrastructure/SKILL.md),
[solid-client-id](../solid-client-id/SKILL.md),
[solid-server-matrix](../solid-server-matrix/SKILL.md).

## Wire the data layer

Build these once per signed-in account and drop them all on logout.

```ts
import { fetchRdf } from '@jeswr/fetch-rdf';
import { createPodAuth, type PodAuthOptions } from '@jeswr/pod-auth';
import { Agent } from '@solid/object';
import { DataFactory } from 'n3';
import { createNotifications } from '@jeswr/pod-notifications';
import { createPodClient } from '@jeswr/storage-client';

declare const ui: PodAuthOptions['ui']; // The app's sign-in screens.

const auth = createPodAuth({
  clientId: 'https://app.example/.well-known/solid-client-id.jsonld',
  redirectUri: 'https://app.example/auth/callback.html',
  ui,
});

const identity = (await auth.restore()) ?? (await auth.login());
// Signing in says who, not where: read pim:storage from the WebID profile.
// identity.storages is the credential boundary and can be empty after Solid login.
if (identity.webId === null) throw new Error('This sketch expects a WebID');
const profile = await fetchRdf(identity.webId, { fetch: auth.fetch });
declare function chooseStorage(candidates: string[]): Promise<string>; // UI: pick one, or type a URL when empty.
const storageRoot = await chooseStorage([...new Agent(identity.webId, profile.dataset, DataFactory).storageUrls]);

const { storage, features } = await createPodClient({ fetch: auth.fetch, storage: storageRoot });
const notifications = createNotifications({ fetch: auth.fetch, storage });

const canSearch = features.serverSearch.state === 'available';
const stopOnLogout = auth.on('logout', () => {
  // Close subscriptions and discard every cache built for this account.
  stopOnLogout();
});
```

In Node (bots, importers, MCP servers), replace `createPodAuth` with `forClientCredentials` or
`forCid` from `@jeswr/pod-auth/node` and keep the rest.

## Store app data

- Pick a container per collection. Create it once, store its returned URL (preferences, or the
  Type Index once `@jeswr/pod-type-index` lands), and pass that URL back on the next start.
- Create a resource before writing RDF that names it: on LWS the server picks the URL, and a
  subject such as `<url>#it` needs that URL. Then read it back (content and ETag in one request),
  check it is still empty, and write with that ETag.
- One small document per record suits lists of things. Split large collections by date or hash;
  see [solid-scale-and-sharding](../solid-scale-and-sharding/SKILL.md).
- Write canonical suite IRIs from `@jeswr/suite-vocab`; accept legacy IRIs when reading.

```ts
import { bookmarkSubject, parseBookmarkTtl, serializeBookmark } from '@jeswr/solid-bookmark';
import { StorageError, type StorageClient } from '@jeswr/storage-client';

export async function saveLink(storage: StorageClient, container: string, link: string) {
  const created = await storage.create(container, null, { contentType: 'text/turtle' });
  // Read back content and ETag together; non-empty means another writer got there first.
  const fresh = await storage.read(created.url);
  if ((await fresh.bytes()).length > 0 || fresh.etag === null) throw new Error('Retry with a new resource');
  const etag = fresh.etag;
  const turtle = await serializeBookmark(created.url, { url: link, created: new Date() });
  return storage.write(created.url, turtle, { contentType: 'text/turtle', ifMatch: etag });
}

export async function readLink(storage: StorageClient, url: string) {
  try {
    const result = await storage.read(url, { accept: 'text/turtle' });
    return { etag: result.etag, bookmark: await parseBookmarkTtl(url, await result.text(), 'text/turtle') };
  } catch (error) {
    if (error instanceof StorageError && error.code === 'not-found') return null;
    throw error;
  }
}

export const subjectOf = bookmarkSubject;
```

## Handle errors

Every storage failure is a `StorageError` with a `code`; invalid arguments (such as a missing
`ifMatch`, even on `delete`) throw `TypeError` before any request. The codes apps handle:

| Code | Meaning | App response |
| --- | --- | --- |
| `precondition-failed` | Someone else changed it since you read it | Re-read, reapply, or ask the user; `retryOnConflict` in `/helpers` |
| `unauthenticated` / `forbidden` | Not signed in, or no permission | Offer sign-in or show "no access"; never retry silently |
| `not-found` | Gone | Drop it from the view |
| `unsupported` | This server lacks the feature | Hide the control; check `features` first next time |
| `network` | Offline or aborted | Keep local state, retry later if `retryable` |
| `scope` | URL outside this storage | A bug or a hostile link; never widen the boundary |

## Test

- Unit-test the data layer on `createMemoryStorage({ protocol: 'solid' })` and `'lws'`. Both
  enforce ETags, scoping and LWS-assigned names, so a test that passes on both is protocol-neutral.
- Record real traffic once with `createRecordingFetch` from `@jeswr/storage-client/testing` and
  replay it offline; review captures before committing them.
- Run browser flows against a local Community Solid Server
  ([solid-test-infrastructure](../solid-test-infrastructure/SKILL.md)); never the live pods.
- `@jeswr/pod-auth/testing` has a mock OpenID provider and LWS authorization server.

## Ship

- Generate the Client Identifier Document with `node scripts/client-id.mjs <config> <public>`,
  serve it at the exact `clientId` URL as `application/ld+json`, and list every callback URL.
- Apps live in `apps/<slug>` as `@jeswr/app-<slug>`, private, with `workspace:*` SDK edges.
  `pnpm run check:sdk-layers` rejects app dependencies on `@sparq-org/sparq` and on the
  storage-client `/solid` and `/lws` backends.
- Run `pnpm run gate` before pushing.

## Not ready yet

Do not invent these APIs or rebuild them inside an app. Leave the control out, or keep it behind a
feature check, until the package ships it.

- **Sharing.** `@jeswr/pod-access` has the WAC/ACP translation core only; there is no `share()` or
  grant API. Show who-has-access as unavailable rather than writing `.acl` files by hand.
- **React data hooks.** The `@jeswr/suite-sdk` React facade (session, resources, subscriptions) is
  planned; until then apps keep a small context of their own over the three clients above.
- **A shared sign-in screen** (provider buttons, WebID, "another provider") is being designed for
  `@jeswr/suite-ui`; until it lands, build the screen in the app following the guide's chapter 3.
- **Collaboration on LWS.** `@jeswr/y-solid` persistence is Solid-only and has no real-time
  service adapter.
- **Offline outbox.** `solid-offline` caches reads; queued offline writes are planned. Await
  `offline.logout()` yourself on logout.
- **Type Index client**, multi-account switching, preferences store, trash and versions are in
  progress. Check the package list in `suite.json` before assuming they exist.

## Pitfalls

- Joining `container + name` to find a resource works on Solid and breaks on LWS.
- `'*'` as `ifMatch` skips the check on Solid only. Prefer the ETag you read.
- `allow === null` means "unknown", not "denied". Handle 401 and 403 anyway.
- `unknown` feature state means "no evidence". Enable optional features on `available` only.
- A public profile read is not proof the user signed in. Use `auth.identity()`.
- Notifications can be missed while offline. Reconcile by re-listing after reconnecting.
