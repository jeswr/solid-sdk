<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-vc

Build, sign, and verify W3C Verifiable Credentials 2.0 as queryable JSON-LD and RDF.

The package includes EdDSA and ECDSA Data Integrity suites over RDFC-1.0, plus a proof-suite seam
for other cryptosuites.

> Experimental and security-critical. Verification must stay fail-closed and use trusted key
> resolution.

Phase 1 keeps authorization builders and their inline JSON-LD context on the legacy
`https://w3id.org/jeswr/solid-vc#` wire format. Canonical emission is deferred to phase 2
because deployed verifiers pinned to earlier packages reject canonical credentials.
Readers accept `https://jeswr.org/ns/solid-vc#`, legacy and mixed authorization graphs;
conflicting singleton claims and differing action alias sets are rejected. Authorization
readers require one RDF subject and reject malformed aliases. Existing signed payloads, historical bare
type/claim expansion, W3C context URLs and cryptosuite identifiers remain unchanged.
Explicit input IRIs are preserved; rebasing signed data requires a new proof.

New proofs encode `cryptosuite` as `sec:cryptosuiteString`. Both bundled suites also
verify the historical `xsd:string` proof configuration used by earlier releases.
The compatibility path verifies the same claims and complete proof options with the
same key; issuer, proof purpose, validity, and status checks still apply. Retained
public-key fixtures in `test/fixtures/origin-main-credentials.json` cover both suites.

## Install

```sh
npm install github:jeswr/solid-vc#main
```

Requires Node.js 24 or newer, or a browser with WebCrypto in a secure context. Hashing
and random identifiers use `globalThis.crypto`; status-list compression requires the web-standard
`CompressionStream("gzip")` and `DecompressionStream("gzip")` APIs. Decoding keeps strict
base64url validation and the 16KB minimum, validates GZIP integrity, and cancels the stream
as soon as its expansion exceeds `maxDecodedBytes` (16 MiB by default).
The public entry bundles with esbuild's `platform: "browser"` without Node builtins.
Browser WebID/status resolution requires an injected fetch; the DNS-pinned Node default
is disabled by the package's browser mapping. Non-extractable P-256 private keys can be
passed directly in a `KeyPair` to `DataIntegritySuite("ecdsa-rdfc-2019")` without export.

Status-list compression is asynchronous. Await `encodeStatusList`, `decodeStatusList`,
`buildBitstringStatusListCredential`, `statusListBitsOf`, `withStatusBit`, and `readStatusBit`.
For example, `const bits = await decodeStatusList(await encodeStatusList(createStatusBitstring()))`.
Concatenated GZIP members and trailing bytes are rejected by the platform decoder.

`statusListCredentialToTurtle(vc)` serializes a single-proof status-list credential as
`application/trig`, preserving its named Data Integrity proof graph. Its structural inverse,
`parseStatusListCredential(document)`, rejects ambiguous or lossy graphs and returns the
credential or `undefined`; always verify the result before trusting its bits.
`createBitstringStatusResolver` accepts this RDF transport alongside existing JSON/JSON-LD,
including lists signed by a non-extractable P-256 owner key with `ecdsa-rdfc-2019`.
Status signature, issuer-control, URL, validity and decoded-size checks apply to both formats.

## Minimal usage

```ts
import {
  generateKeyPairForSuite,
  issueAgentAuthorization,
  verifyCredential,
} from "@jeswr/solid-vc";

const key = await generateKeyPairForSuite(
  "https://alice.example/profile/card#me#key-1",
  "Ed25519",
);

const credential = await issueAgentAuthorization(
  {
    principal: "https://alice.example/profile/card#me",
    agent: "https://bob.example/agent#card",
    action: "http://www.w3.org/ns/auth/acl#Read",
    target: "https://alice.example/private/notes/",
    policy: "https://alice.example/policies/notes.ttl#policy",
    validUntil: "2027-01-01T00:00:00.000Z",
  },
  key,
);

const result = await verifyCredential(credential, {
  resolveKey: (id) => (id === key.verificationMethod ? key.publicKey : undefined),
  trustedIssuers: ["https://alice.example/profile/card#me"],
});
```

Check `result.verified` and `result.errors`; verification failures are structured and never a
generic boolean with no explanation.

A policy IRI alone does not bind mutable policy content. For authorization that depends on policy
contents, pass `policyContent` when issuing and `presentedResources` when verifying. The digest is
over the base-free graph, which merges relative forms (`.#x` reads as `#x`) and, in JSON-LD, drops
relative-IRI triples, so issuing refuses policy content whose relative IRIs (datatypes included) are
anything but fragment references (`<#x>`), and JSON-LD content with any relative IRI.

`digestQuads` and `digestRdfContent` refuse literals with a base direction or the
`rdf:dirLangString` datatype, including Turtle `"v"@en--ltr` and JSON-LD `@direction`.
RDFC-1.0 canonicalization loses their language and direction, allowing distinct content to share
a digest. Policy-content issuance throws a clear error for these literals. Presented content
containing them makes `verifyCredential` and `verifyRelatedResources` return
`verified: false` with `RELATED_RESOURCE_MISMATCH`, without throwing. Ordinary language-tagged
literals such as `"v"@en` remain supported.

## Key API

- Credentials: builders, RDF/JSON-LD serializers, and parsers from the root; presentation types
  and wrappers are also exported.
- Signing: `DataIntegritySuite`, `SuiteRegistry`, `defaultSuiteRegistry`,
  `generateKeyPairForSuite`.
- Verification: `verifyCredential`, key resolvers, status resolvers, and structured error codes.
- Agent authorization: `issueAgentAuthorization`, `buildBoundAgentAuthorizationCredential`.
- Content binding: `digestRdfContent`, `digestQuads`, `verifyRelatedResources`.

## Links

- [Source](https://github.com/jeswr/solid-vc)
- [Issues](https://github.com/jeswr/solid-vc/issues)
- [VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [Data Integrity](https://www.w3.org/TR/vc-data-integrity/)
- [RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/)

## License

[MIT](./LICENSE) © Jesse Wright
