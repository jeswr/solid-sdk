<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/federation-trust

> **Experimental — AI-agent-generated.** Authored by an AI coding agent (Claude
> Opus 4.8, @jeswr PSS agent). Under active development; **not
> production-hardened.** Validate against your own data before relying on it.

The cryptographic **trust layer** above the Solid Federation registry's
`fedreg:assertedBy` — a **signed membership challenge**. Where
[`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry) gives
you a *registry-asserted* membership (a `fedreg:Membership` that *names* a
`fedreg:assertedBy` authority but carries no signature), this package gives you a
**registry-asserted membership backed by a verifiable signature**: an authority A
signs *"app X is a member of federation F with status S, asserted by A"* as a W3C
**Verifiable Credential 2.0**, so a consumer trusts the membership because a
cryptographic signature binds it to A's key — not because a triple says so.

This is the trust framework follow-up of the data-federation architecture (R9 O2 /
R3 — *"who may assert / who may approve"*).

## Why a separate package

`@jeswr/federation-registry` is deliberately the **discovery axis** and is
signature-free — its `verifyMembership()` checks only that a record is *well-formed*
and names an `assertedBy` authority; its own README says the signed challenge
"layers above this vocabulary". `@jeswr/federation-trust` **is** that layer. It
**composes — and duplicates nothing**:

| Concern | Package | What it provides |
|---|---|---|
| The proof + credential machinery | [`@jeswr/solid-vc`](https://github.com/jeswr/solid-vc) | VC 2.0 data model, the Data Integrity proof suite (EdDSA / ECDSA over RDFC-1.0 via `jose`/WebCrypto), the fail-closed verify pipeline, **the pluggable proof-suite seam** |
| The membership vocabulary | [`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry) | `fedreg:app` / `fedreg:status` / `fedreg:assertedBy`, the four `MembershipStatus` values, `statusName`, `TRUSTED_STATUS` |
| **The signed membership challenge** | **`@jeswr/federation-trust`** (this package) | **issue / verify a signed membership credential + an optional delegation chain to a trust anchor** |

A signed membership credential **is** a `@jeswr/solid-vc` `VerifiableCredential`
(type `fedtrust:MembershipCredential`), so it shares the agentic proof-suite seam —
a BBS / JWT / SPARQ-ZK proof plugs in **there**, not here. The only minted terms are
the credential type and the `fedtrust:federation` pointer, homed under
[`https://w3id.org/jeswr/fedtrust#`](https://w3id.org/jeswr/fedtrust).

## Install

Not yet on npm — install directly from the GitHub branch (npm publish deferred):

```sh
npm install github:jeswr/federation-trust#main
```

This works with **no build step**, even under `ignore-scripts=true`: the committed
`dist/` is self-contained — the off-npm `@jeswr/*` deps (`@jeswr/solid-vc`,
`@jeswr/federation-registry`, and their transitive `@jeswr/fetch-rdf`) are
**bundled (inlined)** into `dist/index.js`; every npm-published runtime dependency
(`n3`, `jose`, `rdf-canonize`, `multiformats`, `@rdfjs/wrapper`, `content-type`,
`jsonld-streaming-parser`) is external and resolves normally.

Peer runtime: Node ≥ 24, ESM only.

## Issue — an authority signs a membership

```ts
import {
  generateKeyPairForSuite,
  issueMembershipCredential,
} from "@jeswr/federation-trust";

// The authority's signing key (Ed25519 by default; "P-256" for ECDSA). The
// verificationMethod IRI should be controlled by the authority's WebID.
const authorityKey = await generateKeyPairForSuite(
  "https://registry.example/profile/card#me",
  "Ed25519",
);

// Sign "app X is a member of federation F with status Active, asserted by A".
const credential = await issueMembershipCredential({
  claim: {
    federation: "https://registry.example/federation",
    app: "https://music.example/clientid.jsonld",
    status: "Active",
    assertedBy: "https://registry.example/profile/card#me",
    // optional: validFrom / validUntil
  },
  key: authorityKey,
});
// `credential` is a W3C VerifiableCredential (fedtrust:MembershipCredential) with
// an embedded Data Integrity proof. Publish it / hand it to a consumer.
```

## Verify — a consumer checks it against its trust anchors

```ts
import {
  importPublicKey,
  verifyMembershipCredential,
} from "@jeswr/federation-trust";

// The verifier's trust anchors: the authorities (and their public keys) it accepts
// directly. The public key is supplied by the verifier (e.g. from the authority's
// WebID profile / a pinned key) — verification NEVER fetches a key over the network,
// so an attacker cannot point it at a key it controls.
const anchor = {
  authority: "https://registry.example/profile/card#me",
  verificationMethod: "https://registry.example/profile/card#me",
  publicKey: await importPublicKey(authorityPublicJwk),
};

const result = await verifyMembershipCredential(credential, {
  trustAnchors: [anchor],
  expectedFederation: "https://registry.example/federation", // anti-replay
  expectedApp: "https://music.example/clientid.jsonld",       // anti-replay
  // acceptStatuses defaults to ["Active"]
});

if (result.verified) {
  // Trust `result.claim` as a signed membership.
} else {
  // result.errors lists EVERY distinct failure (signature, expiry, status, …).
}
```

`verifyMembershipCredential` is **fail-closed** and a **conjunction of independent
gates** — every one must pass:

1. it is a well-formed `fedtrust:MembershipCredential` with all required claims;
2. the **signature** verifies over the canonical RDF (RDFC-1.0) of the claim graph,
   against the trust-anchor / chain-resolved public key **only**;
3. the **signed `assertedBy` equals the credential issuer** (the signer really
   claims to be the asserter);
4. **status ∈ the accepted set** (default `{Active}` — `Revoked` / `Suspended` /
   `Proposed` is not a live membership);
5. **federation / app match** the verifier's expectation (anti-replay across
   federations / apps);
6. **trust**: the issuer is a trust anchor, **or** a delegation chain proves a trust
   anchor (transitively) authorized the issuer for this federation;
7. **validity**: `now ∈ [validFrom, validUntil]`.

A tampered graph, a wrong key, an expiry, a revoked status, a missing claim, or a
broken chain all yield `{ verified: false, errors: [...] }` — never a throw, never
a silent accept.

## Delegation chains (R9 O2 — Scheme-Authority composition across scope)

A root trust anchor can delegate authority to a sub-authority (e.g. a regional
node), which then issues membership credentials. The verifier trusts those because
a **signed chain** proves the anchor authorized the sub-authority for that
federation:

```ts
import { issueDelegation, verifyMembershipCredential } from "@jeswr/federation-trust";

// ROOT (a trust anchor) delegates to SUB for the federation, EMBEDDING SUB's
// public key as a signed claim (so the chain is self-certifying).
const delegation = await issueDelegation({
  delegator: "https://root.example/card#me",
  authority: "https://regional.example/card#me",
  delegateKey: subKeyPair.publicKey, // SUB's PUBLIC key, signed into the link
  federation: "https://root.example/federation",
  key: rootKey,
});

// SUB issues the membership; the verifier presents ONLY the chain — no
// intermediate or issuer keys: the chain carries every key it needs, each one
// signed by the link above it, rooted in the anchor's pinned key.
const result = await verifyMembershipCredential(membershipFromSub, {
  trustAnchors: [{ authority: "https://root.example/card#me", publicKey: rootPub }],
  expectedFederation: "https://root.example/federation",
  chain: [{ credential: delegation }],
});
```

The chain is **self-certifying**: the **root link is verified with the trust
anchor's pinned key** (never a key supplied alongside the chain — so a forged
"from-anchor" delegation signed with an attacker's key cannot pass), and each link
carries the **next delegate's public key as a signed claim**, so every key in the
chain is proven by the link above it. The leaf's signed key is the membership
issuer's key. A broken / forged / wrong-key / expired / out-of-order / mis-scoped
chain fails closed (`BROKEN_CHAIN`).

## Scope — CLIENT-SIDE only

This is a **client-side** library: it issues and verifies credentials. It does
**not** enforce membership on a Solid resource server (e.g. gating writes on a
verified membership) — that would be a `prod-solid-server` **core** change and is a
maintainer decision, deliberately out of scope here.

## RDF + crypto discipline

Per the suite's non-negotiable rules: all RDF goes through `@jeswr/solid-vc`'s typed
wrappers (`@rdfjs/wrapper` + `n3.Writer`) — there is **no bespoke RDF parser and no
hand-built triples**; all crypto goes through `jose` / WebCrypto + the vetted
`rdf-canonize` — there is **no hand-rolled keygen, signature algorithm, or
canonicaliser**. Asymmetric-only (EdDSA / ECDSA): a membership credential must be
verifiable by anyone holding the authority's public key.

## How it fits the federation

| Federation service | Package |
|---|---|
| Vocabulary / Spec Hub | [`solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab) |
| App self-registration (`fedapp:`) | [`@jeswr/federation-client`](https://github.com/jeswr/federation-client) |
| Catalogue / Registry (`fedreg:`) | [`@jeswr/federation-registry`](https://github.com/jeswr/federation-registry) |
| **Trust / signed membership (`fedtrust:`)** | **`@jeswr/federation-trust`** (this package) |
| VC / proof backbone | [`@jeswr/solid-vc`](https://github.com/jeswr/solid-vc) |

## Development

```sh
npm install
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest (adversarial issue/verify + delegation-chain tests)
npm run build       # esbuild: bundle src/ (+ inline @jeswr/* deps) → dist/index.js; tsc → dist/*.d.ts
npm run check:dist  # fail if committed dist/ has drifted from src/
```

After any change to `src/`, run `npm run build` and commit the regenerated `dist/` —
`npm run check:dist` enforces that the artifact matches the source.

## License

MIT — Jesse Wright.
