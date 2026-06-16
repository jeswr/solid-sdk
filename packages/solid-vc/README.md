<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/solid-vc

> **W3C Verifiable Credentials 2.0 — build, sign, and verify signed credentials for agentic Solid,
> with a _pluggable proof-suite seam_.** Build a [VC 2.0][vcdm] credential / presentation as
> **queryable JSON-LD / RDF** using the **real W3C vocabulary** (`https://www.w3.org/ns/credentials/v2`)
> through the suite RDF libraries, sign it with an embedded [Data Integrity][di] proof, and verify it
> through a conjunction of independent, fail-closed gates. The headline use case: a signed
> **`AgentAuthorizationCredential`** — *"WebID X authorizes agent Y for action Z under ODRL policy P"*.

This is the **signed-credential piece** of the [agentic-Solid roadmap][roadmap] — **M4-VC**
(*"VC / ZKP credential exchange — signed VCs are the default; ZKP is the selective-disclosure
upgrade"*). It is the standards-grade authentication backbone the rest of M4 builds on.

> ⚠️ **Experimental, AI-agent-generated.** Not production-hardened. It implements the VC 2.0 Data
> Model + the Data Integrity `*-rdfc-*` cryptosuites (EdDSA / ECDSA over [RDFC-1.0][rdfc]), with a
> proof-suite seam that a BBS, JWT, or **SPARQ ZK-over-SPARQL** proof plugs into.

## What this is — and what it is NOT

| | |
|---|---|
| ✅ **Build** a VC 2.0 credential / presentation as RDF + JSON-LD (real `cred:` vocab; never hand-built triples). | ❌ A new credential vocabulary — it uses the W3C VC 2.0 Rec verbatim; the only minted terms are one documented `@jeswr` agent-authz extension. |
| ✅ **Sign** with an embedded Data Integrity proof (`eddsa-rdfc-2022` / `ecdsa-rdfc-2019`, asymmetric only). | ❌ A ZKP engine. The **ZK cryptography lives in [`@jeswr/sparq`][sparq]** (the SPARQ agent's domain). This package owns only the verification _seam_ a ZK proof suite plugs into. |
| ✅ **Verify** through independent gates: signature, expiry, not-yet-valid, issuer-binding, proof-purpose, trusted-issuer. | ❌ **Server-side enforcement.** Consuming a delegated-authorization VC inside a Solid server's authorizer = **M5 = CORE-PSS** (an ADR + maintainer approval); deliberately not here. |
| ✅ **Pluggable proof suites** via the `ProofSuite` interface + a `SuiteRegistry` (dispatch by cryptosuite). | ❌ Bare-Bearer / symmetric proofs — a credential proof must be verifiable by anyone holding the public key. |

## The pluggable proof-suite seam

The sign/verify pipeline is **suite-agnostic**: it dispatches on `proof.cryptosuite` through a
`SuiteRegistry`. A new proof type is added by implementing `ProofSuite` and `register()`-ing it —
**no change to the data model or the verify pipeline**:

```ts
interface ProofSuite {
  readonly cryptosuite: string;
  sign(documentQuads, options): Promise<DataIntegrityProof>;
  verify(documentQuads, proof, options): Promise<boolean>;
}
```

The bundled `DataIntegritySuite` implements `eddsa-rdfc-2022` (EdDSA / Ed25519) and `ecdsa-rdfc-2019`
(ECDSA / P-256) over RDFC-1.0, via `jose` / WebCrypto + the vetted [`rdf-canonize`][rdfc]. **BBS**
(the unlinkable-ZK interop floor) lands here next.

### How the SPARQ ZK suite plugs in

The roadmap routes ZKP through **SPARQ** (the user's ZK-over-RDF/SPARQL engine). The ZK proving /
verifying stays in `@jeswr/sparq`; this package exposes the seam:

```ts
import { defaultSuiteRegistry, verifyCredential } from "@jeswr/solid-vc";
// (illustrative) a future adapter in @jeswr/agent-zk-sparql
const zkSuite: ProofSuite = {
  cryptosuite: "sparql-zk-2026",
  async sign(quads, opts)  { /* @jeswr/sparq: prove a SPARQL query over committed signed RDF */ },
  async verify(quads, proof, opts) { /* @jeswr/sparq: UltraHonk verify */ },
};
const registry = defaultSuiteRegistry().register(zkSuite);
await verifyCredential(vp, { registry, resolveKey });
```

The verifier never learns the suite exists beyond the `cryptosuite` dispatch key — that is the whole
point of the seam (see `test/proof.test.ts` for a working stub).

## Composability

- **M1 — [`@jeswr/solid-agent-card`][m1]:** the `agent` an `AgentAuthorizationCredential` authorizes
  is an agent-card / WebID IRI.
- **M3 — [`@jeswr/solid-odrl`][m3]:** the `policy` an authorization is bound to is an ODRL policy IRI;
  an ODRL constraint (`age ≥ 18`, membership) is _discharged_ by a VC/ZK proof.
- **[`@jeswr/solid-dpop`][dpop]:** the same `jose` / WebCrypto asymmetric crypto primitives.

## Install

Off-npm (GitHub branch install), with the suite's `ignore-scripts=true` invariant — the committed,
self-contained `dist/` (with `@jeswr/fetch-rdf` inlined) means no build step is needed:

```bash
npm install github:jeswr/solid-vc#main
```

## Usage

```ts
import {
  generateKeyPairForSuite,
  issueAgentAuthorization,
  verifyCredential,
} from "@jeswr/solid-vc";

// Alice's WebID delegates to Bob's agent.
const key = await generateKeyPairForSuite("https://alice.example/profile#me#key-1", "Ed25519");

const vc = await issueAgentAuthorization(
  {
    principal: "https://alice.example/profile#me",
    agent: "https://bob.example/agent#card",
    action: "http://www.w3.org/ns/auth/acl#Read",
    target: "https://alice.example/private/notes/",
    policy: "https://alice.example/policies/notes.ttl#policy",
    validUntil: "2027-01-01T00:00:00.000Z",
  },
  key,
);

// A relying party verifies — resolving the verification method to a public key
// (e.g. from Alice's WebID profile / a DID document).
const result = await verifyCredential(vc, {
  resolveKey: (vm) => (vm === key.verificationMethod ? key.publicKey : undefined),
  trustedIssuers: ["https://alice.example/profile#me"],
});
// result.verified === true; result.errors === []
```

Every verification failure is reported as a distinct structured error code (`INVALID_SIGNATURE`,
`EXPIRED`, `NOT_YET_VALID`, `ISSUER_MISMATCH`, `PROOF_PURPOSE_MISMATCH`, `UNKNOWN_CRYPTOSUITE`,
`UNTRUSTED_ISSUER`, `NO_PROOF`, `MALFORMED`) — never collapsed into a generic `false`.

## Relationship to the prior VC line

This is the standards-grade, RDF-native consolidation the roadmap names `@jeswr/solid-vc`,
**superseding** [`@jeswr/vc-cli`][vccli] (issue/verify across BBS / ECDSA-SD / Ed25519) and
[`@jeswr/vc-queries`][vcq] (SPARQL over VCs) into one Data-Integrity backbone — cite, don't
green-field.

## Security model

- Signing / verification go through **WebCrypto** (`jose`-generated keys) and the **vetted
  `rdf-canonize`** (RDFC-1.0) — never a hand-rolled canonicaliser, signature, or hash.
- The signing pre-image **binds both the document and the proof options** (suite, verification
  method, proof purpose, created) — so an attacker cannot swap the key, downgrade the suite, or
  change the purpose without invalidating the signature.
- Verification is **fail-closed**: an unresolvable key, an unknown suite, a malformed `proofValue`,
  a missing field → `verified: false`, never a throw or a silent accept.
- Asymmetric-only signature suites (EdDSA / ES256), mirroring prod-solid-server's verifier.

## Gate

```bash
npm run lint        # biome
npm run typecheck   # tsc --noEmit (builds @jeswr/fetch-rdf inline first)
npm test            # vitest (exhaustive sign/verify + tamper/expiry/binding rejection)
npm run build       # bundle the committed dist/ (fetch-rdf inlined)
npm run check:dist  # guard the committed dist/ against src/ drift
```

[vcdm]: https://www.w3.org/TR/vc-data-model-2.0/
[di]: https://www.w3.org/TR/vc-data-integrity/
[rdfc]: https://www.w3.org/TR/rdf-canon/
[roadmap]: https://github.com/jeswr/prod-solid-server/blob/main/docs/design/agentic-solid-infrastructure.md
[m1]: https://github.com/jeswr/solid-agent-card
[m3]: https://github.com/jeswr/solid-odrl
[dpop]: https://github.com/jeswr/solid-dpop
[sparq]: https://github.com/jeswr/sparq
[vccli]: https://github.com/jeswr/vc-cli
[vcq]: https://github.com/jeswr/vc-queries
