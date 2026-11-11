---
name: solid-places
description: Use when importing Google Timeline exports, modelling private saved places and visits or journeys, calculating travel distances and UTC period statistics, or using the generated @jeswr/solid-places model and repository.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

Read [README.md](README.md) for the parser contract, limits, vocabulary and storage guarantees.

All domain entities are generated. Change `codegen/places.ontology.ttl`, `codegen/places.shapes.ttl` and `codegen.config.json`, then regenerate with `pnpm run codegen --update-lock`. Never edit `src/generated/`. Keep the byte-for-byte drift test green. Read the federation-codegen and model-runtime package skills before changing model inputs. `src/model.ts` stays a thin validation/serialisation facade.

`parseGoogleTimeline(jsonText)` is a pure synchronous parser intended for the future Timeline connector as well as the Places app. It accepts on-device semanticSegments and old monthly timelineObjects, returns stable canonical keys with Date-valued data, performs no I/O and enforces byte, record and path-point caps. Use it in a worker for browser file imports. Do not add geocoding, Google requests or browser-specific APIs to the parser.

Inject the account's storage/fetch/owner into the repository; initialise privacy before saving. Use the shared `checkOwnerOnly` for every privacy decision. Cache successful container observations only within the account repository session; clear them on initialise and keep checking file ACL overrides. Keep owner-only WAC checks fail-closed, Type Index writes private, exact-name imports create-only and edits conditional. IDs become SHA-256 file names at persistence time; retries must preserve existing manual edits. Treat partial import failure/cancellation as resumable. The explicitly marked suite demo adapter never establishes real access enforcement.

No third-party requests occur by default. Map helpers construct links only; the UI must explain coordinate disclosure and get an explicit per-place opt-in before creating an embed.

Run the package lint, dependency-first build, typecheck and tests on Node 24, plus root codegen/RDF/duplication guards. Add invalid, boundary and hostile-input tests when changing parsing or validation.

All schema.org writes use the suite's canonical HTTPS namespace. Generated SHACL aliases read legacy HTTP Place types and unshared fields. Shared-predicate aliases (notes, visit/journey dates) are currently rejected by codegen; see README before changing compatibility. Never hand-migrate RDF to bypass that restriction.

Use local calendar days/months/years for presentation and statistics; keep stored Date instants and shard paths UTC.
