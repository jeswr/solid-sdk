<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/federation-trust

Issue and verify signed W3C credentials for Solid federation memberships and delegated authorities.

It combines the `fedreg:` membership model with `@jeswr/solid-vc` Data Integrity proofs, without
duplicating either layer.

> Experimental and security-sensitive. Verification must be rooted in caller-supplied trust
> anchors and expected federation/app identifiers.

## Install

```sh
npm install github:jeswr/federation-trust#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import {
  generateKeyPairForSuite,
  issueMembershipCredential,
  verifyMembershipCredential,
} from "@jeswr/federation-trust";

const key = await generateKeyPairForSuite("https://registry.example/profile#me", "Ed25519");
const credential = await issueMembershipCredential({
  claim: {
    federation: "https://registry.example/federation",
    app: "https://music.example/clientid.jsonld",
    status: "Active",
    assertedBy: "https://registry.example/profile#me",
  },
  key,
});

const result = await verifyMembershipCredential(credential, {
  trustAnchors: [
    {
      authority: "https://registry.example/profile#me",
      verificationMethod: key.verificationMethod,
      publicKey: key.publicKey,
    },
  ],
  expectedFederation: "https://registry.example/federation",
  expectedApp: "https://music.example/clientid.jsonld",
});
```

## Key API

- Memberships: `issueMembershipCredential`, `verifyMembershipCredential`.
- Delegation: `issueDelegation` and delegation-chain verification through membership options.
- Keys and proofs: re-exported `generateKeyPairForSuite`, `importPublicKey`, and proof-suite types.
- Results contain structured errors for signature, status, validity, binding, and trust failures.

## Links

- [Source](https://github.com/jeswr/federation-trust)
- [Issues](https://github.com/jeswr/federation-trust/issues)
- [`fedreg:` vocabulary](https://w3id.org/jeswr/fedreg)
- [VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)

## License

[MIT](./LICENSE) © Jesse Wright
