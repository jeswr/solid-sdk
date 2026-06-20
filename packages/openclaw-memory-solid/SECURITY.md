# Security

`@jeswr/openclaw-memory-solid` is an OpenClaw memory backend that writes to the user's Solid pod.
Its threat surface is small by construction: it issues only the injected, already-authenticated pod
`fetch`, and delegates all RDF + pod CRUD to the audited `@jeswr/solid-memory`.

## Posture

### Owner-private by default
The adapter **never sets ACLs** and **never auto-shares** a memory. Defaulting the memory container
to owner-only is the consumer's responsibility (e.g. Pod Manager provisions the container with an
owner-only `.acl`). This package neither relaxes nor advertises any sharing.

### Fail-closed container scope guard (no SSRF / no escape)
Every operation that takes a caller-supplied `id` (`get`, `forget`) asserts that the target URL lies
under the configured container **before any network request is issued** — delegated to
`@jeswr/solid-memory`'s `assertWithinBase`, which checks same-origin **and** path-prefix and throws
for any escape. The adapter constructs its `MemoryStore` with the configured container, so an
attacker-supplied `id` (a foreign origin, a sibling container, a parent path, an encoding trick)
can never make the adapter touch a resource outside the container.

The adapter surfaces that rejection as a **clean typed outcome**, never an unhandled crash:
- `forget(foreignId)` → `{ ok: false, code: "out-of-scope", message }` (no request).
- `get(foreignId)` → `null` (no request).

This is regression-tested: the test asserts that for a set of out-of-container ids (foreign origin,
sibling container, parent path) **no network request is recorded** and the result is the clean
failure shape.

### No remote fetch / no outbound URL the adapter chooses
The adapter introduces **no** network call of its own. The only egress is the injected pod `fetch`,
and the only URLs requested are the configured container and resources under it (mint-on-create,
scope-guarded on every op). There is no user-controlled outbound URL, no redirect-following the
adapter initiates, and no second host — so there is **no SSRF surface** in this package, and
`@jeswr/guarded-fetch` is not required. (If the consumer's injected `fetch` follows redirects, that
is the consumer's `fetch` policy; the adapter never widens the target beyond the scope-guarded
container.)

### PROV-O attribution — threaded, never anonymized
A stored memory is attributed to the **configured** agent WebID (`prov:wasAttributedTo`) and to the
generating conversation (`prov:wasGeneratedBy`) when supplied. The per-call OpenClaw `agent_id` is
**informational identity context only** and is NOT written as the RDF attribution — a tool-call
`agent_id` is free text, not necessarily a WebID IRI, so using it as `prov:wasAttributedTo` would
let a tool call forge an arbitrary attribution. The canonical attribution is the deployment-time
configured WebID. When no `agentWebId` is configured, the memory carries **no** attribution rather
than an invented one.

### Untrusted record drop-not-fatal
Pod contents are untrusted input (a hostile or buggy server, or another app, can write anything
into the container). Two distinct failure modes, with two homes:

- **Wrong-type / hostile-IRI body — handled by `@jeswr/solid-memory`.** A member whose body parses
  but is not a `mem:MemoryItem` reads as `null` and is skipped; an object-property value (e.g.
  `prov:wasAttributedTo`) that is **not** an absolute http(s) IRI (`javascript:`, `mailto:`, a
  relative ref) is **dropped on read**, so a hostile IRI is never surfaced to a consumer that might
  render it as a link.
- **Un-parseable body — handled by THIS adapter.** A member whose body fails to parse (garbage
  Turtle / a syntax error) makes `@jeswr/solid-memory`'s `MemoryStore.get()` **throw**, and its
  `all()` does not guard per-member — so one poisoned member would abort an entire `recall` / `list`
  (an availability hole: any writer to the container could deny an agent all recall). The adapter
  therefore does **not** delegate bulk reads to `all()`; its `recall` / `list` list members and parse
  each individually, **dropping** a member that throws a parse error while **re-throwing a genuine
  network / server error** (a real outage must not be silently swallowed). `get(id)` of a single
  un-parseable resource likewise returns `null`, never a crash.

Both are regression-tested: a container holding a good memory + a garbage (un-parseable) member + a
member with a `javascript:` attribution; recall/list return only the good memory and never surface
the hostile IRI; and a member that 5xxes is asserted to re-throw (not silently drop). Making
`MemoryStore.all()` itself parse-error-resilient is a tracked `@jeswr/solid-memory` follow-up.

### Hard delete (no tombstone yet)
`forget` is a hard `DELETE`. `@jeswr/solid-memory` has no `prov:invalidatedAt` tombstone write API
yet; a soft-delete tombstone is a tracked `@jeswr/solid-memory` follow-up. Until then, "forget"
means the resource is removed from the pod.

## Reporting

Report security issues via a GitHub issue on
[`jeswr/openclaw-memory-solid`](https://github.com/jeswr/openclaw-memory-solid/issues), or to the
maintainer. There is no embargo process for this alpha package.

## References

- [`@jeswr/solid-memory`](https://github.com/jeswr/solid-memory) — the underlying audited model +
  store (scope guard, untrusted-record handling, RDF discipline).
- [`serenichron/openclaw-memory-mem0`](https://github.com/serenichron/openclaw-memory-mem0) +
  [`docs.openclaw.ai`](https://docs.openclaw.ai) — the OpenClaw memory-plugin contract this adapter
  targets (see the README "VERIFIED vs ASSUMED" section).
