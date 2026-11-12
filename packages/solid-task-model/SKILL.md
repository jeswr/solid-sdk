---
name: solid-task-model
description: Use when reading or writing shared wf:Task data, regenerating the Task core, maintaining the public Task facade or hardened IRI reads, or distinguishing the generated Task from hand-written tracker and contacts models.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Shared Task model

Task is generated from `codegen/task.ontology.ttl`, `codegen/task.shapes.ttl` and
`codegen/codegen.config.json` by `@jeswr/federation-codegen`, interpreted by
`@jeswr/model-runtime`. Read both packages' local skills before changing the inputs or
facade. `src/generated/` is generated output; never edit it or format it by hand.
Tracker and contacts remain hand-written; keep those models out of a Task-only change.

The public `Task` class extends the generated wrapper. Its small facade in `src/task.ts`
keeps lifecycle state/timestamps and writes both `wf:description` and `dct:description`.
`src/task-types.ts` preserves the public types. `src/task-policy.ts` carries only
compatibility policies, including priority normalization and Store order. Keep all
exports and standard vocabulary IRIs unchanged. `shapes/task.ttl` remains the published
SHACL contract, separate from the generation profile; every narrowing/omission is listed
in the profile header. No federation sector targets `wf:Task`; the scheduling sector
uses a distinct model and must not remint this package's identifiers.

Pod data is untrusted. `parseTask`/`parseTaskTtl` retain first-valid http(s) scalar reads,
filter each set member independently and return accepted IRIs exactly as stored. They
guard every dataset read. Do not replace this with generated scalar IRI reads: those
normalize spelling and drop ambiguous values. Generated literal parsing enforces the
profile, including exactly one string title. README "Exact divergences" and
`test/compatibility.test.ts` pin the edge behavior. Direct generated wrapper accessors
follow their stricter datatype/cardinality/IRI guards, with two consumer-facing
exceptions. A lone ill-typed `xsd:dateTime` reads as an Invalid Date, and a lone
lexically safe http(s) IRI that `URL` cannot parse keeps its stored spelling. Consumers
such as the suite's Tasks views reject or display these values instead of losing them.

All RDF writes go through the generated entity/accessors. State uses its live type set
and timestamp fields; descriptions use two independently generated properties, because
canonical-only aliases would lose dual writes. Preserve the generic Store serializer:
tracker and contacts also call it, and it must preserve their graphs and byte order.
The root, `/task`, `/tracker` and `/contacts` entries are browser-safe; filesystem shape
readers belong only to `/shape`.

From the workspace root:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-task-model run codegen
# Accept a reviewed input edit:
pnpm --filter @jeswr/solid-task-model run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=...@jeswr/solid-task-model
node scripts/check-codegen.mjs
```

Preserve all original `src/*.test.ts` files and snapshots verbatim. Drift tests regenerate
every artifact byte-for-byte; compatibility tests compile the built declarations with
`exactOptionalPropertyTypes` and pin both Turtle and JSON bytes. The build copies the
generated JS/declarations into `dist/generated/`; `dist/` is never committed here. Mirror
publishing must retain and pin `@jeswr/model-runtime`, because declarations import its
types; the generator is build-time only.
