<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-capabilities

> **Experimental — AI-agent-generated.** Vocabulary, type contracts, header parsing, and LWS CID parsing are implemented.

Storage description discovery and feature flags. Design of record: SDK core `ADR-002-capabilities.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

The package root exports the ADR-002 type contracts, including `StorageDescription`, `Features`,
`ResolveOptions`, `DescriptionCache`, `ProbeResult`, `ProbeEvidence`, and `WacMode`.
`@jeswr/storage-capabilities/vocab` exports `LWS`, `DID`, `SEC`, `DCT`, `NOTIFY`, `SOLID`,
`PIM`, `ACQ`, `ACL`, `ACP`, and `SSD` objects with full IRI values (for example, `LWS.Storage`).
The package's TypeScript configuration includes DOM types for the ADR's Web Crypto `JsonWebKey` contract.

`parseLwsDescription(json, storageUrl, requestUrl)` accepts an already decoded compact CID object,
including bodies served as `application/lws+cid`, `application/cid`, or `application/ld+json`.
It validates the normalised storage id, the Storage type, and exactly one StorageRoot. Both the
description URL and root must share the request URL's scheme and authority (ADR-002 §Security).
It maps services, capabilities, and JWK-backed verification methods, expands bare LWS
type/subscriptionType terms, and preserves unknown types and raw extra keys. Verification method
types and key material retain their cryptographic vocabulary. Scalar subscriptionType values stay
scalar; list values stay lists. Malformed descriptions throw `CapabilitiesError` with
`code: 'description-invalid'`; foreign description/root authorities throw `code: 'root-mismatch'`.
Verification methods retain optional CID `revoked` and `expires` timestamps. Consumers must enforce
these limits when using a key, including from cached descriptions. JWK parsing checks known member
types and requires the key parameters for EC, RSA, OKP, and oct keys; other key types are rejected
conservatively. Cryptographic key import and signature verification remain the consumer's responsibility.
Errors carry the supplied storage URL. URL normalisation keeps path case and trailing slashes.

The parser sets `fetchedAt` to `Date.now()`, `etag` to `null`, and `maxAgeMs` to 3,600,000. The later
resolver supplies HTTP cache metadata, injected clocks, body-size limits, and fetching. Parsing
uses the compact CID shape directly and does not fetch or expand JSON-LD contexts.
`@jeswr/storage-capabilities/testing` exports `sparqLwsCid`, a representative public example of
the sparq service set documented in ADR-002 and SDK-core STATUS.md, covered by a snapshot test.
It is not a recorded server response.

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

Discovery, network probing, feature derivation, caches, and other server fixtures arrive in later tasks.
The `@jeswr/storage-capabilities/cache` entry point remains reserved.

From the workspace root:

```sh
pnpm --filter @jeswr/storage-capabilities run lint
pnpm --filter @jeswr/storage-capabilities run build
pnpm --filter @jeswr/storage-capabilities run typecheck
pnpm --filter @jeswr/storage-capabilities run test
```

Tests cover the RFC 8288 §3.5 examples, quoted parameters, anchors, relation lists, repeated fields,
malformed input, parsing every probe observation, and CID mapping/validation. Coverage thresholds are 100% for branches,
functions, lines, and statements.
