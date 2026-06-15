# solid-agent-notify

> ⚠️ **Experimental — AI-agent-generated.** This package was created by an AI coding agent (Claude Opus 4.8, @jeswr's PSS agent) and is under active development. It is not yet production-hardened — review before relying on it.

SSRF-hardened cross-pod **Linked Data Notifications (LDN)** for Solid: discover an
agent's `ldp:inbox`, POST an [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)
notification to it, and read an inbox — with **every outbound dereference forced
through a single DNS-pinned, redirect-revalidating egress chokepoint**.

This is the cross-pod notify path for the Solid federation MVP. It is
**security-critical**: every `send`/`read`/`discover` fetches an
attacker-influenced URL (a recipient WebID, an advertised inbox, an inbox member),
so all egress goes through `guardedFetch`, the only permitted way to fetch an
external URL in this package.

## Install

```bash
npm install solid-agent-notify
# or directly from a GitHub branch (no build step needed — see note below):
npm install github:jeswr/solid-agent-notify#main
```

Node ≥ 20, ESM-only.

> **`dist/` is committed** so the package installs directly from a GitHub branch
> (`npm install github:jeswr/solid-agent-notify#main`) **without a build step** —
> consumers under `ignore-scripts=true` never run this package's `prepare`/`build`,
> so the built `dist/` ships in the repo. npm publish is a deferred migration.
> **Maintainers:** rebuild `dist/` whenever source changes — `npm run build`,
> then commit `dist/` in the same change — so the committed artifact never drifts
> from `src/`.

## API

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
vocab at [`https://w3id.org/jeswr/task`](https://w3id.org/jeswr/task) — a canonical
**re-use** of `wf:` + `dct:` + `as:`, not new terms: a task is a `wf:Task`, its
state is `rdf:type wf:Open|wf:Closed`, metadata is `dct:title`/`dct:description`/
`dct:created`/`dct:creator`, assignment is `wf:assignee`.

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
const task = parseTaskFromNotification(activitySubject, dataset);
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

`guardedFetch` is the single chokepoint. It is ported from the canonical DNS-pinned
guard in [`solid-webid-index`](https://github.com/jeswr/solid-webid-index)
(prod-solid-server lineage) and extended so the **same** guard serves both the RDF
`GET` path (profile / inbox / member reads) and the LDN `POST` path (delivery).
Defence-in-depth, every step fails closed:

1. **Boot assertion** — requires a Node runtime with `node:net#isIP` (DNS-pinning
   needs `node:dns`); fails at load otherwise.
2. **Scheme gate** — `https:` only in production (`http:` only under the TEST-only
   `allowLoopback` hook).
3. **Port gate** — `443` only in production; **reject userinfo**.
4. **Hostname denylist** — cloud-internal names (`metadata.google.internal`,
   `*.internal`, `*.svc.cluster.local`, `localhost`, `*.local`, …) refused
   **before** DNS, closing split-horizon-DNS gaps; alternate IPv4 encodings
   (decimal / hex / octal / short-form) normalised first.
5. **DNS resolve ALL records** → classify **every** A/AAAA as public (refusing
   loopback, RFC-1918, link-local incl. `169.254.169.254`, CGNAT, multicast,
   reserved/TEST-NET, IPv6 ULA/link-local, IPv4-mapped, 6to4- and NAT64-embedded
   private v4); **pin the first validated IP**.
6. **Pin into the socket** — an undici `Agent({ connect: { lookup: pinnedLookup(ip) } })`
   makes the connection use the **validated** IP, closing the DNS-rebinding TOCTOU
   (a hostile resolver cannot swap the address between the guard and the connect).
7. **One timeout** over fetch + redirects + body.
8. **`redirect: "manual"`** — a **GET** re-classifies + re-pins **each hop** and
   rejects a scheme downgrade / a redirect loop / the redirect cap; a **POST**
   refuses to follow **any** 3xx (an authenticated POST must never be transparently
   bounced to a private/metadata origin — the confused-deputy this layer prevents).
9. **Content-type allowlist** on a final GET (the RDF set; `text/html`/RDFa
   excluded); a POST receipt is bounded but not allowlisted.
10. **Bounded body read** — streams up to a byte cap, aborting past it.

The invariant is enforced in CI: `npm run check:fetch` fails the build if any source
file outside the guard references a raw `fetch(` / `undici`.

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
npm run build       # tsc → dist/  (also runs on `prepare`, so git-dep installs work)
npm test            # vitest run
npm run test:coverage
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm run check:fetch # the single-egress-chokepoint guard
```

## License

[MIT](./LICENSE)
