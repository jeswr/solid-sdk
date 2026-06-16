<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/solid-a2a

> **The NL→RDF upgrade for agent-to-agent exchange.** Parse a natural-language agent request into a
> structured RDF *intent* graph grounded in standard vocabularies, SHACL-validate it against a
> hash-pinned, content-addressed **Protocol Document** whose body is a SHACL shape, and encode the
> NL→RDF *upgrade handshake* — with a no-silent-downgrade rule for security-bearing steps.

This is **M2** of the [agentic-Solid roadmap][roadmap] — *"the NL→RDF upgrade: an AGORA protocol
document, made RDF/SHACL-native."* Two agents talk natural language first (maximum reach); when both
understand it they **upgrade to a structured RDF representation**, so they negotiate over
machine-readable Linked Data rather than opaque text — and a request maps onto a pod's actual
shapes/affordances. The genuinely-novel slice, per the roadmap: *crystallising the negotiated
protocol as a SHACL shape (not free JSON), pod-hosted, hash-pinned, and SHACL-validated on the wire.*

> ⚠️ **Experimental, AI-agent-generated.** Not production-hardened. Builds on the
> [AGORA][agora] hash-pinned-protocol-document model (the maintainer is an AGORA co-author) and
> extends [ANP][anp]'s NL→structured meta-protocol with a SHACL-bodied Protocol Document.

## Why this package

The roadmap's central finding is that *the integration is the novel contribution* — the lower layers
(A2A NL exchange, ANP JSON-LD descriptions) already exist. M2 contributes the **RDF/SHACL-native**
upgrade: a Protocol Document whose `specification` body is a SHACL shape, content-addressed
(hash-pinned), so that after the one-time NL negotiation two agents exchange SHACL-validated RDF with
**no further LLM inference**. It composes with **M1** ([`@jeswr/solid-agent-card`][m1]): a Protocol
Document's hash/URL is exactly what goes into an `AgentDescriptor.protocolSources`.

This package is the **translator + SHACL-PD + handshake codec library** only. It builds **no
networking / live transport** — the runtime carrier is a separate `@jeswr/solid-agent` package (per
the roadmap). It is **separate-codebase** with **zero `prod-solid-server` core risk**.

## Install

Published from a GitHub branch (the committed `dist/` makes it installable under the suite's
`ignore-scripts=true` invariant with **no build step**):

```sh
npm install github:jeswr/solid-a2a#main
```

## The public API

```ts
import {
  parseIntent,           // NL → structured RDF intent (deterministic path, or injected translate fn)
  intentToTurtle, intentToJsonLd, parseIntentGraph, intentFromRdf, // serialise + round-trip
  buildShapeForIntent, buildResponseShape,        // prebuilt SHACL request/response shapes
  validateIntent,        // SHACL-validate an intent against a shape / Protocol Document
  buildProtocolDocument, verifyProtocolDocument, hashQuads, // SHACL-bodied, hash-pinned PD
  encodeUpgradeOffer, decodeUpgradeOffer,         // the upgrade-handshake codec …
  encodeUpgradeResponse, decodeUpgradeResponse,
  mayDowngradeToNl,      // … and the no-silent-downgrade rule
  handshakeToRdf, handshakeToTurtle, handshakeFromRdf, // the handshake's RDF form
} from "@jeswr/solid-a2a";
```

### 1. NL → RDF intent — the deterministic path (no model)

`parseIntent` tries a **deterministic rule/template path** first, covering the common verbs with no
model and no network. It returns the structured `Intent`, its RDF quads, and which path produced it.

```ts
const result = await parseIntent("share read and write access to https://alice.pod/notes.ttl with https://bob.pod/me");
// result.resolved === true
// result.source   === "deterministic"
// result.intent   === {
//   id: "urn:a2a:intent:…",
//   action: "grant",
//   target: "https://alice.pod/notes.ttl",
//   recipient: "https://bob.pod/me",
//   modes: ["Read", "Write"],
// }
// result.quads    === [ …the a2a:Intent graph… ]
```

An input the deterministic path cannot classify returns an **unresolved** result (it does **not**
throw for an ordinary miss):

```ts
const r = await parseIntent("ponder the universe");
// r.resolved === false, r.reason === "no deterministic verb matched and no translate function was supplied."
```

### 2. NL → RDF intent — the injected `translate` seam (your own LLM)

For inputs the deterministic path can't handle, inject an async `translate` function. **This package
never calls a model and makes no network call of its own** — the function you pass is the *only*
translator. It is invoked **only** when the deterministic path fails, and its structured draft is
lowered to RDF and validated by this package:

```ts
import type { TranslateFn } from "@jeswr/solid-a2a";

// You wire your own model here — call Claude, a local model, anything.
const translate: TranslateFn = async ({ nl, vocabularyHint, shape }) => {
  const draft = await myModel(nl, { vocabularyHint, shape }); // YOUR code
  return draft; // { action: "delete", target: "https://alice.pod/x" } | null
};

const result = await parseIntent("please obliterate https://alice.pod/x", { translate });
// result.source === "translated"   (the deterministic path missed; the seam resolved it)
```

The seam contract: `translate` receives `{ nl, vocabularyHint?, shape? }` and returns a
`StructuredIntentDraft` (the `Intent` shape minus the synthesised `id`) — or `null`/`undefined` when
it too cannot resolve the input (→ an unresolved result, never a throw). The package validates the
draft (unknown action / malformed fields → unresolved) before lowering it to RDF.

### 3. Serialise + round-trip

```ts
const ttl   = await intentToTurtle(result.intent);          // text/turtle (n3.Writer)
const jsonld = intentToJsonLd(result.intent);               // JSON-LD with a self-contained @context
const back  = await parseIntentGraph(ttl);                  // RDF → Intent (lossless on the fields)
const back2 = await parseIntentGraph(JSON.stringify(jsonld), "application/ld+json");
```

Round-trip is **lossless on the intent fields** (action, target, recipient, modes, parameters,
agent, and the minted intent id).

### 4. SHACL validation

`validateIntent` SHACL-validates an intent against a request shape (or a Protocol Document) via
[`rdf-validate-shacl`][rvs]. It returns a **structured report** and **never throws** on
non-conformance:

```ts
const shape = buildShapeForIntent("read");        // a prebuilt SHACL NodeShape for read intents
const report = await validateIntent(result.intent, shape);
// report === { conforms: true, results: [] }

const bad = await validateIntent({ id: "urn:i", action: "read" }, shape); // no target
// bad.conforms === false
// bad.results[0] === { message, sourceConstraintComponent, focusNode, path, severity }
```

`buildShapeForIntent(action)` ships shapes for all nine core intents; `buildResponseShape(classIri)`
builds a (deliberately permissive) response shape so a Protocol Document has one out of the box.

### 5. Build + hash-pin a Protocol Document (SHACL body)

A **Protocol Document** is the SHACL-bodied, content-addressed protocol both agents agree on:

```ts
const pd = buildProtocolDocument({
  requestShape:  buildShapeForIntent("read"),
  responseShape: buildResponseShape("https://schema.org/ReadAction"),
  meta: { id: "https://alice.pod/protocols/read#v1", name: "Read protocol", version: "1" },
});

pd.hash;                 // "sha256:…" — a content hash over the canonical serialisation of the PD
await pd.toTurtle();     // the SHACL-bodied document (Turtle)
await pd.toJsonLd();     // the metadata + shape links, with the inline @context (discovery view)
```

`pd.hash` is **deterministic + stable** across runs for the same logical document (blank-node labels
are normalised before hashing — see `canonicalNQuads`). An upgrading peer verifies a fetched body
against its pin **before** trusting it:

```ts
const fetchedTurtle = await fetch(protocolSource).then((r) => r.text());
const trusted = await verifyProtocolDocument(fetchedTurtle, offer.protocolHash); // true | false (never throws)
```

> **Hash choice.** AGORA pins by **SHA1**; this package uses **SHA-256** — SHA1's collision
> resistance is broken, which is the exact property a content address relies on. The algorithm is
> exposed (`PROTOCOL_HASH_ALGORITHM`) and a hash carries its `sha256:` prefix so a verifier knows
> what it was computed with.

The PD's `id`/`hash` is what goes into an **M1** `AgentDescriptor.protocolSources` — that is how an
upgrading peer discovers the protocol to fetch.

### 6. The upgrade-handshake codec (+ no silent downgrade)

The handshake rides over A2A as a DataPart. This package provides the **transport-agnostic codec +
the data shapes** (plain objects *and* their RDF form) — **no networking**:

```ts
// Agent A offers to upgrade to the RDF/SHACL protocol it pinned:
const offer = encodeUpgradeOffer({
  protocolHash: pd.hash,
  protocolSource: pd.meta.id,
  required: true,            // a SECURITY-bearing step — must NOT silently fall back to NL
  protocolName: "Read protocol",
});

// Agent B responds:
const response = encodeUpgradeResponse({ protocolHash: pd.hash, accept: false, reason: "unsupported" });

// The no-silent-downgrade decision:
mayDowngradeToNl(offer, response);   // false — a REQUIRED protocol can never be downgraded to NL
```

The **security rule** (the roadmap's cross-cutting invariant): *a security-bearing exchange must not
be downgradeable to unsigned NL.* The `required` flag expresses this in the codec — for a `required`
protocol, `mayDowngradeToNl` always returns `false`, so a consumer **refuses** the exchange rather
than dropping to plaintext NL when a peer declines the upgrade. (This package does **not** enforce
signatures — it just forecloses *silent* downgrade as the default for a required step.) For an
optional, capability-only protocol, NL fallback is allowed when the peer declines.

The handshake also has an RDF form (an RDF-native DataPart) that round-trips:

```ts
const ttl  = await handshakeToTurtle(offer);
const back = await handshakeFromRdf(ttl);   // === offer (required flag + name preserved)
```

## Vocabulary

LD/SW best practice — **reuse standard terms where one fits**; mint a **minimal** `@jeswr/` extension
only for the intent-glue that standards lack (never the `@solid/` scope — that belongs to the W3C
Solid org). The intent action verbs map as:

| Intent verb (synonyms) | RDF action type | ACL mode (for `grant`) |
|---|---|---|
| read / get / fetch / retrieve / view / open / download | `schema:ReadAction` | `acl:Read` |
| create / write / put / add / upload / store / save | `schema:CreateAction` | `acl:Write` |
| update / modify / change / edit / patch / replace | `schema:UpdateAction` | — |
| append / add to / log / post to | `a2a:AppendAction` *(minted)* | `acl:Append` |
| delete / remove / erase / destroy | `schema:DeleteAction` | — |
| list / enumerate / browse | `a2a:ListAction` *(minted)* over an `ldp:Container` | — |
| share / grant / give-access / authorize | `a2a:GrantAction` *(minted)* + `schema:recipient` + `a2a:mode` | `acl:Read`/`Write`/`Append`/`Control` |
| subscribe / watch / notify | `a2a:SubscribeAction` *(minted)* | — |
| query / search / find / look up | `a2a:QueryAction` *(minted)* | — |

| Concept | Vocabulary | Term |
|---|---|---|
| action verbs (read/create/update/delete) | [schema.org Action][schema] | `schema:ReadAction` / `CreateAction` / `UpdateAction` / `DeleteAction` |
| action object / target / recipient / agent | schema.org | `schema:object` / `schema:target` / `schema:recipient` / `schema:agent` |
| grant modes | [ACL/WAC][acl] | `acl:Read` / `acl:Write` / `acl:Append` / `acl:Control` |
| container target | [LDP][ldp] | `ldp:Container` |
| protocol shapes | [SHACL][shacl] | `sh:NodeShape` / `sh:property` / `sh:path` / … |

**Minted `a2a:` terms** (`https://w3id.org/jeswr/a2a#` — documented in `src/vocab.ts`), used only
where no standard equivalent exists: `a2a:Intent` (the request envelope), `a2a:action` /
`a2a:parameter` / `a2a:paramKey` / `a2a:paramValue` / `a2a:mode` (intent glue), the four action
subtypes schema.org lacks (`a2a:AppendAction` / `ListAction` / `GrantAction` / `SubscribeAction` /
`QueryAction`), `a2a:ProtocolDocument` + `a2a:requestShape` / `a2a:responseShape`, and the handshake
classes (`a2a:UpgradeOffer` / `a2a:UpgradeResponse`). Emitted JSON-LD embeds a **self-contained
inline `@context`** (not a remote URL) so it parses offline + deterministically with no SSRF /
availability dependency — the same rationale as M1.

## The injected-translate seam contract

- **You wire your own LLM.** This package never imports or calls a model and makes no network call of
  its own. The `translate` function you pass is the only translator.
- It is called **only when the deterministic path fails** — so the common verbs cost no model call.
- It returns a plain `StructuredIntentDraft` (or `null`/`undefined` to signal "couldn't resolve").
  The package validates it and lowers it to RDF; an invalid draft yields an unresolved result, not a
  throw.
- This keeps the package fully testable with a mocked `translate` and lets the consumer choose any
  model. (See `test/translate.test.ts` for the mocked-seam tests, including the assertion that no
  `fetch` is ever issued.)

## RDF discipline

Parse via [`@jeswr/fetch-rdf`][fetch-rdf], read/write terms via [`@rdfjs/wrapper`][wrapper] typed
accessors (in `src/wrappers.ts`), serialise via `n3.Writer`, SHACL-validate via
[`rdf-validate-shacl`][rvs]. **Never a bespoke parser; never a hand-built triple.**

## Development

```sh
npm run lint        # Biome over src test scripts
npm run typecheck   # build:deps → tsc --noEmit
npm test            # build:deps → vitest run
npm run build       # esbuild (bundles @jeswr/fetch-rdf inline) + tsc (.d.ts) → committed dist/
npm run check:dist  # guard the committed dist/ against drift from src/
```

`@jeswr/fetch-rdf` is an off-npm git dependency that ships no usable `dist/` under
`ignore-scripts=true`; `scripts/build-deps.mjs` builds it once after install (pinned to the exact
lockfile-resolved commit), and `scripts/build-dist.mjs` **inlines only it** into the committed
`dist/index.js`. Everything else — `n3`, `@rdfjs/*`, `rdf-validate-shacl` and its `clownface` /
`@vocabulary/sh` / `rdf-dataset-ext` / `rdf-literal` tree — stays **external** (npm-published), so a
consumer resolves one shared copy.

## License

[MIT](./LICENSE) © Jesse Wright

[roadmap]: https://github.com/jeswr/prod-solid-server/blob/main/docs/design/agentic-solid-infrastructure.md
[m1]: https://github.com/jeswr/solid-agent-card
[agora]: https://arxiv.org/abs/2410.11905
[anp]: https://w3c-cg.github.io/ai-agent-protocol/
[schema]: https://schema.org/Action
[acl]: http://www.w3.org/ns/auth/acl
[ldp]: https://www.w3.org/ns/ldp
[shacl]: https://www.w3.org/TR/shacl/
[rvs]: https://github.com/zazuko/rdf-validate-shacl
[fetch-rdf]: https://github.com/jeswr/fetch-rdf
[wrapper]: https://github.com/rdfjs-base/wrapper
