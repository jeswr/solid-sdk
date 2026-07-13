<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-vc

Build, sign, and verify W3C Verifiable Credentials 2.0 as queryable JSON-LD and RDF.

The package includes EdDSA and ECDSA Data Integrity suites over RDFC-1.0, plus a proof-suite seam
for other cryptosuites.

> Experimental and security-critical. Verification must stay fail-closed and use trusted key
> resolution.

## Install

```sh
npm install github:jeswr/solid-vc#main
```

Requires Node.js 24 or newer.

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
contents, pass `policyContent` when issuing and `presentedResources` when verifying.

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
