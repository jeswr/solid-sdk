<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
# solid-agent-notify

> ⚠️ **Experimental — AI-agent-generated.** This package was created by an AI coding agent (Claude Opus 4.8, @jeswr's PSS agent) and is under active development. It is not yet production-hardened — review before relying on it.

SSRF-hardened cross-pod **Linked Data Notifications (LDN)** for Solid: discover an
agent's `ldp:inbox`, POST an [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)
notification to it, and read an inbox. The root Node API forces outbound dereferences
through a DNS-pinned, redirect-revalidating egress chokepoint.

This is the cross-pod notify path for the Solid federation MVP. It is
**security-critical**: every `send`/`read`/`discover` fetches an
attacker-influenced URL (a recipient WebID, an advertised inbox, an inbox member),
so root-API egress goes through `guardedFetch`. The separate `./client` API uses the
guarded caller transport described below.

## Install

```bash
npm install solid-agent-notify
# or directly from the published GitHub mirror (built dist included):
npm install github:jeswr/solid-agent-notify#main
```

Node ≥ 22.19.0, ESM-only. (The SSRF egress uses `@jeswr/guarded-fetch`'s undici
DNS-pinning path, which requires Node ≥ 22.19.0.)

> This workspace builds `dist/` fresh and never commits it. The original
> `jeswr/solid-agent-notify` mirror carries built artifacts so GitHub pins work under
> `ignore-scripts=true`. Maintainers change source here and use the workspace's
> mirror-publishing workflow; mirrors are never hand-edited. npm publishing remains deferred.

## Caller-fetch notification client

`solid-agent-notify/client` exposes `createNotifyClient({ webId, fetch, clock?, recipientProtocol?,
pinningFetch? })`. Its returned `notify(agentWebId, activity)` discovers exactly one `ldp:inbox`
on the recipient's exact WebID subject using fetch-rdf, caches positive/negative discovery for
ten minutes per transport/clock scope, and POSTs a typed RDF/JS ActivityStreams dataset serialized by n3.Writer as Turtle (`text/turtle`) with a blank activity subject through the caller's fetch.
Activities carry `type: 'Announce'|'Offer'|'Accept'|'Reject'|'Create'|'Invite'|'Update'`, `actor`,
and optional `object`, `target`, `summary` and `content`; the POSTed body also carries `published` (the send time from `clock`, default
`Date.now`, as an ISO string) so readers can date and order items. Results are `{delivered, inbox, reason?}`; delivery failures never throw.
On HTTP 415, the client retries once with `application/ld+json`, serialized from the same
RDF dataset by the existing rdf-serialize dependency; no remote contexts are emitted. A
second 415 is returned with its status.
The session `webId` binds the actor; mismatches return `invalid-actor`. Non-HTTPS optional
object/target links are omitted. Reasons are `no-inbox`, `forbidden` (inbox 401/403),
`lws-no-ldn`, `invalid-target`, `profile-unreadable`, and `network`. HTTP failures retain `status`.

The client entry avoids the root API's Node transport/config imports. Its egress boundary is
`src/security/clientFetch.ts`: public HTTPS, no credentials in URLs, no redirects, 256 KiB body
caps, and eight-second deadlines. Node hostname destinations require an authenticated
`pinningFetch` explicitly asserted to pin DNS; supplying only an ordinary caller fetch fails
closed. Browsers use the shared guard's syntactic policy because sockets cannot be pinned there.
`refuseRedirects` is the primary redirect control; the fetch implementation must honor manual
redirects. A changed final response URL or `redirected: true` (even with an empty URL on a
rebuilt Response) is also refused as a backstop. The redirected flag is checked before
body capping rebuilds the response. `createNotifyFetch({ fetch, pinningFetch? })` exposes this same boundary
for SDK notification management and linked-resource reads. Activity IRIs require HTTPS. All branches reject single-label hosts, empty labels and trailing
dots. `devLoopback: true` explicitly admits HTTP(S) only on localhost, 127.0.0.1 and [::1], any
port. `ownStorageRoots` from the trusted session permits other HTTPS ports only for scoped
GET/HEAD. With a trusted `ownInboxUrl` strictly inside those roots, direct-child marker PUT
and child DELETE also use the own-storage port. Foreign requests and POST retain port 443.
`isLoopbackHostname(hostname)` exports the exact host check; apps must also require a
development build before opting in. Discovery caches isolate these policies.

Known LWS recipients can be short-circuited with `recipientProtocol(webId) => 'lws'`; LWS profile
media types also return `lws-no-ldn`. The sender's protocol never determines the recipient's.
Use a fresh transport wrapper on account/session changes so caches cannot cross identities. The SDK wrapper and builders live in
`@jeswr/pod-access/notify`; the React hook lives in `@jeswr/suite-sdk`.

## Caller-fetch inbox reader

```ts
import { createInboxReader } from "solid-agent-notify/client";

const reader = createInboxReader({ fetch: authenticatedFetch, maxItems: 50 });
const inbox = await reader.inbox(ownerWebId); // string | null (including LWS profiles)
const items = inbox ? await reader.list(inbox, { signal }) : [];
```

`createInboxReader({ fetch, pinningFetch?, clock?, maxItems? })` shares the notifier's exact
WebID discovery implementation and ten-minute cache when **fetch, pinningFetch and clock**
identities match (omitted clock uses Date.now). Recreate session transports on account changes.
Discovery failures return null; transient failures are retried. The cache holds at most 256 WebIDs.

`list` returns `InboxNotification[]` (`url`, `type`, optional `actor`, `object`, `target`,
`summary`, `content`, `name`, `published`), newest first, undated last, with URL tie ordering. It reads
at most `maxItems` direct children in listing order (default 50, a non-negative safe integer up to exported `MAX_INBOX_ITEMS` = 500),
with at most six member requests active. Cross-origin, outside-container, nested, query,
fragment, credentialed and encoded-delimiter members are skipped. Unreadable members are skipped; unknown activities retain a display fallback.
404 containers and unparseable listings return `[]`. 401/403 and other container transport/HTTP
failures reject. Cancellation rejects with `AbortError`, even for a custom abort reason, and
starts no further requests. Reads use the same bounded `clientFetch` as delivery: HTTPS only,
no URL credentials or redirects, including on members. Legacy names and valid untyped publication
dates are retained. `listPage(inboxUrl, { signal? })` returns `{ notifications, members, truncated }`,
with the full eligible direct-child list and an explicit fetch-limit flag. `isInboxChild(url, inbox)`
exposes the same pure direct-child scope guard for SDK mutations. Idempotent unconditional read markers and
dismissal live in `@jeswr/pod-access/notify` via `createInboxManager`.

Listing byte overflow retains complete Turtle/N-Triples statements and returns `truncated: true`
(incomplete JSON-LD yields an empty truncated page). Notification bodies retain the hard
256 KiB cap. Read sidecars are excluded from fetch budgets. Blank-node activity subjects
preserve RDF/JS identity; missing/unknown types and repeated malformed publication dates do
not hide otherwise readable notifications.

## Node API

```ts
import {
  discoverInbox,
  sendNotification,
  notifyAgent,
  readInbox,
} from "solid-agent-notify";

// 1. Discover an agent's LDN inbox from their WebID profile (ldp:inbox).
const inbox = await discoverInbox("https://alice.example/card#me");
//    → "https://alice.example/inbox/"  | undefined (no/ambiguous/unsafe inbox)

// 2. POST an AS2.0 notification to a KNOWN inbox.
await sendNotification(inbox!, {
  type: "Invite",                          // Announce | Invite | Offer | Create | Update | Add | Remove
  actor: "https://me.example/card#me",     // → as:actor
  object: "https://me.example/chat/",      // → as:object  (http(s) IRIs only)
  summary: "Join the chat",                // → as:summary
});

// 3. Discover + send in one step.
await notifyAgent({
  recipientWebId: "https://alice.example/card#me",
  actorWebId: "https://me.example/card#me",
  type: "Announce",
  content: "Hello over the federation.",
});

// 4. Read + parse the notifications in an inbox (newest first).
const notifications = await readInbox(inbox!);
//    → InboxNotification[]  ({ url, type, actor?, object?, target?, summary?, content?, published? })
```

All four accept a final `NotifyOptions` argument (`timeoutMs`; the send path also
takes an advanced `extend` hook — see Federation tasks below; and TEST-only
`allowLoopback` / `dnsLookup` / `fetchImpl`).

### Federation tasks (`wf:Task`)

The headline cross-pod use case is a **"task assigned" / "task state changed"**
notification: an `as:Announce` whose `as:object` IS a shared `wf:Task` (the SolidOS
workflow-ontology task/issue — the same shape [`solid-issues`](https://github.com/jeswr/solid-issues)
and the Pod Manager read/write). The shared terms are pinned by the federation
vocab document at [`https://w3id.org/jeswr/task`](https://w3id.org/jeswr/task) — a canonical
**re-use** of `wf:` + `dct:` + `as:`, not new terms: a task is a `wf:Task`, its
state is `rdf:type wf:Open|wf:Closed`, metadata is `dct:title`/`dct:description`/
`dct:created`/`dct:creator`, assignment is `wf:assignee`.
`TASK_NS` names the canonical task namespace, `https://jeswr.org/ns/task#`.
`TASK_VOCAB` retains the published vocabulary document URL above; changing a
document reference is outside this namespace migration. Task RDF uses only the standard
`wf:`, `dct:` and `as:` terms, so existing notifications remain readable without
rewriting their data or vocabulary/document references.

```ts
import {
  notifyTaskAssigned,
  notifyTaskStateChanged,
  buildTaskNotification,
  parseTaskFromNotification,
} from "solid-agent-notify";

// Assign a task to an agent (discover their inbox + deliver the Announce+wf:Task).
// `wf:assignee` defaults to the recipient unless the task already names one.
await notifyTaskAssigned({
  recipientWebId: "https://bob.example/card#me",
  actorWebId: "https://me.example/card#me",
  task: {
    task: "https://me.example/tasks/42#it",  // the wf:Task subject IRI
    title: "Review the PR",                  // → dct:title
    description: "Check the SSRF guard.",     // → dct:description
    // state defaults to "Open"; created defaults to now; creator optional.
  },
  summary: "A task was assigned to you",      // → as:summary on the Announce
});

// Announce a state change (Open ↔ Closed).
await notifyTaskStateChanged({
  recipientWebId: "https://bob.example/card#me",
  actorWebId: "https://me.example/card#me",
  task: { task: "https://me.example/tasks/42#it" },
  state: "Closed",
});

// Build the notification dataset yourself (e.g. to POST elsewhere)…
const store = buildTaskNotification(
  { task: "https://me.example/tasks/42#it", title: "Triage", assignee: "https://bob.example/card#me" },
  { actor: "https://me.example/card#me" },
);
// …and read a task back out of a parsed notification:
const task = parseTaskFromNotification(activitySubject.value, dataset);
//   → { task, state?, title?, description?, assignee?, creator?, created? } | undefined
```

`TaskDoc` (the typed `wf:Task` accessor), `writeTask` (embed a task into any
dataset), and `parseTask` (read a `wf:Task` subject) are also exported. Under the
hood the send helpers use the send-path `extend` hook to embed the `wf:Task`
**alongside** the activity in the SAME dataset, so it is delivered in one
SSRF-guarded POST — no second request, same egress chokepoint.

### Errors

- `NoInboxError` — the recipient advertises no (or an ambiguous) inbox.
- `NotificationSendError` (`.inbox`, `.status`) — the inbox refused the POST. A
  `status` of `0` means the egress guard refused the target (SSRF / scheme / port /
  refused redirect / network) and **no POST was issued**.
- `SsrfError` / `GuardedFetchError` / `BodyTooLargeError` — the guard layer (also
  re-exported). `discoverInbox` / `readInbox` swallow these into `undefined` / `[]`.

The lower-level `guardedFetch`, the AS2.0 model (`buildActivity`, `ActivityDoc`,
`serializeTurtle`), and the SSRF primitives (`isPublicAddress`, `assertNotSsrf`, …)
are exported for advanced callers and tests.

## The DNS-pinned SSRF guard (the only egress path)

`guardedFetch` is the single chokepoint. The SSRF **mechanism** is delegated to the
shared, single-reviewed [`@jeswr/guarded-fetch`](https://github.com/jeswr/guarded-fetch)
library (its `./node` `createNodeGuardedFetch`) — the consolidation of this package's
former inline guard plus the federation-client / community-feeds / prod-solid-server
copies. `guardedFetch` is a thin wrapper that adds agent-notify's own **posture** on
top and serves both the RDF `GET` path (profile / inbox / member reads) and the LDN
`POST` path (delivery). Defence-in-depth, every step fails closed:

1. **Scheme gate** — `https:` only in production (`http:` only under the TEST-only
   `allowLoopback` hook).
2. **Port gate** — `443` only in production; **reject userinfo**.
3. **Hostname denylist** — cloud-internal names (`metadata.google.internal`,
   `*.internal`, `*.svc.cluster.local`, `localhost`, `*.local`, …) refused
   **before** DNS, closing split-horizon-DNS gaps; alternate IPv4 encodings
   (decimal / hex / octal / short-form) normalised first. (agent-notify passes its
   STRICTER denylist — incl. `localhost` / `*.localhost` / `*.local` — to the library.)
4. **DNS resolve ALL records** → classify **every** A/AAAA as public (refusing
   loopback, RFC-1918, link-local incl. `169.254.169.254`, CGNAT, multicast,
   reserved/TEST-NET, IPv6 ULA/link-local, IPv4-mapped, 6to4- and NAT64-embedded
   private v4).
5. **Pin into the socket** — the library's undici `Agent({ connect: { lookup } })`
   validates every connect-time record and pins the connection to the **validated**
   IP, closing the DNS-rebinding lookup→connect TOCTOU (a hostile resolver cannot
   swap the address between the guard and the connect).
6. **One timeout** over fetch + redirects + body.
7. **`redirect: "manual"`** — a **GET** re-classifies + re-pins **each hop** and
   rejects a scheme downgrade / a redirect loop / the redirect cap; a **POST**
   refuses to follow **any** 3xx (an authenticated POST must never be transparently
   bounced to a private/metadata origin — the confused-deputy this layer prevents).
8. **Content-type allowlist** on a final GET (the RDF set; `text/html`/RDFa
   excluded); a POST receipt is bounded but not allowlisted. (agent-notify's wrapper.)
9. **Bounded body read** — capped at the per-call byte limit; an over-cap body is
   refused (`BodyTooLargeError`).

`guardedFetch`'s public surface is unchanged: the bespoke `GuardedFetchResult` shape,
the `GuardedFetchError` / `SsrfError` / `BodyTooLargeError` error taxonomy, and the
`isPublicAddress` / `isLoopbackAddress` / `assertNotSsrf` / `isDeniedHostname` /
`normalizeHostForClassification` primitives are all preserved (the classifiers now
re-export from `@jeswr/guarded-fetch`). The egress invariant is enforced in CI:
`npm run check:fetch` fails the build if any source file outside the guard references
a raw `fetch(` / `undici` (the `@jeswr/guarded-fetch/node` import is the designated
egress layer). Because the library's `./node` path uses undici, this package requires
**Node ≥ 22.19.0**.

> **Why this replaces a host-string validator.** A name-only validator (e.g. the
> one originally in the Pod Manager) inspects the host *string*: a public DNS name
> that **resolves** to `127.0.0.1` / `169.254.169.254` passes it, and the fetch then
> connects to the private address. This package resolves + classifies + pins the
> actual IP, so that rebinding gap is closed.

## RDF

Parsing uses [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf) (`parseRdf`,
Turtle / JSON-LD / N-Triples / N-Quads) and the typed accessors of
[`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper) over an
[`n3`](https://github.com/rdfjs/N3.js) store. Notifications are **built and read via
typed accessors** — never hand-concatenated triples.

## Scripts

```bash
npm run build       # tsc → dist/ (workspace output is gitignored)
npm test            # vitest run
npm run test:coverage
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run check:fetch # the single-egress-chokepoint guard
```

## License

[MIT](./LICENSE)

`includeUnknownActivities: true` preserves even empty readable RDF documents as unknown
notifications. Issues uses this to retain its original untyped-inbox behavior; the display
fallback is a label and does not assert an ActivityStreams Notification class.
