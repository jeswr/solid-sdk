<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/federation-registry

Typed builders and readers for Solid federation registries, memberships, and storage-version advertisements.

`verifyMembership` checks vocabulary structure; it does not prove the named authority signed the
membership. Use a trusted signature layer for that decision.

> Experimental. Treat registry data as untrusted until authority and signature checks pass. The
> fetch-backed APIs do not add an SSRF guard, so inject a guarded fetch for untrusted URLs.

Readers accept canonical `https://jeswr.org/ns/` and legacy `https://w3id.org/jeswr/`
vocabulary terms. Canonical properties take precedence per field; builders write canonical
terms. Resource identifiers and caller-supplied spec-version IRIs retain their identity.

## Install

```sh
npm install github:jeswr/federation-registry#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { listMembers, TRUSTED_STATUS } from "@jeswr/federation-registry";

const members = await listMembers("https://registry.example/federation", {
  fetch: authenticatedFetch,
});

const activeApps = members
  .filter(
    (entry) =>
      entry.valid &&
      entry.membership?.status &&
      TRUSTED_STATUS.has(entry.membership.status),
  )
  .map((entry) => entry.membership?.app);
```

## Key API

- Registries: `buildRegistry`, `parseRegistry`, `listMembers`, `verifyMembership`.
- Storage descriptions: `describeStorage`, `parseStorage`, `acceptsSpec`, `unsupportedSpecs`.
- Vocabulary: `FEDREG`, `MEMBERSHIP_STATUS`, `statusName`, `TRUSTED_STATUS`,
  `VALID_STATUS_IRIS`.
- Builders return RDF documents with `toString()` serialization.

## Links

- [Source](https://github.com/jeswr/federation-registry)
- [Issues](https://github.com/jeswr/federation-registry/issues)
- [`fedreg:` vocabulary](https://jeswr.org/ns/fedreg)
- [Signed membership layer](https://github.com/jeswr/federation-trust)

## License

[MIT](./LICENSE) © Jesse Wright
