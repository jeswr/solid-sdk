<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Lane sst-8xm.32 — T-011

Implemented on `lane/sst-8xm.32`, based on `a314d905b750521f96fa61c73caa9bb84a2041ab`.
Scope: `@jeswr/storage-capabilities` LWS CID parser and validation from ADR-002 step 4.

## Commits

- `98abf5a8cab4db6391a5e2438b410c7d9038f873` — `feat: parse and validate LWS storage descriptions`:
  export `parseLwsDescription` and `CapabilitiesError`; validate normalised ids, Storage typing,
  one StorageRoot, and scheme/authority; map services, capabilities, and JWK verification methods;
  preserve unknown types/extras and expand bare LWS terms. Add the sparq example fixture,
  snapshot/adversarial tests, and package README/skill documentation.
- Final reporting commit (this commit) — `docs: record T-011 lane results`: add this lane report.

## Gate results

The final scoped gate ran before the reporting commit. All commands below exited 0:

```sh
pnpm --filter @jeswr/storage-capabilities run lint && pnpm --filter @jeswr/storage-capabilities run build && pnpm --filter @jeswr/storage-capabilities run typecheck && pnpm --filter @jeswr/storage-capabilities run test
pnpm run lint:root
pnpm exec turbo run build typecheck test --filter=...@jeswr/storage-capabilities
git diff --check
```

- Package lint, build, and strict typecheck passed.
- Vitest: 5 test files, 158 tests passed, including 54 CID parser cases and the sparq fixture snapshot.
- Configured V8 coverage passed at 100% statements (256/256), branches (177/177),
  functions (29/29), and lines (213/213).
- Root lint and its transport, app-workspace, fetch, token, and contrast guards passed
  (74 contrast pairs, zero failures).
- Turbo: 3/3 build/typecheck/test tasks passed. This base has no declared package dependants;
  the requested reverse-dependency filter selected only `@jeswr/storage-capabilities`.
- Neither `gate:full` nor the whole-workspace gate was run, per the lane instructions.

## Dependencies and policy

No dependencies or manifests changed. `check:packages` was not applicable and was not run.
No lockfile changes, network fetches/merges, pushes, or PRs.

## Implementation notes and limitations

- The parser takes decoded compact CID JSON and uses body shape for all three media types;
  it does not perform generic JSON-LD expansion or remote context fetching.
- Conservative validation requires exactly one StorageRoot and rejects malformed known entry fields.
  Description authority validation follows ADR-002's Security section as well as root validation.
- Only JWK-backed verification methods enter the ADR's public contract; their cryptographic types
  remain verbatim. HTTP cache metadata, injected clocks, and response-size enforcement belong to
  the later resolver; parser defaults are `Date.now()`, null ETag, and one-hour TTL.
- `sparqLwsCid` is authored representative public metadata matching the service set described
  by ADR-002 and the planning STATUS.md, not a response recorded from a running sparq server.

## Unfinished or blocked

No unfinished implementation within T-011.
Automated commit review is unavailable: `roborev status` exited 127 (`roborev: command not found`),
and this checkout has no installed post-commit review hook. No roborev verdict was produced.

## Open questions

None.

## Fix round 1 — review of cb995e45cbfc

Addressed exactly the two verification-method findings on the same lane branch:

- `40e8c6fd` — `fix: retain verification method validity metadata`: expose optional `revoked`
  and `expires` timestamps in the public contract, validate timestamp shape, and retain their
  original values for use-time verification, including after cache serialization. Tests retain
  both past and future validity limits and reject malformed metadata.
- `7171e185` — `fix: validate verification method JWK members`: validate known Web Crypto/JOSE
  member types, including boolean `ext`, string arrays, and nested RSA other-prime entries.
  Require nonempty key parameters for EC, RSA, OKP, and oct keys. Conservatively reject unknown
  key types because their required parameters cannot be validated; preserve unknown member
  extensions on supported keys. Add positive/adversarial tests and document the contract.
- Final reporting commit — `docs: record verification method fix results`: update this report.

Final gate commands (all exited 0 before the final reporting commit):

```sh
pnpm --filter @jeswr/storage-capabilities run lint && pnpm --filter @jeswr/storage-capabilities run build && pnpm --filter @jeswr/storage-capabilities run typecheck && pnpm --filter @jeswr/storage-capabilities run test
pnpm run lint:root
pnpm exec turbo run build typecheck test --filter=...@jeswr/storage-capabilities
git diff --check
```

Package lint, build, and typecheck passed. All 208 tests across 5 files passed, including 104
CID parser cases. Coverage passed at 100% statements (287/287), branches (198/198), functions
(31/31), and lines (242/242). Root guards passed, including all 74 contrast pairs. Turbo passed
3/3 tasks; the reverse-dependency filter still selected only this package. The original lane
brief reserves whole-workspace gates for the dispatcher, so those were not run.

No dependencies, manifests, or lockfiles changed; `check:packages` was not applicable.
No implementation remains unfinished within the fix brief. Cryptographic key import and
signature verification remain consumer responsibilities. Open questions: none.
`roborev status` exited 127 (`roborev: command not found`); automated commit review remains
unavailable. No pushes, PRs, branch switches, or remote fetches/merges were performed.

## Fix round 2 — review of 796f6f5dc265

Addressed exactly the two validation findings on `lane/sst-8xm.32`:

- `163cd527` — `fix: reject private material in public JWKs`: reject symmetric `oct` keys
  and every JOSE key parameter currently classified as private or secret (`d`, `p`, `q`,
  `dp`, `dq`, `qi`, `oth`, `k`, `priv`), regardless of the declared key type or member value.
  Replace tests that accepted secret material with rejection cases across EC, RSA, and OKP;
  retain positive tests for public parameters, metadata, extensions, and input immutability.
- `53ded004` — `fix: validate validity timestamp calendar bounds`: explicitly validate
  Gregorian month lengths and leap years, clock components, and timezone bounds through
  ±14:00 for both `revoked` and `expires`. Reject calendar rollover, invalid offsets,
  nonzero fractions at 24:00:00, and trailing line endings. Preserve valid timestamps
  verbatim through cache serialization and leave input untouched.
- Final reporting commit — `docs: record second validation fix results`: append this report.

Final scoped gate commands (all exited 0 before the final reporting commit):

```sh
pnpm --filter @jeswr/storage-capabilities run lint && pnpm --filter @jeswr/storage-capabilities run build && pnpm --filter @jeswr/storage-capabilities run typecheck && pnpm --filter @jeswr/storage-capabilities run test
pnpm run lint:root
pnpm exec turbo run build typecheck test --filter=...@jeswr/storage-capabilities
git diff --check
```

Package lint, build, and typecheck passed. All 207 tests across 5 files passed, including
103 CID parser cases. V8 coverage passed at 100% statements (297/297), branches (225/225),
functions (31/31), and lines (251/251). Root guards passed, including all 74 contrast pairs.
Turbo passed 3/3 tasks; its reverse-dependency filter selected only this package because
this base has no declared package dependants. Whole-workspace gates remain reserved for
the dispatcher under the original lane brief.

Conservative scope: retain the existing four-digit-year timestamp syntax and valid XSD
24:00:00 notation; do not expand the accepted timestamp formats or supported key types.
No dependencies, manifests, or lockfiles changed; `check:packages` was not applicable.
No implementation remains unfinished and there are no open questions.
`roborev status` exited 127 (`roborev: command not found`); automated commit review remains
unavailable. No pushes, PRs, branch switches, or Git remote fetches/merges were performed.
