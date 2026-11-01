<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/federation-client

Read, validate, and build Solid app-registration metadata using the `fedapp:` vocabulary.

App registration is self-description, not proof of federation membership. Registry discovery is
available separately through the same client.

> Experimental. Registry and storage discovery use the provided guards. For attacker-controlled
> registration URLs, pass a guarded fetch explicitly to `verify` or `list`.

Readers accept canonical `https://jeswr.org/ns/` and legacy `https://w3id.org/jeswr/`
vocabulary terms. Canonical properties take precedence per field; builders write canonical
terms. Resource identifiers and caller-supplied spec-version IRIs retain their identity.

## Install

```sh
npm install github:jeswr/federation-client#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { selfDescribe, verify } from "@jeswr/federation-client";

const description = selfDescribe({
  id: "https://app.example/clientid.jsonld",
  sectors: ["https://jeswr.org/ns/sectors/scheduling"],
  access: ["Read", "Write"],
  consumes: ["http://www.w3.org/2005/01/wf/flow#Task"],
});

const turtle = await description.toString();
const result = await verify("https://app.example/clientid.jsonld", {
  body: turtle,
  bodyContentType: "text/turtle",
});
```

## Key API

- Registration: `verify`, `list`, `selfDescribe`, `serialize`.
- Registry and storage: `discoverFromRegistry`, `resolveStorageSpecVersion`.
- Guard errors and types: `SsrfError`, `RedirectRefusedError`, `DnsLookup`, `GuardOptions`,
  `ResolvedAddress`.
- Node hardening: `nodeGuardedFetch`, `createNodeGuardedFetch`, and
  `createPinningDispatcher` from `@jeswr/federation-client/node`.
- Vocabulary: `FEDAPP`, `ACL_MODES`, `accessModeName`, `sectorIri`.

## Guard helper migration (breaking)

The root entry no longer exports `createGuardedFetch`, `guardedFetch`, `isLoopbackAddress`,
`isPublicAddress`, `classifyIpLiteral`, or `refuseRedirects`. Import these helpers directly
from `@jeswr/guarded-fetch`:

```ts
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { verify } from "@jeswr/federation-client";

const fetch = createGuardedFetch();
const result = await verify("https://app.example/clientid.jsonld", { fetch });
```

`SsrfError`, `RedirectRefusedError`, and the guard types remain available from this package
for catching and typing errors from its own functions. The `@jeswr/federation-client/node`
entry still provides the DNS-pinning helpers. Both built entries share the same guard error
classes. Existing `github:` commit SHA pins continue to use their original exports.

## Links

- [Source](https://github.com/jeswr/federation-client)
- [Issues](https://github.com/jeswr/federation-client/issues)
- [`fedapp:` vocabulary](https://jeswr.org/ns/fed)
- [Solid Client Identifier Documents](https://solidproject.org/TR/oidc#clientids)

## License

[MIT](./LICENSE) © Jesse Wright
