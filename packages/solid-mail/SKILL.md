---
name: solid-mail
description: Use when reading or writing mail RDF through @jeswr/solid-mail, maintaining its generated Message, Thread, Folder and Attachment wrappers, or changing its mail profile and compatibility facade.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Generated mail model

The four entity models are generated from `codegen/mail.ontology.ttl`,
`codegen/mail.shapes.ttl` and `codegen/codegen.config.json` by
`@jeswr/federation-codegen`, then interpreted by `@jeswr/model-runtime`.
Read those packages' local skills before changing the profile. Never edit
`src/generated/`; regenerate with `pnpm run codegen --update-lock` after reviewing
an intentional input change. The drift test compares every artifact byte for byte.

`Message`, `Thread`, `Folder` and `Attachment` are minimal subclasses of generated
wrappers. Their constructors retain `(term, dataset, factory)` and fields are live.
`src/wrapper.ts` adapts optional declaration types so explicit `undefined` clears
scalar fields even for consumers using `exactOptionalPropertyTypes`.
Mailboxes contain sibling subjects: `MailboxDataset` enumerates exact explicit
types through `DatasetWrapper.instancesOf`, without requiring complete records.
SIOC Thread is an extra write type, never a read alias. Attachment wrapping adds
no type; its subject is the binary IRI.

Keep standard IRIs byte-identical to `pod-connectors/mail/constants`, especially
`http://schema.org/`. The parity test imports only that sibling's plain constants;
there is no runtime dependency on pod-connectors. No mail sector profile exists.
The shapes header records the narrower datatype/cardinality constraints. Do not
add HTTP-only guards to mail address fields: `mailto:` recipients must survive.
Config disables text sanitization explicitly to preserve decoded text and inert
HTML, including control characters. Rendering/sanitization stays with consumers.

The facade owns only read-state convenience methods, SIOC co-typing, membership
conveniences and complete-document parse/serialization. `parseMailbox(text, url)`
uses fetch-rdf and has no I/O. `serialiseToTurtle(dataset)` is synchronous and uses
N3 Writer with the app's prefixes; preserve arbitrary sibling triples and reject
named graphs. Do not replace it with the generated asynchronous single-entity
serializer. Generated accessors guard all modeled fields.

The five copied `test/{message,thread,folder,serialise,mailbox}.test.ts` files and
`test/helpers.ts` are the oracle: change only imports when copying. Additional
coverage and divergence pins belong in separate files. README "Exact divergences"
and `test/compatibility.test.ts` describe stricter runtime behavior. Apps, stores,
operations, importers, paths, Type Index and HTML helpers are outside this package.

From the workspace root, with Node 24:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-mail
pnpm run lint:root
node scripts/check-codegen.mjs
```
