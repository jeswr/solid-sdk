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
    "https://jeswr.org/ns/fed"
  ],
  "client_id": "https://app.example/clientid.jsonld",
  "type": "App",
  "sector": "https://jeswr.org/ns/sectors/scheduling#sector",
  "access": ["Read", "Write"]
}
```

## Key artifacts

- `fedapp.ttl`, `fedreg.ttl`, and `fedcon.ttl`: federation vocabularies.
- `task.ttl`: shared task and issue terms.
- `sectors/core/` and the other `sectors/*/` directories: gUFO-rooted core and sector ontologies.
- `*-context.jsonld`: JSON-LD contexts; `*.shacl.ttl`: validation profiles.
- `docs/`: generated Turtle, JSON-LD, and HTML served through the persistent namespaces.
- `legacy-w3id-alignments.ttl`: optional old-to-new mappings for all 774 pre-rebase
  terms (220 classes, 304 properties, 250 individuals), generated from the
  pre-VOC-02 git revision. This Mode-A compatibility sidecar has OWL entailments
  when explicitly loaded; it is never imported or included in `dist/vocab.nt`.

## Namespace migration (2.0.0)

DECISIONS V1 moves core, task, fed, fedreg and every sector to
`https://jeswr.org/ns/<slug>#`, with version IRIs at
`https://jeswr.org/ns/<slug>/2.0.0`. The existing `fedcon:` namespace remains
`https://jeswr.org/fedcon#`; references from its context and shapes use the new
`fedreg:` namespace. Existing profile version histories retain their version
numbers under the new base. Representation filenames are unchanged.

Regenerate the legacy mappings from the immutable pre-change sources, then
rebuild and check the vocabularies:

```sh
pnpm --filter @jeswr/solid-federation-vocab exec node scripts/legacy-w3id-alignments.mjs
pnpm --filter @jeswr/solid-federation-vocab run gate
```

The generator reads git revision `6b46636d065fd49f4a07d86c92cacad8ef4bea96` by
default; that revision must be available locally (use full history when
regenerating). It accepts an optional pre-rebase revision as its first argument.
Normal builds use the committed mappings and do not need historical git objects.

Verify all registered representation URLs against the read-only portfolio
registry (or pass an unmodified local `config/persistent-ids.ts` as an argument):

```sh
pnpm --filter @jeswr/solid-federation-vocab exec node scripts/verify-persistent-ids.mjs
```

The script checks the 17 existing namespace entries, their legacy predecessor
fields, local artifact filenames and all 51 live Turtle/HTML/JSON-LD URLs. Its
TSV output can be attached to the integration review. Registry edits and
production deployment remain with the portfolio maintainer.

## Links

- [Source](https://github.com/jeswr/solid-federation-vocab)
- [`fedapp:` vocabulary](https://jeswr.org/ns/fed)
- [`fedreg:` vocabulary](https://jeswr.org/ns/fedreg)
- [Solid Client Identifier Documents](https://solidproject.org/TR/oidc#clientids)

## License

[MIT](./LICENSE) © Jesse Wright
