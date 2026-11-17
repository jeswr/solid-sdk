---
name: solid-sheets
description: Use when reading or writing Solid spreadsheet workbook or column descriptor RDF, maintaining @jeswr/solid-sheets, or regenerating its model and compatibility facade.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Generated spreadsheet model

The source of truth is `codegen/`: a minimal ontology over existing standard IRIs, its
SHACL profile and config. No matching federation sector exists. Read federation-codegen
and model-runtime's package skills before changing those inputs. Run
`pnpm --filter @jeswr/solid-sheets run codegen --update-lock` after reviewing input changes;
never edit `src/generated/`. The drift test compares all artifacts byte for byte.

Workbook, Download, Descriptor and Column are generated flat entities. Build and parse
through those entities in `src/workbook.ts` and `src/descriptor.ts`. Keep the facade for
arbitrary-size lists, workbook dual typing, exact URLs, uniqueness/order and column
format/datatype correlation. Dataset fields are optional in SHACL because a workbook is
also a Dataset; the descriptor facade enforces required values. Preserve snapshot encoding's
original optional read behavior. Namespace constants come from `@jeswr/suite-vocab`.

`SheetResource` is a minimal compatibility view for arbitrary comment/Type Index predicates,
not the model build/parse implementation. `sheetRegistrations` is a minimal DatasetWrapper
enumeration adapter; protocol I/O stays in Suite. Do not restore hand-written vocabulary classes.
CSV I/O, snapshots, storage, React hooks and app orchestration stay in Suite. Only descriptor
metadata inference and its shared types/validation belong here.

Keep the copied RDF oracle verbatim except import paths and keep all Suite tests unchanged.
Pin every behavior change in `test/compatibility.test.ts` and README "Exact divergences".
Reject JSON-LD contexts before parsing. Parse through fetch-rdf, write through generated
entities/accessors and serialize with the existing RDF serializers; never build raw triples.

Run the package and app gates listed in README. The build copies generated JS and
precise declarations into `dist/generated`; never commit dist. No mirror is configured.
