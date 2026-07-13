<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-federation-vocab

Source vocabularies and generated web documentation for the `@jeswr` Solid federation data model.

It defines app registration (`fedapp:`), registry assertions (`fedreg:`), contribution governance
(`fedcon:`), the shared task model (`tm:`), Solid Core, and sector ontologies.

> Experimental. This workspace package is private and has no JavaScript runtime API.

## Install

Consumers use the persistent vocabulary URLs directly; this package is not published. To work on
the sources in this monorepo:

```sh
pnpm install
pnpm --filter @jeswr/solid-federation-vocab build
```

Requires Node.js 22 or newer.

## Minimal usage

Add federation metadata to a Solid Client Identifier Document:

```json
{
  "@context": [
    "https://www.w3.org/ns/solid/oidc-context.jsonld",
    "https://w3id.org/jeswr/fed"
  ],
  "client_id": "https://app.example/clientid.jsonld",
  "type": "App",
  "sector": "https://w3id.org/jeswr/sectors/scheduling#sector",
  "access": ["Read", "Write"]
}
```

## Key artifacts

- `fedapp.ttl`, `fedreg.ttl`, and `fedcon.ttl`: federation vocabularies.
- `task.ttl`: shared task and issue terms.
- `sectors/core/` and the other `sectors/*/` directories: gUFO-rooted core and sector ontologies.
- `*-context.jsonld`: JSON-LD contexts; `*.shacl.ttl`: validation profiles.
- `docs/`: generated Turtle, JSON-LD, and HTML served through the persistent namespaces.

## Links

- [Source](https://github.com/jeswr/solid-federation-vocab)
- [`fedapp:` vocabulary](https://w3id.org/jeswr/fed)
- [`fedreg:` vocabulary](https://w3id.org/jeswr/fedreg)
- [Solid Client Identifier Documents](https://solidproject.org/TR/oidc#clientids)

## License

[MIT](./LICENSE) © Jesse Wright
