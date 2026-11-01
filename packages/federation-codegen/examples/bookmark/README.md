<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Bookmark integration example

The production example lives in [solid-bookmark](../../../solid-bookmark/README.md):
its [config](../../../solid-bookmark/codegen.config.json) reads the package's normative
ontology and SHACL, and its [facade](../../../solid-bookmark/src/bookmark.ts) wraps the
[generated core](../../../solid-bookmark/src/generated/).

`facade.ts` re-exports that package for the generator integration tests. The copied
78-test oracle still validates the generated `shapes.ttl`, complementing the package's
unchanged tests of the normative `bookmark.shacl.ttl`. Generator determinism and fidelity
tests also use the package's inputs and generated artifacts. No second config, core, or
model implementation is maintained here.

From the workspace root, regenerate with:

```sh
pnpm --filter @jeswr/solid-bookmark run codegen
```

The existing `pnpm --filter @jeswr/federation-codegen run gen:example` command forwards to
the same package command.
