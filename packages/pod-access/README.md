<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-access

> **Experimental — AI-agent-generated.** Notification delivery is implemented; grant APIs remain reserved.

Pod sharing and permissions across access-control models. Design of record: SDK core `ADR-003-storage-client.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Reserved entry points: `@jeswr/pod-access`, `@jeswr/pod-access/testing`.
Notification delivery lives at `@jeswr/pod-access/notify`:

```ts
import { assignmentAnnounce, createNotify } from '@jeswr/pod-access/notify';

const notify = createNotify({ fetch: auth.fetch });
const result = await notify(assigneeWebId, {
  ...assignmentAnnounce(task, tracker, assignerName, title),
  actor: senderWebId,
});
// { delivered: boolean, inbox: string | null,
//   reason?: 'no-inbox' | 'forbidden' | 'lws-no-ldn' | 'network' }
```

Activities support `Announce`, `Offer`, `Accept`, `Reject`, and `Create`; `object` and `actor`
are required, with optional `target` and `summary`. The POST body is ActivityStreams JSON-LD
(`application/ld+json`). Delivery failures resolve as values. An inbox's 401/403 is `forbidden`;
other transport, parsing, policy or HTTP failures are `network`. No unambiguous inbox is `no-inbox`.

Builders return templates without actor: `shareNotification(resource, role)` announces a share
with summary `Shared with you as {role}`; `assignmentAnnounce(task, tracker, assignerName, title)`
announces the task with tracker target and summary `{name} assigned you '{title}'`;
`mentionNotification(annotation, document)` creates an annotation with the document target;
`roomInvitation(room)` offers a room. These helpers do not modify grants or resource data.

Each notifier caches positive and missing-inbox discovery for ten minutes, sharing concurrent
profile reads. Transient failures are retried. Caches hold at most 256 exact WebIDs and belong
to one caller/session: recreate the notifier on account changes. `clock` is injectable for tests.

Known LWS recipients should be identified by `recipientProtocol: webId => 'lws'`; this returns
`lws-no-ldn` without network requests. An `application/lws+json` profile response also returns
`lws-no-ldn`. Unknown recipients are treated as WebIDs; the sender's protocol is irrelevant.

Profile and inbox destinations must be public HTTPS without URL credentials; inbox fragments
and ambiguous inbox assertions are refused. The caller transport must honor `redirect: 'manual'`.
All redirects are refused, bodies are capped at 256 KiB, and requests have an eight-second deadline.
Node hostname targets require an authenticated `pinningFetch` explicitly asserted to pin DNS,
in addition to `fetch`; ordinary pod-auth fetch is not silently treated as pinned. Browsers cannot
pin DNS and use guarded-fetch's browser policy. Activity IRIs currently require HTTPS.

React applications can use `useNotify()` from `@jeswr/suite-sdk` under `PodAuthProvider`; it
supplies the current actor/fetch and resets the cache on identity changes.

From the workspace root:

```sh
pnpm --filter @jeswr/pod-access run lint
pnpm --filter @jeswr/pod-access run build
pnpm --filter @jeswr/pod-access run typecheck
pnpm --filter @jeswr/pod-access run test
```

Tests cover the reserved entry points, notification builders and a byte-snapshotted assignment
delivered through the real notifier and a fixture fetch. Coverage thresholds remain 100%.
