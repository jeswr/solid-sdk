# @solid/agent-notify

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
npm install @solid/agent-notify
# or as a git dependency (a `prepare` build produces dist/ on install):
npm install github:jeswr/solid-agent-notify
```

Node ≥ 20, ESM-only.

## API

```ts
import {
  discoverInbox,
  sendNotification,
  notifyAgent,
  readInbox,
} from "@solid/agent-notify";

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

All four accept a final `NotifyOptions` argument (`timeoutMs`, and TEST-only
`allowLoopback` / `dnsLookup` / `fetchImpl`).

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
