<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/solid-agent-card

> **The Solid pod / WebID → agent pointer.** Given a pod or WebID, emit and consume a
> machine-readable "how an agent should interact with me" descriptor, anchored on the WebID.

This is **M1** of the [agentic-Solid roadmap][roadmap] — *"the README points to an agent."* A
person's Solid pod advertises the agent that represents them, discoverable both by **industry**
tooling (an [A2A][a2a] Agent Card, plain JSON) and by **RDF** tooling (an [ANP][anp]-aligned Agent
Description, JSON-LD / Turtle), anchored on their WebID.

> ⚠️ **Experimental, AI-agent-generated.** Not production-hardened. The A2A card schema and the ANP
> Agent Description context are fast-moving drafts pinned as config constants (watch items).

## Why this package, and why first

The roadmap's central finding is that *the integration is the novel contribution* — the lower
layers (WebID, A2A cards, ANP descriptions) already exist as standards. M1 is the **dependency-free
discovery anchor** the rest of the roadmap (the M2 SHACL protocol-document, the M4 VC/ZK-SPARQL
credential layer) attaches to: an agent has to be *findable and self-describing* before two agents
can negotiate. It is **separate-codebase** with **zero `prod-solid-server` core risk** for the
common case — the pod serves the descriptor documents as ordinary resources. See
[`docs/design/agentic-solid-infrastructure.md`][roadmap] §M1 / §III.2.

## Install

Published from a GitHub branch (the committed `dist/` makes it installable under the suite's
`ignore-scripts=true` invariant with no build step):

```sh
npm install github:jeswr/solid-agent-card#main
```

## What it does — the public API

```ts
import {
  describeAgent,     // EMIT: AgentDescriptor → { A2A Agent Card (JSON), ANP Agent Description (RDF) }
  buildAgentPointer, // EMIT: the person→agent pointer triple for a WebID profile
  discoverAgent,     // CONSUME: WebID → read the agent pointer → resolve + verify the descriptor
  verifyDescriptor,  // VALIDATE: fetch/parse + validate an Agent Description document
  verifyDataset,     // VALIDATE: an already-parsed RDF dataset (no second fetch)
  agentDescriptionsUrl, agentCardUrl, // the ANP / A2A .well-known discovery URLs for an origin
} from "@jeswr/solid-agent-card";
```

### Emit — describe an agent (two co-located descriptors from one source)

`describeAgent` projects a single `AgentDescriptor` domain object into **both** an A2A Agent Card
and an ANP Agent Description, so the two encodings cannot drift:

```ts
const { agentCard, agentDescription } = describeAgent({
  id: "https://alice.pod.example/agent",            // the agent IRI (its stable id)
  name: "Alice's Agent",
  owner: "https://alice.pod.example/profile/card#me", // the WebID it represents
  skills: [{ id: "schedule", name: "Scheduling", tags: ["calendar"] }],
  securitySchemes: [{ type: "solid-oidc", issuer: "https://idp.example/" }],
  protocolSources: ["https://alice.pod.example/protocols/exchange#v1"], // M2 protocol docs
});

// Serve the A2A card (plain JSON) at /.well-known/agent-card.json:
JSON.stringify(agentCard);
// Serve the ANP description at /.well-known/agent-descriptions:
await agentDescription.toTurtle();   // text/turtle (default; pass a media type for N-Triples etc.)
await agentDescription.toJsonLd();   // a JSON-LD object with a self-contained, inline @context
```

### Emit — the person→agent pointer in a WebID profile

```ts
const ptr = buildAgentPointer(
  "https://alice.pod.example/profile/card#me",
  "https://alice.pod.example/agent",
  "interop:hasAuthorizationAgent", // default; pass "schema:agent" or both for max reach
);
await ptr.toString(); // PATCH/PUT these quads into the WebID profile (client-side; no server change)
```

### Consume — discover the agent that represents someone

```ts
const result = await discoverAgent("https://alice.pod.example/profile/card#me", { fetch });
//  → { webId, pointers: [{ predicate, agent }], descriptor?, verification? }
if (result.verification?.valid) {
  result.descriptor; // the verified AgentDescriptor: name, skills, securitySchemes, protocolSources…
}
```

`discoverAgent` reads the pointer across the standard predicates in priority order
(`interop:hasAuthorizationAgent`, then `schema:agent`), follows it, and **verifies** the resolved
Agent Description — including a **subject-binding spoofing guard** (a document served at URL A may
not describe a different agent B). Pass `{ resolveDescriptor: false }` to read pointers only.

## Security — the fetch seam is the SSRF boundary

`discoverAgent` and `verifyDescriptor` fetch remote documents: `discoverAgent`
follows the agent-pointer IRI read from a (possibly untrusted) WebID profile, and
`verifyDescriptor` fetches the URL it is given. **The injected `fetch` is the SSRF
boundary.** In a **server / Node** context the default `globalThis.fetch` is *not*
SSRF-guarded, so a hostile profile could point the second fetch at an internal
address (e.g. cloud metadata). When resolving **untrusted** WebIDs/URLs on a
server, inject an SSRF-guarded fetch — e.g. the suite's
[`@jeswr/guarded-fetch`][guarded-fetch] node fetch (DNS-pinned,
private-range-blocking):

```ts
// pass a guarded `fetch` (an SSRF-guarded node fetch, or your authed Solid fetch
// wrapped by one) — its exact export is that package's concern:
await discoverAgent(untrustedWebId, { fetch: guardedNodeFetch });
```

In a browser, CORS only limits which cross-origin *responses* your code can read —
it does **not** stop the request being *issued* to an internal target, and a
permissively-CORS internal endpoint could still be read. So treat untrusted
browser-side discovery as only partially guarded, and prefer allowlisting or
guarded resolution of the pointer IRI in any privileged context. Two other
guarantees are independent of the fetch seam and always on: the **subject-binding
spoofing guard** (a document served at URL A may not describe a different agent B)
and the **self-contained inline JSON-LD `@context`** the emitter uses (no
remote-context dereference on parse). Prefer the in-hand
`verifyDescriptor(input, { body })` / `verifyDataset` paths when you already have
the RDF — they never touch the network.

## Descriptor shape

The descriptor uses **standard external vocabularies only** — no bespoke `@jeswr/…` agent vocab is
minted:

| Concept | Vocabulary | Term |
|---|---|---|
| person → agent pointer | Solid Interop (SAI) | `interop:hasAuthorizationAgent` (primary) |
| person → agent pointer | schema.org | `schema:agent` (industry reach) |
| agent self-description | ANP Agent Description | `ad:AgentDescription` + `ad:name` / `ad:url` / `ad:owner` / `ad:skill` / `ad:securityScheme` / `ad:protocolSource` |

The **A2A Agent Card** is a deliberately small, spec-shaped JSON subset, carrying the Solid/ANP
pointers (owner WebID, RDF Agent Description URL, M2 protocol sources) under an `x-solid` extension
block that plain A2A tooling ignores. The **ANP Agent Description** is the RDF reach: the emitted
JSON-LD embeds a **self-contained inline `@context`** (not a bare remote URL) so it parses offline,
deterministically, with no SSRF / availability dependency on a CG-draft context endpoint.

### Validation issue codes

`verifyDescriptor` / `verifyDataset` return `{ valid, descriptor?, issues[] }`. Each issue carries a
machine-readable `code`: `no-agent-description`, `multiple-agent-descriptions`, `subject-mismatch`,
`missing-name`, `missing-url`, `invalid-url`, `invalid-owner`, `skill-missing-id`,
`skill-missing-name`, `duplicate-skill-id`, `invalid-security-scheme`, `invalid-protocol-source`,
`fetch-failed`, `parse-failed`.

## Scope note (what this is NOT)

Per the roadmap, M1 uses a **plain own-WebID Solid-OIDC DPoP** security scheme. Delegated
(`act`-chain) tokens, server-side ODRL enforcement, and Access-Grant scope-down are **later, gated
CORE-PSS milestones (M5)** and are deliberately not part of this package. The hash-pinned RDF/SHACL
protocol-document *bodies* referenced by `protocolSources` are **M2** (`@jeswr/agora-rdf`); M1 only
carries the links.

## RDF discipline

Parse via [`@jeswr/fetch-rdf`][fetch-rdf] (Turtle / JSON-LD content-negotiation), read/write terms
via [`@rdfjs/wrapper`][wrapper] typed accessors, serialise via `n3.Writer`. **Never a bespoke
parser; never a hand-built triple** — all RDF goes through the typed wrappers in `src/wrappers.ts`.

## Development

```sh
npm run lint        # Biome over src test scripts
npm run typecheck   # build:deps → tsc --noEmit
npm test            # build:deps → vitest run
npm run build       # esbuild (bundles @jeswr/fetch-rdf inline) + tsc (.d.ts) → committed dist/
npm run check:dist  # guard the committed dist/ against drift from src/
npm run check:lockfile-transport  # guard package-lock.json against the SSH git transport (#78)
```

`check:lockfile-transport` is a recurrence guard for the [#78][i78] bug class: `npm install`
silently rewrites the `@jeswr/fetch-rdf` github: dependency's `resolved` URL in `package-lock.json`
to the SSH transport (`git+ssh://git@github.com/...`), which fails `npm ci` in CI / Vercel without
an SSH key. The guard fails if any committed lockfile contains an SSH git transport — rewrite each
to `git+https://github.com/...` and re-run.

`@jeswr/fetch-rdf` is an off-npm git dependency that ships no usable `dist/` under
`ignore-scripts=true`; `scripts/build-deps.mjs` builds it once after install (pinned to the exact
lockfile-resolved commit), and `scripts/build-dist.mjs` **inlines** it into the committed
`dist/index.js` so consumers need no build step.

## License

[MIT](./LICENSE) © Jesse Wright

[roadmap]: https://github.com/jeswr/prod-solid-server/blob/main/docs/design/agentic-solid-infrastructure.md
[a2a]: https://a2a-protocol.org/latest/specification/
[anp]: https://w3c-cg.github.io/ai-agent-protocol/
[fetch-rdf]: https://github.com/jeswr/fetch-rdf
[guarded-fetch]: https://github.com/jeswr/guarded-fetch
[wrapper]: https://github.com/rdfjs-base/wrapper
[i78]: https://github.com/jeswr/prod-solid-server/issues/78
