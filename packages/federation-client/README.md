<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/federation-client

Read, validate, and build Solid app-registration metadata using the `fedapp:` vocabulary.

App registration is self-description, not proof of federation membership. Registry discovery is
available separately through the same client.

> Experimental. Registry and storage discovery use the provided guards. For attacker-controlled
> registration URLs, pass a guarded fetch explicitly to `verify` or `list`.

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
  sectors: ["https://w3id.org/jeswr/sectors/scheduling"],
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
- Guarded fetch: `createGuardedFetch`, `guardedFetch`, `SsrfError`.
- Node hardening: `nodeGuardedFetch`, `createNodeGuardedFetch`, and
  `createPinningDispatcher` from `@jeswr/federation-client/node`.
- Vocabulary: `FEDAPP`, `ACL_MODES`, `accessModeName`, `sectorIri`.

## Links

- [Source](https://github.com/jeswr/federation-client)
- [Issues](https://github.com/jeswr/federation-client/issues)
- [`fedapp:` vocabulary](https://w3id.org/jeswr/fed)
- [Solid Client Identifier Documents](https://solidproject.org/TR/oidc#clientids)

## License

[MIT](./LICENSE) © Jesse Wright
