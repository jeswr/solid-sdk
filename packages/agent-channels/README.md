<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-channels

> Experimental — AI-agent-generated. Private workspace package; no live provider bindings yet.

Channel contracts, carriage profiles, capability RDF and origin enforcement for DESIGN §3
(A-005 / sst-31t). The `ChannelBinding` and `CarriageProfile` declarations follow §3.1.

The root exports the shared legacy `BridgeMessage`, email projection helpers,
`ChannelAdapter`, explicit-parser `InMemoryChannelAdapter`, `TokenProvider`, profile
constants, `toRdf` and `capabilityToTurtle`. RDF delegates to agent-model's validated
Solid Resource / RDFJS wrapper mapping and rdf-serialize. Legacy-bridge re-exports
these shapes, preserving its email-default adapter and parser.

`createOriginScopedFetch(ORIGINS, options)` snapshots the binding's origins before any
request. It checks each target before DNS/connection, uses guarded-fetch with DNS
pinning by default, and refuses redirects. `options.createTransport` is a trusted
factory for a DNS-pinning transport or test fake. It receives frozen construction
options including `maxRedirects: 0`, which it must apply internally: passing a
preconstructed redirect-following fetch is unsafe because an outer refusal runs
after that fetch has already followed the redirect. `allowLoopback` is exclusively
for local tests.

`./direct` exports only `createDirectReader`. `./direct/send` owns the send half;
only agent-executor and channel tests may import it. `./testing` exports
`createInMemoryDirectBinding` and `RecordingTokenProvider` for tests. Layer lint
permits that single internal test-factory composition edge and refuses production
imports of `./testing`.

The test factory takes `{ tokens, verify, now? }`. `verify` must be a pure local
signature verifier returning the protected Message after checking the pinned key
and intended audience. Missing/unverifiable messages fail closed. Rendering is
deterministic; validation and transmission enforce freshness. Lookup may reconcile
an accepted message after expiry, using exact bytes as positive evidence.
Parsed BridgeMessages carry unverified JSON-LD; parsing confers no authority.

`transmit(wire, { account, tokens, dryRun? })` defaults to dry-run. Explicit
`dryRun: false` delivers only to the isolated in-memory inbox selected by `account`;
there is no network transport. Read paths request only `tokens.read(account)`;
send paths request only `tokens.send(account)`. Grants carry distinct `access`
discriminants and nonempty tokens. The recording provider uses distinct fake grants.
Pagination is account-scoped, bounded by total bytes and item count, and fails when
the next item cannot fit. Exact repeated sends are idempotent; conflicting bytes
or destination accounts are refused. Lookup has `finalAbsence: true`.

All DESIGN §3.2 rows have frozen constants in `CARRIAGE_PROFILES`. Only email's
25,000,000-byte limit is specified there. Other structured profiles use the pilot's
64 KiB local ceiling; footer-only profiles conservatively cap at 256 bytes pending
their binding tasks. LinkedIn/X have zero-byte read-only profiles. No profile
constant implements sending. The direct descriptor advertises zero owner rate
limits by default; it is a capability statement, never permission to send.

The remaining provider exports remain reserved for their own tasks. Packages
remain private per ADR-001 D5.

Run `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, and `pnpm run test` here.

Tests enforce 100% coverage per source file in every metric, with real local
Ed25519 signatures, adversarial inputs, a loopback HTTP server and a Turtle golden.
