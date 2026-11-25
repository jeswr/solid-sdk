---
name: solid-money
description: Use when reading or writing finance RDF through @jeswr/solid-money, maintaining Suite Money model compatibility, or regenerating its finance-sector profile.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Solid money model

The model core is generated from `codegen/money.ontology.ttl`, `money.shapes.ttl` and
`codegen.config.json`. Never edit `src/generated/`; run `pnpm run codegen --update-lock`
after reviewing input changes. Read the federation-codegen and model-runtime package
skills before changing the profile. The shapes header lists every finance-sector deviation.

`src/rdf.ts` and `src/document.ts` delegate generated field builds/reads to `entities.*` and retains domain
policy. `src/node.ts` reuses generated descriptors for ordinary fields and supplies only
blank amount references, exact decimal strings and lexical dates. Keep the subject-scoped
write boundary: generated migrations must not scan every record on each shard append.
No shape aliases/composites are configured; canonicalize vocabulary through `migration.ts`.
Use `NS`/`canonicalize` from suite-vocab and preserve every resource IRI and unknown triple.
Never hand-build quads or Turtle. Read the README's generator gaps before extending fields.

The package is browser-safe and pure. App fetch, storage preconditions, statement import
orchestration and React stay in the app. Shared arithmetic/date parsers live in `values.ts`;
Suite statement parsers re-export them rather than copy them.

The copied `test/money-model.test.ts` is a frozen oracle; only import paths may change.
`test/compatibility.test.ts` pins each behavior change listed in README "Exact divergences".
`test/codegen.test.ts` compares every regenerated artifact byte-for-byte. Run the package
and app-suite lint/build/typecheck/test gate plus root lint. Build copies generated assets;
never commit `dist/`.
