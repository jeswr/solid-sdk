<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-capabilities

> **Experimental — AI-agent-generated.** Vocabulary, type contracts, header parsing, and Solid description mapping are implemented.

Storage description discovery and feature flags. Design of record: SDK core `ADR-002-capabilities.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

The package root exports the ADR-002 type contracts, including `StorageDescription`, `Features`,
`ResolveOptions`, `DescriptionCache`, `ProbeResult`, `ProbeEvidence`, and `WacMode`.
`@jeswr/storage-capabilities/vocab` exports `LWS`, `DID`, `SEC`, `DCT`, `NOTIFY`, `SOLID`,
`PIM`, `ACQ`, `ACL`, `ACP`, and `SSD` objects with full IRI values (for example, `LWS.Storage`).
The package's TypeScript configuration includes DOM types for the ADR's Web Crypto `JsonWebKey` contract.

Internal helpers for the later discovery implementation:

- `parseLinkHeaders(values, responseUrl)` in `src/link.ts` accepts one combined Link field,
  an array of separate field values, or `null`. It resolves targets and anchor contexts independently,
  retains relation lists and unquoted parameters, and ignores later singleton parameters.
  Extended attributes such as `title*` retain their wire encoding. A deterministic tokenizer skips
  malformed members at unquoted commas outside targets; an unterminated quote or target consumes the
  rest of that field. Fields over 8 KiB (UTF-8) are ignored, and parsing stops after 64 nonempty members
  across all fields, including malformed members. Invalid target/anchor URLs and members without
  relations are ignored.
- `parseProbeHeaders(url, headers, observedAt)` in `src/probe-headers.ts` parses ordered raw header
  pairs (or a `Headers` instance) into the architect's `ProbeResult`. Raw pairs preserve response order;
  `Headers` iteration may sort and combine fields. Recognised fields remain as evidence, including
  malformed WAC-Allow values. WAC-Allow keeps known user/public permissions alongside unknown
  groups and modes, lower-cases modes before recognition and deduplication, skips empty list
  members, merges repeated groups, and rejects malformed syntax. Accept-Patch and Accept-Post use
  a single-pass tokenizer for quoted parameters; an unterminated quote discards that member and
  the remainder of the combined field. Combined Accept-Patch, Accept-Post, and Allow fields over
  8 KiB (UTF-8, including joining commas) are treated as absent while retaining raw evidence.
  Links with a different anchor context are ignored for access control.
- `parseSolidDescription(dataset, rootUrl)` in `src/solid-description.ts` maps parsed RDF/JS
  datasets to `{ services, capabilities }` (ADR-002 step 5c). Notifications on any subject become
  `SSD.SolidNotificationService` entries, with channel IRIs included in `type` and expanded
  `notify:channelType`/`notify:feature` extras. `did:service`, `lws:capability`, and ACQ
  `solid-sparql:endpoint` are read only on the supplied root. Generic entries retain unknown
  types, named-node identifiers, profiles, and expanded extra predicates. Missing or non-IRI
  service endpoints are skipped; blank-node services with an IRI endpoint are supported.
  Extras retain IRI/literal lexical strings, use scalar singleton values and arrays for repeated
  values, and expand nested blank nodes into property objects with an `@id` so shared-node
  references can be resolved to their mapped properties. Repeated/cyclic blank nodes and
  nesting beyond 32 nodes are retained as `{ "@id": "_:<label>" }` references.
  Parse bytes first with `@jeswr/fetch-rdf`'s `parseRdf` and the description URL as `baseIRI`.
  The mapper does no fetching, origin validation, HTTP metadata handling, or dataset mutation.

Discovery, network probing, feature derivation, caches, and testing fixtures arrive in later tasks.
The `@jeswr/storage-capabilities/cache` and `@jeswr/storage-capabilities/testing` entry points remain reserved.

From the workspace root:

```sh
pnpm --filter @jeswr/storage-capabilities run lint
pnpm --filter @jeswr/storage-capabilities run build
pnpm --filter @jeswr/storage-capabilities run typecheck
pnpm --filter @jeswr/storage-capabilities run test
```

Tests cover the RFC 8288 §3.5 examples, quoted parameters, anchors, relation lists, repeated fields,
malformed input, parsing every probe observation, a CSS-style two-subscription JSON-LD description
with an offline notifications context, the ADR-008 Turtle example (four services and three
capabilities), ACQ mapping, root scoping, and malformed or cyclic extension data.
Coverage thresholds are 100% for branches,
functions, lines, and statements.
