# Agentic Web pilot profile 0.1 — personal agent

Status: **experimental, synthetic test use only.** The pilot is implemented in `src/pilot/` and
exported as `@jeswr/personal-agent/pilot`. The CLI is `awp-pilot` (`dist/pilot/cli.js`). The
existing M1 Reader / Actor / outbox code in `src/` is unchanged. Profile version **0.1.2** (§3).

This document instantiates one coherent configuration of every layer of the proposed
specification family (`../context/specification-outline.md`, parts A–G) and framework draft
0.3.

It does **not** claim independent interoperation, CDMC compliance, legal effect, regulatory
conformance, production readiness or a complete platform. Every run is synthetic and **both
sides of every exchange run this code base**.

Evidence:

- [PILOT-MATRIX.md](PILOT-MATRIX.md)
- `reports/pilot-demo-report.json` (default module) and `reports/pilot-demo-report-sparq.json`
  (SPARQ)
- `reports/pilot-integration-report.json`
- `reports/pilot-sparq-policy-cases.json`
- `reports/pilot-rdf-competency.json`
- `reports/pilot-governance-manifest.json`

Operating steps are in [OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md).

What phase 9 changed (profile version **0.1.2**; §24):

- **Health issuance authority.** A clinic enrollment register binds each authenticated patient
  principal to one compartment. Consent audience, purpose and validity are enforced. The grant
  never outlives the consent. Two synthetic patients cover cross-patient refusals.
- **Revocation ownership.** A revocation carries the issuer-signed grant; each server verifies
  that the grant belongs to the revoking patient, and persists that fact.
- **Protected deliveries keep their authorisation basis.** It is re-checked at every
  transmission through a generic runtime hook. A health searchset or NordWerk dataset release
  queued before a revocation or expiry is never sent (zero requests at the recipient).
- **Recoverable public replies.** Received replies are retained durably before the request
  counts as sent, and recovered through the runtime after a crash. Lost or malformed replies
  lead only to an identical re-request of the public read.
- **Accurate interruption semantics** for durable handlers (§24.3).

What phase 8 changed:

- **Recovery corrections (§21).**
  - A late refusal of an idempotent resend no longer erases the earlier attempt's uncertainty.
  - Purpose-store evidence is bound to the item's committed **revision**, so a re-grant is not
    served on an older grant's evidence.
  - Committed erasures recover their `data-erased` evidence.
- **Anonymous public carriage `public-http/0.1` (§22).** A small loopback carriage for the
  declared public profile: no principal, credential, token or cookie.
- **Durable regional roles (§23).** Energy (AU), health (US) and industrial (EU) actors run as
  independently initialised, persistent agents that compose the EXISTING domain handlers.
  Shared provisioning lives in `src/pilot/fixtures/`. Each region has in-process tests and a
  separate-process workflow: `scripts/pilot-regional-integration.mjs`, **29/29 checks**
  (`reports/pilot-regional-report.json`).
- **Role provisioning.** New `init` options:
  - `--role-input KEY=VALUE`;
  - `--owner-name ORG`: one organisation owner key shared by that organisation's agents, each
    with independent actor keys.
  
  New commands: role-declared owner statements (`owner-sign`), role issuing keys
  (`issuer-card`), and discoverable role metadata (`roles`).

What phase 5 changed:

- **Long-running policy pin.** The pinned SPARQ binary is re-checked before *every* decision, so
  a running service answers `indeterminate` after the binary is replaced or removed, and
  reports this. Inspection uses the same resolution as the runtime. Re-pinning, pinning and
  service configuration take the agent's lock and are refused while a service owns the agent
  (§15).
- **Policy profile vs evaluator.** Configurations name the shared **policy profile**
  (`…/policy-profile/odrl-pilot-subset/0.1`). The implementation description separately
  declares the selected **policy module** (evaluator name/version/interface and current status,
  with no path or digest), and the RDF export keeps the two apart (§3, §9). Peers need not run
  the same evaluator.
- **Local MCP interface** (`awp-pilot mcp`, official `@modelcontextprotocol/sdk`, stdio). It
  provides operator tools for a coding agent and the `mcp-tool/0.1` communication binding for
  signed peer messages, and is tested in separate processes with the real SPARQ module (§18).
- **Executable operator runbook** with a POSIX/zsh smoke script
  ([OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md)).

What phase 4 changed:

- **Provider recovery.** An uncertain provider send is re-attempted only on causally final
  absence; a Gmail search miss never counts as absence. Positive evidence is verified against
  the stored message (§5).
- **Policy module.** SPARQ is the recorded, probed and pinned default policy module and is
  exercised end to end (§15).
- **RDF.** The competency SPARQL runs on a real SPARQL engine (§9).
- **Dependencies.** The undici, hono, @hono/node-server and qs advisories are resolved (§16).

## 1. What runs

| Scenario | What happens (real code paths) | Evidence |
|---|---|---|
| P1–P9 personal ↔ personal scheduling | Two separately configured agents discover each other, select a configuration, negotiate, each books one synthetic hold and exchange receipts. Adverse cases: mismatch, fee refusal, tampering, replay, wrong audience, expired mandate/representation, no common configuration, timeout-after-commit + crash + restart + reconciliation, owner approvals bound to exact actions. | `scheduling`, `security`, `core`, `email`, `cli`, `review-fixes` tests; report P1–P9 |
| P2 email binding | Every hop is carried only as MIME inside Gmail `format=raw` JSON, with strict layout/parity (§6). Provider sends go through the transmission gate (§5). | `email`, `outbound`, `transmission`, `cli` tests; report P2 |
| C conventional scheduling link (UC-02/R25) | A first-contact link is classified (never fetched) and remembered with provenance. It is promoted only by an owner-signed confirmation, re-checked, and booked through a deterministic adapter against a **local synthetic reference service**. | `conventional`, `provider-http` tests; report C; integration B.1–B.7 |
| M mortgage (UC-01) | Bounded evidence request, owner approval, relayed issuer-signed evidence, scoped source authority, purpose-bound enforcement and an attenuated onward grant. The valuation fee goes to approval; settlement is unknown, so the obligation stays unresolved. | `mortgage.test.ts`; report M |
| E public energy (UC-03) | Anonymous unsigned requests, signed responses, version negotiation, excluded plans, cited estimates. No authorisation decisions. **Durable roles, separate processes (§23).** | `energy.test.ts`, `energy-durable.test.ts`; report E; regional report E.0–E.7 |
| H synthetic FHIR (UC-04) | Discovery vetting, patient-approved scope subset, key-bound grant, scope enforcement, stolen-grant refusal, revocation. **Durable roles, separate processes (§23).** | `fhir.test.ts`, `health-durable.test.ts`; report H; regional report H.0–H.7 |
| I industrial (UC-05) | Internal delegation, restricted catalogue, org-signed representation scope, purpose check, no transfer before agreement, retry, duplicate suppression, consumer-side usage enforcement. **Durable roles, separate processes (§23).** | `industrial.test.ts`, `industrial-durable.test.ts`; report I; regional report I.0–I.12 |

No LLM is used on any of these paths. All institutions, people, data and outcomes are
synthetic, and identifiers use reserved example domains.

## 2. Architecture

```
   operator (CLI · coding agent over local MCP stdio: inspect / propose / list+ack outbound)
            bindings (direct-local/0.1, email-mime/0.1 + Gmail payloads, file spool, mcp-tool/0.1)
                                │ WireMessage (compact JWS | unsigned public JSON)
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ AgentRuntime (src/pilot/runtime/agent.ts) — one engine for every scenario     │
│  every entrypoint runs through ONE serial queue (re-entrant calls refused)   │
│  READER   bounds → JWS verify vs PINNED key → schema → sender/key binding →   │
│           config/alg → audience → time → replay set → state machine → terms   │
│  PROPOSER domain OperationHandler (pure; returns replies/plans + ActionIntent)│
│  EXECUTOR mandate authorisation by the RECORDED POLICY MODULE (SPARQ default) │
│           + approvals + persisted revocations; write-ahead effects; recover() │
│  TRANSMIT provider sends re-authorised at send time; durable records;         │
│           recovery only on verified positive evidence or final absence        │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 3. Profile choices (the selected configuration)

Profile `https://w3id.org/jeswr/awp/profile/pilot/0.1` (version **0.1.2**: 0.1.1 plus the
phase-9 disclosure conditions, health operations 0.2 and public reply recovery, §24). Minted terms use
`https://w3id.org/jeswr/awp#`, which is **provisional and unregistered**.

| Concern | Selected | Not selected / unresolved |
|---|---|---|
| Identifiers | Opaque IRIs for parties, actors and operators. Minted mandate, policy, rule, representation and target identifiers are `urn:awp:<kind>:<digest>:<label>` (`scopedUrn`). Statements with a non-IRI id are refused; 0.1.0 agents must be **re-initialised** (signed statements are never rewritten). | resolution-based discovery |
| Authentication | Actor-key signature; key only from the local trust store by RFC 7638 thumbprint | sender-supplied keys |
| Integrity | JWS compact, EdDSA/Ed25519 or ES256 | Data Integrity, selective disclosure |
| Representation | Party-signed `RepresentationStatement` against the pinned party key | global identity equivalence |
| Authorisation (own actions) | Owner-signed `OwnerMandate` (autonomous and with-approval policies) in the shared **policy profile** `https://w3id.org/jeswr/awp#policy-profile/odrl-pilot-subset/0.1` (ODRL 2.2 pilot subset, three-valued). Approvals are bound to the action digest and revocation is persisted. The configuration names only the profile. The implementation description declares the **selected policy module**: SPARQ by default, solid-odrl only if chosen explicitly (§15). | duties, other conflict strategies |
| Source authority | Local rules (validated dates, rule id + version) | trust frameworks |
| Replay / freshness | Unique id, ≤ 24 h lifetime, 5 min skew, persistent seen-set | cross-device caches |
| Serialisation | `awp-json/0.1`; RFC 8785 + SHA-256. RDF (§9) is an optional export | JSON-LD on the wire |

## 4. Wire semantics

Unchanged since 0.1.0 except identifier minting (§3). This covers message kinds, the state
machine, reason codes, bounds (`core/limits.ts`) and the effect lifecycle:
planned → attempting → concluded. Timeouts and re-entrant calls are `uncertain`, and
reconciliation happens before any retry.

## 5. Concurrency, recovery, retention and provider transmission

Serial execution, the single-writer lock, persisted revocation, single-snapshot conclusion +
receipt, `recover()` and bounded retention are unchanged.

### Transmission gate

`AgentRuntime.transmit` (phase-2 items 1 and 2) makes each provider send:

- an authentic entry of this agent's outbox;
- unexpired;
- **re-authorised** under the current mandate, revocations and approvals, if its emission was
  an authorised action. The declared metadata rule is that messages with no authorised action
  need only be authentic and unexpired.

It persists a durable record per message:

1. `attempting` is persisted *before* the provider is called;
2. the record then becomes `sent`, `not-sent` (a definitive refusal, e.g. HTTP 400) or
   `uncertain`.

**One boundary for every sending binding (phase 7).** Gmail and A2A both send only through
`transmit`. It runs in three phases: (1) serially — check the record, re-authorise *now*, write
`attempting`; (2) the provider/peer request and any lookup with **no** runtime lock held, so a
peer sending to this agent at the same moment is never queued behind this agent's network call;
(3) serially — record the outcome. A refusal in (1) means no request is made at all. A binding
whose receiver deduplicates by the signed message id (A2A) may declare `idempotentResend`: an
unresolved record is then resolved only by re-sending the *identical* signed message,
re-authorised like a first attempt, never while a request of this process is pending; a refused
or failed resend leaves the record `uncertain` — never "not sent". If the runtime closes during
(2), the record stays `attempting` and the next owner reconciles it.

### Recovery contract (phase-3 review item)

An `attempting`/`uncertain` record is never retried blindly:

- **Positive evidence.** A `found` result (the binding has verified it against the exact
  message) reconciles the record as sent without another request.
- **Absence.** `absent` licenses another attempt **only** when the transmission I/O declares
  `finalAbsence`. That declaration means the provider guarantees the earlier operation did
  not execute *and* can no longer complete, for example because the lookup itself fences the
  operation key. Otherwise `absent` is treated as `unknown`.
- **In flight.** A timeout does not cancel a request. While a timed-out request from this
  process is still pending, nothing is re-attempted, even under declared finality. Its late
  settlement is recorded when it arrives; after `close()` nothing is written.
- **Malformed results.** Send and lookup results are validated at the boundary: exact
  discriminants and keys, and a bounded `providerRef`. A malformed send result is `uncertain`
  and a malformed lookup result is `unknown`.
- **Limits.** With declared finality, at most `MAX_TRANSMISSION_ATTEMPTS` (3). Without it, at
  most one provider request per message from this runtime state. **This is not exactly-once
  delivery:** an uncertain request may or may not have been delivered, and delivery beyond
  the provider is outside this boundary.

### Gmail

Gmail offers no causally final absence. A search can miss a message that was sent: a
timed-out request may still complete, indexing may lag, and a copy may have been moved or
deleted. So:

1. `findByMessageId` returns only **candidates**:
   - it searches `rfc822msgid:<derived id> in:anywhere`;
   - the list response is validated: `messages`, `resultSizeEstimate` and `nextPageToken`
     members only, and `{id}` entries only;
   - anything else is `unknown`.
2. The adapter fetches each candidate (at most 5) and accepts it only if the stored copy is
   *this* message. The check (`verifyProviderCopy`) requires:
   - it parses through the hardened inbound path with strict human parity;
   - it carries the exact signed envelope and the derived Message-ID;
   - `From` is the source account and there is exactly one `To`, the pinned recipient;
   - there are no Cc/Bcc/Resent recipients;
   - every header this agent emitted is present with the same values (a provider may add
     headers).
3. An empty, malformed, incomplete or unverified result leaves the send **uncertain**; it is
   never re-sent automatically. Resolving it is an operator decision (runbook §6).

Tests (`transmission.test.ts`, 16) use injected local fakes only:

- the review reproduction: the injected REST provider accepts the send but its response
  arrives late, then lookup returns `{}`, empty or malformed `messages`, missing ids, an
  unexpected member, a malformed page token, a null/array body, HTTP 500 or an unrelated id.
  Across retries **and a restart** the record stays uncertain with exactly one send; the late
  response to the closed runtime writes nothing;
- tampered copies (recipient, Cc, sender, Message-ID, subject, text part, not MIME) are
  rejected; a verified copy with an added provider header reconciles without another send;
- absence without finality stays uncertain; declared-final absence permits a bounded
  re-attempt;
- an in-flight request blocks re-attempts, and its late acceptance is recorded;
- malformed send and lookup discriminants are rejected.

Five mutations of these guards were each killed
(`../reports/phase4-transmission-mutants.mjs`).

## 6. Email binding (email-mime/0.1)

Outbound MIME is exactly
`multipart/mixed(multipart/alternative(text/plain,text/html),application/ld+json)`.

- Inbound parity is strict: plain and HTML must equal the rendering of the signed payload.
  `--lenient-parity` records `unverified`, never `match`.
- Outbound `Message-ID` is derived from the signed message id, and `X-AWP-Message` must equal
  that id.

## 7. Security assumptions and boundaries

The pilot assumes:

- a trusted local runtime directory and process;
- out-of-band thumbprint comparison before pinning;
- clocks within 5 minutes;
- a local POSIX filesystem.

Private keys are synthetic, `0600`. **The running service never loads the owner key**
(`readAgent` reads only the actor key and public/signed material); owner signing is an explicit,
separate command (`sign-approval`, `approve`, `confirm-association`) that reads the owner key
from `--owner-dir` — or, for directories created without it (compatibility), from
`keys/owner.private.jwk.json` in the service directory. New agents should be initialised with
`init --owner-dir DIR`: the owner key is then written only to `DIR/<name>/` and the service
directory contains no owner private material. This is a directory of the same OS user on the
same host — a filesystem boundary, not hardware custody or OS isolation (runbook §1a).

The SPARQ binary is a local executable pinned by path and SHA-256. The pilot trusts the
operator who pins it, not the binary's origin; there is no signature or provenance check.

Not addressed: key rotation / event-time key state, revocation registries, confidentiality,
traffic analysis, multi-host concurrency, deletion evidence beyond the lender purpose store's
own purge (§19), log completeness.

## 8. UC-02 / R25 — remembered conventional scheduling service

Unchanged from phase 3:

- **Streamed bounded reads.** Responses are capped at 64 KiB and cancelled on overflow, with
  one deadline covering the body.
- **Strict parsing.** Bodies must be strict JSON, UTF-8, within depth limits and of the
  expected shape.
- **Validated reconciliation.** Only an exact-request match counts as booked. Only
  `{"booking": null}` counts as authoritative absence.

`SlotsService` remains a **local synthetic reference service**, not Calendly.

## 9. Vocabulary and RDF instantiation (optional serialisation)

`docs/rdf/awp-pilot.ttl` defines provisional terms and a PROF profile, with no domain/range or
equivalence axioms. The export keeps identifiers exactly as recorded. Non-IRI identifiers are
omitted and listed rather than rewritten.

**Policy profile vs evaluator (phase 5).** An implementation description's `policyModule` maps
to two separate nodes:

- an `awp:PolicyModule` node (`urn:awp:policy-module:…`) carrying `schema:name`,
  `schema:softwareVersion`, `awp:moduleInterface` and `awp:moduleStatus`;
- linked by `awp:policyProfile` to the shared `awp:PolicyProfile`.

No local path or digest is exported.

**Real SPARQL execution.** `npm run pilot:rdf -- --sparq-cli=PATH` (or `AWP_SPARQ_CLI`)
executes every competency query as SPARQL 1.1 with **SPARQ's CLI**:

- the invocation is `sparq-cli query <file> turtle <sparql> --format json`, with no reasoning;
- the binary is a local build from the isolated worktree, always invoked by explicit path;
- the rows in `reports/pilot-rdf-competency.json` are the engine's SPARQL JSON results, with
  full terms (`type`, `value`, `datatype`, `lang`).

The package's small basic-graph-pattern helper is kept, **not extended**, and runs only as an
independent consistency comparison. The comparison uses the helper's projection: compacted
IRIs and lexical values.

Current run over the 1,395-triple export (phase 5; it now includes the policy-module node):

| Query | Engine rows | Agrees with helper |
|---|---|---|
| CT-02 | 15 | yes |
| CT-03 | 1 | yes |
| CT-05 | 2 | yes |
| CT-07 | 3 | yes |
| CT-07-peer | 4 | yes |
| R11-unresolved (after reconciliation) | 0 | yes |
| R11-unresolved (before reconciliation) | 1 | yes |

- **Absence checks.** All 12 per-ledger absence checks return 0 rows. Each check also has a
  **positive control**: a minimal graph asserting exactly its pattern, which the engine
  answers with 1 row, so the zeros are not vacuous. An empty answer still means "not
  asserted", not "not entailed".
- **Evidence level.** Agreement between two implementations is consistency evidence, not
  formal SPARQL conformance.
- **`CQ-R11-unresolved`.** This query compares no ordering. It is correct for this runtime
  because nothing is recorded for an effect after a final conclusion.
- **Without the engine.** The graph files are written, the report says `setup-required`, and
  the script exits 3.

## 10. Separate-process integration workflow

`npm run pilot:integration` (SPARQ by default; the binary comes from `--sparq-bin=` or
`AWP_SPARQ_POLICY_BIN`, else exit 3) → `reports/pilot-integration-report.json`.

Current run: **20/20 checks across 49 OS processes**:

- the personal exchange with a real SIGKILL after commit, stale-lock takeover and replay after
  restart;
- UC-02 against the reference service process;
- a governance audit of each agent directory;
- **P.1** — every agent directory records SPARQ and it is ready;
- **P.2** — a changed binary makes the module unavailable in a fresh process;
- **P.3** — every authorisation decision in the CLI agents' ledgers names `sparq-policy@0.1.0`;
- **C.1/C.2** — the M/E/H/I workflows each run in their own process under SPARQ:
  - every verdict comes from SPARQ;
  - M, H and I produce verdicts; E, being anonymous and public, produces none.

`--policy-engine=solid-odrl` runs the same workflow with the alternative module, explicitly.
This is the same implementation on one host: not live-provider or interoperability evidence.

## 11. Resource governance metadata (R16–R18; no CDMC claim)

- **Register and audit.** Unchanged from phase 3: pinned CDMC v1.1.1 register (AW-CDMC-01…14),
  accountable identifiers from local configuration, and an explicit, not-started
  37-sub-capability assessment target.
- **Phase 4 addition.** The register adds `policy-engine.json` (operator configuration).
- **No claim.** No framework text is reproduced. The pilot is **not CDMC compliant, assessed
  or certified.**

## 12. Commands

```sh
npm install --ignore-scripts
npm run gate                         # lint (+ lockfile transport), typecheck, all tests, build, dist check
npm run pilot:demo                   # 14 scenarios / 65 checks, harness default module (solid-odrl)
AWP_SPARQ_POLICY_BIN=… npm run pilot:demo:sparq     # same scenarios decided by SPARQ, cross-checked
AWP_SPARQ_POLICY_BIN=… npm run pilot:integration    # separate processes (§10)
AWP_SPARQ_POLICY_BIN=… npm run pilot:mcp-integration # MCP servers in separate processes (§18)
npm run pilot:a2a-integration -- --sparq-bin=…      # MCP operator + loopback A2A + durable mortgage roles (§19–§20)
AWP_SPARQ_POLICY_BIN=… npm run pilot:smoke          # operator smoke script (sh); also `zsh scripts/operator-smoke.sh`
npm run pilot:sparq-cases            # 19 policy vectors against the SPARQ binary (default worktree path)
npm run pilot:rdf -- --sparq-cli=…   # RDF export + competency SPARQL on SPARQ's CLI (§9)
node dist/pilot/cli.js mcp --name N --dir D          # local MCP server for a coding agent (stdio)
```

The live Gmail hand-off, hosted deployment and owner-key custody beyond a same-user
directory (hardware, OS isolation, the owner's own device) are **setup-required**. The exact steps are in [OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md) §8.

## 13. Review findings → fixes

Phase 1 findings 1–7 and phase-2 items 1–6: see the phase-2/3 revisions; the tests are
`outbound`, `review-fixes`, `email`, `transmission`, `provider-http`, `identity` and
`governance`.

| Phase-3 review item | Fix | Regression evidence |
|---|---|---|
| Gmail search absence permitted a resend | Gmail lookup yields candidates only; each is verified against the stored copy; a miss or malformed result is `unknown` | `transmission.test.ts` REST-provider reproduction (12 inconclusive bodies × before/after restart, one send); 7 tamper cases; verified reconcile |
| Generic contract lacked finality | `TransmissionIo.finalAbsence`; absence without it is `unknown`; in-flight requests block re-attempts; late settlement recorded | generic-contract tests; mutants killed |
| Malformed external results | `providerSendResultOf` / `providerLookupResultOf` exact validation | malformed send (7 shapes) and lookup (5 shapes) tests |
| SPARQ verification | ODRL suite fetched at the pin and run; feature/bridge/N3 checks; one N3 fail-open fixed (§15) | §15 |
| Pilot workflows on SPARQ | recorded, probed, pinned module; SPARQ demo + integration | §10, §15 |
| Real SPARQL | SPARQ CLI executes the competency queries | §9 |
| Dependencies | undici override, hono/@hono/node-server/qs updates | §16 |

| Phase-4 review finding | Fix | Regression evidence |
|---|---|---|
| 1. Pin checked only at open; a long-running runtime executed a replaced binary | `pinnedSparqEngine` re-checks path + SHA-256 before every decision; `availability()` reports it live; status and descriptions show it | `policy-config.test.ts`: the SAME resolved engine returns `indeterminate` after replacement (the replacement never runs) and after removal; a running runtime reports unavailable; MCP workflow M.10 (dave's running server) |
| 2. Inspection could report the legacy fallback | `policy-engine` uses the runtime's resolution (`agentPolicy`); re-pin, `pin` and `configure-service` take the agent lock and re-pin is recorded in the ledger | `policy-config.test.ts` (locked re-pin refused, audited; missing record → unavailable); `mcp.test.ts` (pin refused while the server runs) |
| 3. Discovery named solid-odrl under SPARQ; no structured module | configurations name the policy profile only; the description carries `policyModule` (evaluator, version, interface, status; no path); RDF keeps profile and evaluator apart | `policy-config.test.ts` finding-3 test; MCP workflow M.2 |
| 4. Runbook not executable; lifecycle wrong | shell functions; valid single-writer order; operate through the running service; graceful stop; `scripts/operator-smoke.sh` | smoke script (see §17 for how it was exercised); `scripts/mcp-client.mjs` and `scripts/check-mcp-config.mjs` run manually on this host |

## 14. Decisions for supervisor review

1. Register or replace the provisional namespace `https://w3id.org/jeswr/awp#`.
2. Strict parity rejects forwarded or provider-rewritten mail. The lenient fallback is
   deliberately not adopted until the recipient pair is answered.
3. The metadata transmission rule (§5): should a revoked agent still send receipts and
   refusals?
4. Operator resolution of uncertain sends has no command yet. The record stays unresolved;
   runbook §6 describes the manual procedure and its risk.
5. Should the SPARQ binary be a signed release artifact rather than a pinned local build?
6. The Vitest 3 → 4 migration is deferred (§16).

## 15. SPARQ policy module

### Rust changes (worktree `../sparq-policy`, uncommitted)

The phase-3 changes are now compiled and tested:

- the three-valued `decide()`;
- conservative `evaluate()`: a possibly applicable prohibition blocks the grant;
- unsupported or malformed operands on prohibitions stay unresolved;
- the opt-in `json-cli` adapter and `sparq-policy-decide`.

Phase 4 found and fixed one real divergence. The `sparq-solid` N3 path still **granted** where
the Rust reference now withholds the grant. The case is a prohibition whose constraint needs
context the request omits: the strata's negation-as-failure over an underivable
`prohibMatches` re-opened access.

`materialize_odrl_n3` now refuses when the shared `prohibition_status` is `Ambiguous`.
Refusal materialises nothing and is never more permissive. New differential pins M1 and M2
cover this, and the access-control SKILL is updated. See
`../reports/PHASE4-SPARQ-POLICY.md` for the gates and the diff.

### Pilot module

`policy-config.ts` handles the module record:

- **Init.** `awp-pilot init` selects **SPARQ by default**. It needs `--sparq-bin` or
  `AWP_SPARQ_POLICY_BIN`, **probes** the binary, and records `policy-engine.json` (engine,
  absolute path, SHA-256, reported evaluator identity). The probe requires a permit for a
  broad permission and `indeterminate` for a possibly applicable purpose-gated prohibition.
- **Clean install without a binary.** `init` fails with build instructions and writes
  nothing. `--policy-engine=solid-odrl` is the explicit alternative.
- **Every decision (phase 5).** The pinned binary's path and SHA-256 are re-checked
  immediately before each decision. A missing or changed binary, or a missing record in a
  recorded directory, makes that decision `indeterminate` (fail closed), also in an
  already-running service. `status`, `policy-engine`, the MCP `get_status` tool and the
  implementation description report the current availability. Reasons carry no local path.
  This detects replacement between decisions; it is not a defence against a compromised
  host. `AWP_POLICY_ENGINE` must agree with the record. **There is never a fallback.**
- **Re-pinning.** `awp-pilot policy-engine --name N --sparq-bin PATH` is an explicit operator
  action. It takes the agent's state lock, so it is refused while `serve`/`mcp` owns the
  agent, and it applies from the next start. It is recorded as `policy-module-recorded` in the
  hash-chained ledger, and the replaced record is kept. Inspection without re-pinning uses the
  same resolution as the runtime.
- **Legacy directories.** Directories from phase 3 have no record and are reported as
  `legacy-unrecorded`.

### Evidence with the real binary

| Evidence | Result |
|---|---|
| Policy vectors (personal, mortgage, industrial, reproduction) | 19/19 pass; both modules agree |
| SPARQ demo | 14 scenarios / 65 checks pass; all 163 verdicts answered by `sparq-policy@0.1.0 decide()`, none unanswered |
| Cross-check against solid-odrl (comparison only) | 163 verdicts compared, 0 disagreements |
| Integration | 20/20 (§10) |
| Recording/probing/pinning boundary | `policy-config.test.ts` (9, stand-in executables, clearly labelled) |
| MCP workflow with the recorded module | every authorisation decision by `sparq-policy@0.1.0`; a replaced binary under a running server → indeterminate (§18) |

## 16. Dependency maintenance

- **fast-uri, ip-address, nanoid, postcss.** Updated by the supervisor before this phase.
- **undici** (the only high advisory, and loaded by the pilot at import):
  - the scoped override is `"overrides": {"@jeswr/guarded-fetch": {"undici": "8.9.0"}}` and
    applies to every guarded-fetch instance (4);
  - undici 8.9.0 requires Node ≥ 22.19.0, so `engines.node` is now `>=22.19.0`;
  - guarded-fetch uses only `Agent`, `buildConnector` and `fetch`.
    `src/guarded-fetch-undici.test.ts` pins the loaded version and exercises all three against
    a 127.0.0.1 server: a pinned request, loopback refusal without the hatch, and a followed
    local redirect hop versus a refused metadata-address hop.
- **hono / @hono/node-server / qs.** Updated to 4.13.9 / 1.19.17 / 6.16.0, inside the MCP SDK's
  and Express's declared ranges.
- **Scope of the change.** `npm install --ignore-scripts` and `npm update … --ignore-scripts`
  were used, with no `audit fix --force`. The lockfile diff is exactly these four version
  changes plus git-transport normalisation (`npm run fix:lockfile-transport`; the
  `check:lockfile-transport` lint passes).
- **Audit.** From 10 (1 high, 9 moderate) to **2 moderate**: `vitest` / `@vitest/mocker`
  GHSA-82fw-gwwq-j7x9, a path traversal through the mocker plugin. It requires a Vite/Vitest
  dev server exposed beyond localhost with HMR WebSocket access. This project only runs
  `vitest run`, with no watch server, browser mode or `server.host`, so the exposure is
  runner-only and not reachable in this usage. The fix (Vitest 4.1.11) is a major migration,
  deferred. Saved audit: `../reports/phase4-npm-audit.json`.
- **Phase 5: `@modelcontextprotocol/sdk`** is declared as a direct dependency (`^1.29.0`). It was
  already in the tree at 1.29.0, via `@jeswr/solid-mcp` and the dev-only
  `@anthropic-ai/claude-agent-sdk`; 1.30.1 is the current release. The lockfile diff is only the
  root `dependencies` entry (plus HTTPS transport normalisation), and there are no new
  packages. The audit is unchanged: 2 moderate, Vitest only (`../reports/phase5-npm-audit.json`).
- **Phase 6: `@a2a-js/sdk` 1.2.1** (official A2A JavaScript SDK, a2aproject/a2a-js, Apache-2.0;
  implements A2A protocol 1.0) and **`express` ^5.2.1** are declared as direct dependencies.
  Compared with the pre-phase lockfile (`../reports/phase6-package-lock.before.json`) exactly one
  package is added (`@a2a-js/sdk`; its only dependency `jose` was already present), none removed
  or changed: `express` 5.2.1 was already in the tree via `@modelcontextprotocol/sdk`. The SDK's
  optional peers (`@grpc/grpc-js`, `@bufbuild/protobuf`) are not installed; only the JSON-RPC
  binding is used. `npm audit` after the addition: 2 moderate, Vitest only (unchanged).
- **Phase 7: `@types/express` ^5.0.6** (dev) was installed by the supervisor with scripts
  disabled (nine type packages). The temporary local Express declaration from phase 6 is
  removed; the binding compiles against the official types with no casts to hide errors.

## 17. Tested vs simulated vs setup-required

- **Tested, real cryptography, in-process.** The §1 scenarios and all unit tests (gate green),
  including provider recovery with injected REST fakes and the MCP server over in-memory stdio
  framing.
- **Tested with the real SPARQ evaluator.** Policy vectors, the full SPARQ demo with
  cross-check, the integration workflow and the MCP workflow (all local debug builds from an
  uncommitted worktree).
- **Tested with a real SPARQL engine.** The competency and absence queries (SPARQ CLI), with
  consistency against the local helper.
- **Tested, separate local processes (same implementation).** §10, §18, §19–§20
  (`pilot:a2a-integration`: MCP operator + A2A peer transport + real SPARQ, with process
  restarts), and §23 (`scripts/pilot-regional-integration.mjs`: energy over the anonymous public
  carriage, health and industrial over A2A; real SPARQ; restarts and replays).
- **Operator smoke script.** `scripts/operator-smoke.sh` passes under both `sh` and `zsh` on this
  host (phase 6). The phase-5 stall at the FIFO shutdown step was Node not reporting EOF on a
  FIFO stdin; the server now reads a FIFO fd 0 with an EOF-reporting reader (`FdReader`), with a
  regression test, and the script's cleanup kills only its own server child with a bounded wait.
- **Simulated.**
  - the email provider: files moved by the harness; injected fake transports in tests;
  - the scheduling provider: a local synthetic reference service;
  - the stand-in executables in `policy-engine`/`policy-config` protocol tests;
  - every institution, person, calendar and dataset.
- **Setup-required / not done.**
  - live Gmail: the account pair is pending, no request has ever been made, and the account
    integration stays setup-required;
  - hosted deployment;
  - owner-key custody beyond a separate same-user directory (hardware, OS isolation, the owner's
    own device), key rotation, and migration of pre-phase-7 colocated keys;
  - A2A beyond loopback (TLS, real hosts, discovery), independent-vendor A2A interoperability,
    chat bindings and any remote (network) MCP transport;
  - the regional roles beyond this host: real retailers, clinics, FHIR servers, authorisation
    servers or data-space connectors; the mortgage valuation/fee branch (in-process fixture
    only);
  - a signed SPARQ release artifact;
  - any CDMC assessment.

## 18. Local MCP interface (`awp-pilot mcp`)

`src/pilot/mcp/server.ts` uses the official `@modelcontextprotocol/sdk` (`McpServer`,
`StdioServerTransport`). There is no second protocol stack, no network listener, and the trust
boundary is the local OS user who starts the process.

- **Operator tools.** `get_profile`, `get_status`, `get_evidence`, the ROLE's declared domain
  operations (personal: `propose_meeting` — pinned peers only; party from the trust store;
  within the owner mandate; mortgage roles: §19), `submit_approval`, `list_outbound` and
  `ack_outbound` (plus `dispatch_outbound` with A2A, §20), and the resources
  `awp://agent/profile` and `awp://agent/status`.
  - They reuse `openAgent`/`AgentRuntime`/`processInput`/`prepareOutbound` through one shared
    `AgentHost` (`src/pilot/host.ts`); there is no separate state machine.
  - `submit_approval` accepts only an approval statement signed with the OWNER key outside the
    server (`awp-pilot sign-approval`); the runtime verifies the owner signature and that it
    binds to the exact pending action. An actor-key or unsigned approval releases nothing.
  - Not exposed: shell or files, private keys, pinning or trust edits, approval without an owner
    signature, mandate changes, provider sending.
  - `list_outbound` pages are byte-bounded (`cursor`/`limit`, `nextCursor`); resources obey the
    same 512 KiB result bound.
- **MCP communication binding `mcp-tool/0.1`.** `deliver_inbound` carries one signed peer
  message: an envelope, or the email MIME binding (Gmail JSON / RFC 5322) carried over MCP and
  recorded as `email-mime/0.1 via mcp-tool/0.1`.
  - Connecting authenticates nobody. The runtime's integrity, pinned-key, representation,
    policy, audience and replay checks run unchanged.
  - Oversized input is refused by the tool schema (256 KiB) before the runtime. An MCP line over
    1 MiB stops the server before it is buffered.
  - Callers cannot choose an actor identity: outbound messages are signed only with the agent's
    own key.
- **Advertised bindings.** The server advertises `mcp-tool/0.1` in its implementation
  description; CLI and spool processes do not. The shared configurations list `mcp-tool/0.1`
  among the bindings they can be carried over.
- **Lifecycle.**
  - One runtime owner per agent directory (state lock). Competing CLI runtimes and
    configuration changes are refused while it runs.
  - Tool calls are serialised, and outputs are bounded (list limits; 512 KiB result cap). At most
    32 calls may wait; more are refused (`server busy`).
  - stdout carries only MCP messages; diagnostics go to stderr.
  - On stdin EOF or SIGINT/SIGTERM the server first stops accepting calls (atomically: later
    calls are refused `server is shutting down`), stops reading, closes the A2A listener, lets
    accepted calls and a running dispatch finish, then saves state and releases the lock — also
    when recovery or the connection failed. The official client closes stdin first, then sends
    SIGTERM after 2 s. A FIFO/pipe stdin is read with an EOF-reporting reader (Node on macOS does
    not report EOF for a FIFO `process.stdin`).
  - Outbound items stay listed until acknowledged, so they survive disconnects and restarts
    (receivers treat redelivery as a duplicate).
- **Coding-agent configuration.** [`docs/mcp/coding-agent.mcp.json`](mcp/coding-agent.mcp.json)
  (absolute workspace path, no tokens); see runbook §4.

**`npm run pilot:mcp-integration`** (`reports/pilot-mcp-report.json`) runs four independently
initialised agents, each an MCP server in its own OS process with the real recorded SPARQ
module. One official-SDK client per server shuttles only the agents' own signed messages, with
no LLM or text generation. Checks:

- **M.1:** exact tool list.
- **M.2:** the MCP binding and the selected module are advertised, with no local path.
- **M.3:** single-writer refusal.
- **M.4–M.7:** the negotiation completes; one hold per side; every decision is by
  `sparq-policy@0.1.0` and permits; ledgers verify.
- **M.5:** mixed bindings in one conversation.
- **M.8:** replay is a duplicate.
- **M.9:** tampered → `bad-signature`; wrong audience → `wrong-audience`; oversized refused; no
  effects.
- **M.10:** the binary is replaced under a running server → status unavailable, the decision is
  indeterminate, no proposal is sent, and no path is exposed.
- **M.11:** graceful stop releases the lock and keeps state.
- **M.12:** after restart, state and replay protection persist.
- **M.13:** diagnostics on stderr only.

Carriage is **local and synthetic**: not Gmail, not a provider, and not independent-vendor
interoperability.

## 19. Durable enterprise actors: agent roles (SYNTHETIC mortgage slice)

An agent directory records a **role** at `init` (`--role`, stored in `identity.json`; default
`personal`). A role (`src/pilot/roles/`) only chooses which EXISTING domain handlers, effect
adapters and operator operations the one generic runtime hosts; verification, source authority,
policy (the recorded module, SPARQ by default), approvals, replay protection, effects and the
outbox are unchanged and identical for every role. Roles are not a workflow engine: each
operator operation starts or finishes one runtime step.

| Role | Identity (synthetic, fixed) | Local provisioning at `init` | Durable role state | Operator operations |
|---|---|---|---|---|
| `mortgage-consumer` | Sam | `--wallet FILE`: issuer-signed evidence about Sam only (validated) | `wallet.json` | `start_prequalification` (pinned lender only) |
| `mortgage-lender` | North Bank intake | `--issuers FILE`: issuer PUBLIC keys pinned locally + lender source-authority rules | `data-store.json` + `data-store-ledger.jsonl` (purpose-bound store and its own ledger); `mortgage-workflow.json` (once-only markers) | `internal_access`, `start_underwriting`, `send_decision_receipt` |
| `mortgage-underwriter` | synthetic underwriting service | underwriter source-authority rules | runtime state only | none (answers peers only) |

- **Separate directories, keys, trust, representations, mandates and roles.** Each actor is
  initialised independently (own owner and actor keys, own owner-signed mandate from the shared
  fixture factories in `src/pilot/fixtures/mortgage.ts`, own trust store). The in-process
  scenario (`scenarios/mortgage.ts`) uses the same fixtures — provisioning is shared, not
  duplicated.
- **Source-authority anchors are local.** The lender pins issuer keys from a file its operator
  supplies at provisioning (`synthetic-issuers` writes public keys only and discards the issuer
  private keys). Issuer metadata arriving with evidence, or over any channel, is never trusted
  by itself.
- **Provisioning is validated before anything is written** (role input files are parsed first;
  a failed `init` leaves no partial directory).
- **Owner approval.** The consumer's disclosure waits for an approval bound to the exact action.
  `awp-pilot sign-approval` signs it with the OWNER key in a separate process (no lock; works
  while the MCP server runs); `submit_approval` hands it to the runtime, which verifies it.
  The service never loads the owner key; with `init --owner-dir` it is not in the service
  directory at all, and `sign-approval --owner-dir DIR` reads it from there (tested: the
  consumer's pending-approval restart runs with no owner key in its directory; a key that is not
  the agent's published party key signs nothing; actor-key approvals are refused).
- **Purpose-bound enforcement point (lender).** Stored items carry the data-use grant derived
  from the agreed terms. `internal_access` decides internal delegation AND the consumer's grant
  (with the recorded policy module); assessment reads for credit checking are permitted,
  marketing (even relabelled) and onward distribution to a data broker are refused. The
  requesting internal "agent" is selected by a **trusted local operator** (a simulated internal
  role) — not an authenticated enterprise identity. Items are stored idempotently (same digest →
  no second write or log entry; different content or grant under an existing id → refused), and
  the store's ledger holds no payloads.
- **Store recovery (phase 7).** Commit order: the item file is replaced atomically, THEN the
  payload-free `data-stored` evidence is appended. An interruption between the two is repaired
  when the store opens (evidence appended, marked `recovered`) before the item can be used; an
  item without evidence is never served. A failed item write rolls back the in-memory item.
  Persisted items are validated on open (shape, ISO instants) and a malformed store fails closed
  (the agent does not open; the lock is released); an unparseable grant date is never treated as
  unexpired. Atomic rename without fsync is not a power-loss durability claim. Fault injection
  at both boundaries with restart: `src/pilot/purpose-store.test.ts`.
- **Retention (phase 7).** The lender operation `purge_expired` (operator-run, ≤100 items per
  call, not scheduled) erases the payloads of items whose grant expired: the store file is
  rewritten without them, a payload-free tombstone (id, claim type, source, grant id + policy
  digest, dates) is kept, and one payload-free `data-erased` record per item is logged. Access
  to an erased item is denied as erased; the same item is never stored again under the same
  grant (tombstone), and an old disclosure cannot resurrect it (its signed message has long
  expired; a replay is rejected). **Scope:** it erases this enforcement point's stored copy
  only. It does not reach the lender's runtime state and ledger (message digests, domain state
  with application terms and item ids, and — until compaction — outbox entries such as the
  underwriting proposal carrying attenuated values), the consumer's wallet, the underwriter's
  runtime copy of the attenuated fields, reports, filesystem remnants or backups. Expiry of a
  grant is not proof of full-system deletion; scheduling, secure erase and deletion across those
  stores are future work.
- **Underwriting under attenuated terms.** `start_underwriting` first asks the enforcement point
  to permit distribution to the pinned underwriter under the consumer's onward rule, then
  proposes only the attenuated fields (`annualGrossIncome`, `depositBalance`, `loanAmount`,
  `propertyPrice`).
- **Once-only operator steps with recoverable intent (phase 7).** Before the runtime call,
  `start_underwriting` records an intent naming the conversation id it passes to the runtime,
  and `send_decision_receipt` one naming the receipt activity `<application>#decision`; the
  confirmed result is written after. A retry after an interruption or exception reconciles from
  the runtime's own state: the conversation exists / the receipt is in the runtime's outbox →
  the step happened (confirmed, marked `recovered`, never repeated); it provably does not →
  the intent is cleared and the step runs. An exception alone never clears an intent (the
  runtime may have changed state). Phase-6 markers without a correlation id cannot be
  reconciled and stay refused with inspection instructions. Fault injection
  (`AWP_SYNTHETIC_FAULT=lender-{underwriting,decision}-after-{intent,commit}`) with restart at
  all four boundaries: `src/pilot/mortgage-durable.test.ts`.
- **Restart.** Accepted evidence, grants, pending approvals, conversation/effect state and replay
  protection are durable: restarting the consumer at the pending approval or the lender after
  storage changes nothing, and a replayed disclosure (over A2A or MCP) is a duplicate — no second
  storage, disclosure or effect, no grant change.
- **Governance.** Every new retained file is in the register (`mortgage-wallet`,
  `purpose-bound-store`, `mortgage-workflow`, `a2a-listener`, `a2a-peers`); `governance --name`
  exits 0 for every role directory in the workflow.
- **Not durable.** The valuation/fee branch (a synthetic payment instruction with unknown
  settlement) remains an in-process fixture demonstration; payment stays synthetic. Energy,
  health and industrial actors are durable roles since phase 8 (§23).

Tests: `src/pilot/mortgage-durable.test.ts` (in-process, direct carriage, restarts, separate
owner custody, actor-key approval refused, workflow fault injection, retention, governance
audit), `src/pilot/purpose-store.test.ts`; `npm run pilot:a2a-integration` Part B (separate
processes).

## 20. Optional local A2A binding (`a2a-data-part/0.2`)

`src/pilot/bindings/a2a.ts` uses the official **`@a2a-js/sdk` 1.2.1** (a2aproject/a2a-js,
Apache-2.0), which implements **A2A protocol 1.0**. Features used: the JSON-RPC protocol binding
(`jsonRpcHandler`, `agentCardHandler`, `DefaultRequestHandler`, `AgentExecutor`, `AgentEvent`;
client `ClientFactory` + `JsonRpcTransportFactory`), `SendMessage` (blocking), data `Part`s with
media types, a required agent extension declared via `A2A-Extensions`, and an HTTP bearer
security scheme in the Agent Card. Not used: streaming, push notifications, tasks, gRPC/REST
bindings, extended or signed Agent Cards, v0.3 compatibility.

- **Carriage.** One A2A `SendMessage` carries one signed envelope in a single data part
  (`application/vnd.awp.envelope+json`). The receiver hands it to the same `AgentHost.deliver`
  as MCP (`carrier a2a-data-part/0.2`), so the same verification, transitions and ledger records
  apply, and answers with one A2A Message carrying a **transport acknowledgement**
  (`application/vnd.awp.transport-ack+json`). No A2A Task is created.
- **Acknowledgement contract (0.2; 0.1 accepted any string).** The reply must be an agent
  Message (not a Task) whose id is `ack-<sha256(A2A message id)>`, with exactly one data part of
  the ack media type holding exactly the fields `transportMessageId` (= the A2A message id),
  `disposition`, optional `reason`, optional `messageId` (= the signed message id; required for
  `accepted`, `duplicate`, `pending-approval`) and `notice`. Dispositions form a closed
  vocabulary: business-level — the receiver's runtime processed it (`accepted`, `duplicate`,
  `rejected`, `pending-approval`); transport-level — `transport-refused` (not handed to the
  runtime: busy, shutting down, malformed carriage) and `indeterminate` (processing failed
  part-way; unknown). The sender maps: business-level → `sent` (a transport receipt; the peer's
  disposition is logged separately, so a business `rejected` is still delivered);
  `transport-refused`, connection refused, or the listener's pre-parse HTTP refusal
  (401/403/405/411/413/421) → `not-sent`; anything else — timeout, lost or malformed reply,
  wrong or missing ids, unknown disposition, extra parts, a task, `indeterminate` → `uncertain`.
- **Id and outcome mapping.** The A2A `messageId` is a transport id (deterministic per signed
  message, `awp-<sha256>`), recorded next to the profile message id; the A2A `contextId` is not
  a conversation id; the replay key is the signed envelope's own id. A transport
  acknowledgement — even `accepted` — is not an agreement, permission, approval or settlement.
- **Loopback only.** `a2a-config` binds the listener to `127.0.0.1` or `::1`; the Host header
  must name that literal address (DNS-rebinding guard); requests with an `Origin` header are
  refused (403).
- **Pinned peers, no discovery.** `a2a-pin` records `actor → loopback URL + access token` from a
  connection card exchanged out of band, only for an actor whose keys are already pinned; it
  never changes trust. URLs must be `http://127.0.0.1:PORT/a2a/jsonrpc` or `http://[::1]:…`
  (no names, TLS, credentials, query or other path). The client is built from a locally
  constructed card (no card fetch), requests go only to the pinned URL, and redirects are
  refused.
- **Local API access ≠ authority.** A 256-bit bearer token (`a2a.json`, 0600) admits a pinned
  peer to the listener (401 otherwise). It is not the principal's authority: every envelope is
  still verified; a peer with a valid token cannot make a tampered, misaddressed or replayed
  message count.
- **Bounds.** Request bodies ≤ 320 KiB (`Content-Length` required; 413/411), envelopes ≤ 256 KiB,
  responses read ≤ 64 KiB, 10 s client deadline, server header/request timeouts; only
  `SendMessage` is served (other methods → JSON-RPC -32601).
- **Dispatch through the transmission boundary (0.2).** `mcp --a2a` dispatches undelivered
  envelopes to pinned A2A peers — on the operator's `dispatch_outbound`, or automatically with
  `--a2a-auto-dispatch` — and EVERY attempt goes through `AgentRuntime.transmit` (§5): an
  authentic outbox entry, unexpired, the emission's action re-authorised now (mandate,
  persisted revocations, owner approvals, the pinned policy module), a durable `attempting`
  record before any byte leaves, and the outcome recorded against the envelope id, the A2A
  message id and the peer's ack id. A refusal sends nothing (tests count ZERO requests at the
  peer for a revoked or expired mandate, an expired owner approval, an expired message and a
  replaced policy binary). An `uncertain` message is retried only by an identical, re-authorised
  resend (the receiver deduplicates by signed id within the message's validity), never while a
  request of this process is pending, and stays `uncertain` if the resend is refused — absence
  of a reply is never taken as proof of non-delivery. Neither the host's nor the runtime's lock
  is held across network I/O, so two agents sending to each other at once cannot deadlock
  (tested). Order is kept per conversation: an unsent message holds the later messages of its
  conversation until the next dispatch. A message counts as handed off only when `transmit`
  reports `sent` (or `duplicate` of an earlier `sent`).
- **Agent Card** (`/.well-known/agent-card.json`): name, description, the loopback JSON-RPC
  interface (protocol 1.0), version, the required carriage extension (binding, profile version,
  actor, party, media types, size limit), the bearer scheme, one skill. No keys, tokens or local
  paths.

**`npm run pilot:a2a-integration -- --sparq-bin=PATH`** (`reports/pilot-a2a-report.json`), 19
checks, separate OS processes, real SPARQ, separate owner custody for every actor:

- **A.0** no service directory holds an owner private key; each is in the owner directory (0600).
- **A.1** pinning refuses non-loopback/named/TLS/other-path endpoints and endpoints of unpinned
  actors.
- **A.2** profile advertises the A2A binding, endpoint and exact SDK/protocol.
- **A.3** two personal agents complete a conversation with every hop over A2A; each send has a
  durable transmission record correlating envelope id, A2A id and the peer's ack id.
- **A.4** mixed bindings in one conversation (describe over MCP, the rest over A2A).
- **A.5** tampered → `bad-signature`; replay → `duplicate` (also across bindings via MCP); wrong
  audience → `wrong-audience`; no extra effect.
- **A.6** listener access: no/foreign token 401, oversized 413, browser Origin 403, only
  `SendMessage`.
- **A.7** Agent Card accurate and public.
- **A.9** send-time authorisation across processes: after alice's pinned SPARQ binary is
  replaced under her running server, her queued signed propose is refused at dispatch — no
  transmission record, nothing received by bob.
- **A.8** closing the MCP client stops the MCP+A2A server cleanly.
- **B.0–B.8** the durable mortgage slice (§19) across processes: role tool lists (incl.
  `purge_expired`); consumer restart at the pending approval with no owner key in its service
  directory; unsigned approval refused; signing needs the owner directory; out-of-process owner
  approval;
  lender restart after storage; replay (A2A and MCP) → duplicate, store and grants unchanged;
  purpose-bound permit/deny; attenuated underwriting once; final receipt once; every
  owner-mandate decision by `sparq-policy@…`; governance and ledgers verify after shutdown.

In-process (`src/pilot/a2a.test.ts`, 15 tests): zero-request denials (revoked mandate, expired
mandate, expired message, replaced policy binary, expired owner approval for the mortgage
disclosure); lost reply → `uncertain` → identical resend → `duplicate`, one business effect;
revocation while uncertain → refused, still `uncertain`, zero requests; connection refused →
`not-sent`; silent peer → `uncertain`; ten malformed/mismatched acknowledgements through a
rewriting proxy → `uncertain`, never retired; concurrent two-way sends without deadlock.

Carriage is **local and synthetic**, between processes running this code: not independent-vendor
A2A interoperability.

## 21. Recovery corrections (phase 8)

Three gaps from the phase-7 review were reproduced against the built code and fixed with small
changes to existing primitives (no transaction or workflow engine). Before/after evidence:
`../reports/phase8-recovery-before-after.json`, reproduced by `../reports/phase8-recovery-repro.mjs`.

### 21.1 A late refusal of an idempotent resend keeps the earlier uncertainty

`AgentRuntime.transmit` passes the attempt context (`number`, `resend`) to the late-settlement
path. A late outcome settles the record only if it belongs to the CURRENT attempt:

- accepted → `sent`;
- a refusal of a FIRST attempt → `not-sent` (Gmail semantics unchanged);
- a refusal of an idempotent RESEND → stays `uncertain` ("resend refused after the effect
  timeout; an earlier request remains unresolved"), because the earlier request may have been
  delivered;
- no outcome → `uncertain`.

Late outcomes of superseded attempts are only recorded (`transmission-late-response`). Tests
(`transmission.test.ts`):

- a late resend refusal stays uncertain, also across a restart;
- a late acceptance resolves as sent;
- a first-attempt late refusal is not-sent.

### 21.2 Purpose-store evidence is bound to the committed revision

Three distinct things are kept apart:

- **data identity** — the item id;
- **grant** — the data-use policy id;
- **storage event** — a **revision**, minted per commit.

`data-stored` / `data-erased` evidence carries the revision. Access is refused ("no storage
evidence for its current revision") until the evidence of the CURRENT revision exists, so a
re-granted item is never served on its earlier grant's evidence.

Pre-phase-8 records (no revision) are matched by `legacy:<id>|<grant>`.

**Identifier reuse:**

- While an item is stored, its id is unique:
  - the same content under the same grant is idempotent;
  - anything else is refused.
- After erasure, the id may be stored again ONLY under a grant id none of its earlier revisions
  had (a new agreement). This creates a new revision with its own evidence.
- A grant id that was erased once is refused for good.
- Tombstone history keeps every erased revision.

### 21.3 Committed erasure recovers its evidence

Evidence repair runs when the store opens and at the start of every purge. For a committed item
without `data-stored`, and for a tombstone without `data-erased`, it appends the missing record
(`recovered: true`).

`purge_expired` reports:

- `erased`;
- `evidencePending` — committed erasures whose evidence append failed now; they are repaired
  later;
- `repairedEvidence` — earlier interruptions repaired by this call;
- `remainingExpired`.

A failed store write rolls back only this call's tombstones. Fault points are `item-write`,
`after-item-commit`, `after-erasure-commit` and `erasure-evidence`. Tests are in
`purpose-store.test.ts`, "revision-bound evidence":

- re-grant crash;
- erasure crash and repair;
- report separation;
- failed purge write.

## 22. Anonymous public carriage (`public-http/0.1`)

The declared public configuration (`CONFIG_PUBLIC`) needs a carriage with NO principal. The A2A
listener requires a bearer token, and MCP is the operator's own interface. So
`src/pilot/bindings/public-http.ts` adds a small optional loopback carriage:

- **Messages.** The requester POSTs one UNSIGNED `awp-unsigned-json/0.1` request to
  `/awp/public`. The service's SIGNED response comes back in the HTTP reply. The requester
  verifies it with the service key it pinned.
  - No token, cookie, credential or sender identity exists.
  - The service records a `public-request` binding event with credential headers as presence
    flags only (never values).
  - The runtime still admits an unsigned request only for operations whose declared access is
    public, and only for kinds the public configuration allows.
- **Bounds.**
  - Loopback only (127.0.0.1/::1); the Host header must be that literal address.
  - `Origin` is refused (403). Signed or identified requests are refused (400).
  - Body ≤ 64 KiB (`Content-Length` required; 411/413). Response read ≤ 256 KiB.
  - ≤ 8 requests in progress (503). 10 s deadline.
- **Transmission.** Every message leaves through `AgentRuntime.transmit` on both sides.
  - The requester maps connection refused and 400/403/404/411/413/421/503 to `not-sent`, and
    anything else to `uncertain`.
  - A response counts as handed off once it is written to the open connection.
- **Reply recovery (phase 9).** A received reply is kept durably until it has been processed.
  - **Retain first.** The requester writes the bounded signed reply to `public-replies.json`
    before the request's transmission counts as `sent`. The reply stays there until the
    runtime has processed every response in it and the request is retired, in that order.
  - **Interruption.** An interruption anywhere after receipt is recovered at the next start or
    dispatch. The retained reply is processed through the same runtime, idempotently:
    reprocessing is a runtime `duplicate`. The retailer is not called again.
  - **Bounds.** At most 64 reply sets of ≤ 256 KiB each are retained. New requests are held,
    not sent, while the spool is full. Malformed spool contents fail closed.
  - **Lost or malformed reply.** The request stays `uncertain`. It is resolved only by
    re-sending the IDENTICAL unsigned request (same message id), at most 5 attempts.
    - This is allowed only for anonymous public requests: the profile is public read-only, and
      the service deduplicates by message id.
    - The service answers a duplicate with the SAME signed responses. It now returns
      already-transmitted replies on the duplicate path instead of an empty reply.
    - Nothing consequential is re-sent.
  - **Pre-spool records.** A request recorded `sent` without a retained reply (possible only
    for pre-phase-9 records) is not re-sent. Start a new request round.
  - **Distinct records.**
    - Transport completion: the transmission record plus `public-reply-received`, with bytes.
    - Response validation: the runtime's disposition per signed response,
      `public-reply-processed`.
    - Domain completion: the conversation phase and the comparison.
  - Fault points `after-receipt` and `after-processing` exist for tests;
    `AWP_SYNTHETIC_FAULT=public-kill-<point>` kills the process there.
  - Tests: `src/pilot/public-reply.test.ts` and regional check E.8 (a comparator process
    killed after receipt).
- **Operator steps.**
  - `public-config --name N --port P [--out FILE]` writes the endpoint card
    (`awp-public-endpoint`).
  - `public-pin --name N --connection FILE` pins it, only for an actor whose keys are already
    pinned.
  - `mcp --public [--auto-dispatch]` runs the listener; `dispatch_outbound` returns the public
    results under `public`.

## 23. Durable regional roles (phase 8, SYNTHETIC)

The same runtime and role composition as §19. Each role composes the EXISTING domain handlers
(`domains/energy.ts`, `fhir.ts`, `industrial.ts`). Identities, mandates, representation scopes,
source rules and synthetic issuance are shared with the in-process scenarios through
`src/pilot/fixtures/{energy,health,industrial}.ts`. Handler working state is kept in the
runtime's own persisted domain state through `roles/durable.ts`. That wrapper restores state
before EVERY stateful callback, from the conversation's operation scope, and snapshots it after.
A replay never reaches a handler twice. Interrupted processing is NOT atomic across effects;
see §24.2 for the exact semantics.

| Region | Roles (`roles` lists them) | Carriage | Role-owned files |
|---|---|---|---|
| AU energy (UC-03) | `energy-retailer` (identity given at init; `--role-input plans=`), `energy-comparator` (fixed identity; `--role-input profile=`) | `public-http/0.1` (anonymous) | `energy-plans.json`; `energy-household.json` (comparator only), `energy-rounds.json`, `energy-comparisons.json` |
| US health (UC-04) | `health-patient` (identity at init; `patient-id=`), `health-authorization` (own token-issuer key; `enrollments=`), `health-resource` (identity at init; `resources=`, `issuers=`) | A2A | `revocations.json`, `patient-enrollments.json`, `health-patient.json`, `fhir-resources.json`, `health-summaries.json`, `keys/issuer.private.jwk.json` |
| EU industrial (UC-05) | `industrial-planner`, `industrial-authority` (own authorisation-issuer key), `industrial-provider` (identity at init; `issuers=`, `model=current\|old`), `industrial-contracting` (`membership=`), `industrial-diagnostic` | A2A | `industrial-work-orders.json`, `industrial-provider.json`, `industrial-membership.json`, `nordwerk-data-store.json` + ledger, `keys/issuer.private.jwk.json` |

### Custody and authority

- **Organisation owner keys.** `init --owner-dir DIR --owner-name ORG` creates the organisation's
  owner key once, in `DIR/ORG/`, and reuses it (never overwrites it) for that organisation's
  other agents:
  - Cedar Valley: auth, FHIR and archive;
  - Alpine: planner and authority;
  - Orbis: current and legacy endpoints;
  - NordWerk: contracting and diagnostic.

  Every agent has its OWN actor key, mandate and representation statement. No service
  directory holds an owner key.
- **Issuing keys.** Roles that issue statements hold a THIRD key: the health token issuer and
  Alpine's authorisation issuer. It is generated at `init` into the service directory (0600).
  Peers pin its public card (`issuer-card`) at THEIR provisioning, as a local source anchor.
  Token issuance is therefore separate from owner approval and from source authority.
- **Owner statements.** The patient's authorisation and grant revocation are signed by the
  OWNER outside the service, with `owner-sign --kind … --args JSON --owner-dir DIR`. Only kinds
  the role declares, with validated narrow arguments, can be signed. A statement signed with
  the actor key is refused.
- **No authority inferred from membership.**
  - The programme credential identifies a participant only.
  - NordWerk's diagnostic agent has a deliberately over-broad LOCAL mandate but is NOT in
    NordWerk's signed representation scope for contracting, so Orbis refuses it (I.4).
- **Peer identity.** NordWerk's internal dataset read (`internal-dataset-read`) takes the
  requesting agent from the VERIFIED message signer, and no agent parameter exists. This
  differs from the mortgage lender's `internal_access`, which remains a trusted-operator role
  selector (§19).

### What each region demonstrates (regional report ids)

- **Energy.**
  - Anonymous requests: no credential headers or sender at the retailer boundary (E.4).
  - Carriage limits (E.5).
  - Deterministic, cited estimates equal to the in-process scenario (E.2).
  - Incompatible model and represented-only endpoints isolated (E.3).
  - Restart preserves the comparison and its provenance (E.6).
  - A comparator process killed after receiving a reply loses nothing; there is no re-request
    (E.8).
  - Household marker, usage and identity never reach a retailer directory (E.7).
- **Health (two synthetic patients, Maya and Noah).**
  - Issuance authority (H.2):
    - authentic consents for the OTHER patient's compartment are refused against the clinic's
      enrollment register;
    - each patient's own consent is granted requested ∩ approved ∩ supported.
  - Observation, another patient's compartment and wrong audience are refused, and appear in
    the resource services' own audit (H.3).
  - No write operation exists (H.1).
  - Cited, minimised summary with unresolved contradictions (H.4).
  - Revocation needs grant ownership, and queued disclosures are withheld (H.5):
    - another patient's authentic revocation is refused;
    - the patient's own revocation is accepted;
    - a searchset QUEUED under the grant is refused at dispatch, live and after a process
      restart, and zero messages reach the patient agent.
  - After the restart the revoked grant is refused and the other patient's grant is untouched
    (H.6).
  - Patient-agent restart (H.7).
  - No clinical payload in the resource audit; revocations are persisted with their ownership
    facts (H.8).
- **Industrial.**
  - Delegation bounded by the authority's mandate; `requestedBy` is verified (I.2).
  - Incompatible model isolated (I.3).
  - Membership is not authority (I.4).
  - Purpose refused (I.5).
  - No transfer before agreement, at the holder boundary and locally (I.6).
  - Exact agreement (I.7).
  - One transfer, stored under the derived policy (I.8).
  - Restart plus replay gives no second transfer (I.9).
  - Verified internal read (I.10).
  - Accepted recommendation gives ONE work order; restart plus replay gives no second order;
    simulated performance is recorded once (I.11).
  - Agreement, transfer and performance are distinct events (I.12).

### Labels

- **Tested / local:** separate processes on one host, loopback only, real SPARQ decisions.
- **Synthetic:** every organisation, person, tariff, clinical record, telemetry sample and
  outcome.
- **Not claimed:**
  - CDS/CDR conformance;
  - SMART-on-FHIR/OAuth 2.0 interoperability;
  - HIPAA or clinical compliance or advice;
  - Catena-X/DSP certification or connectors;
  - Data Act legal eligibility;
  - independent-vendor interoperability.
- **Provider-setup-required:** real retailers, clinics, FHIR or authorisation servers,
  data-space connectors, hosted deployment.

### Known limits

- The NordWerk store has no purge operation (retention by expiry only).
- Industrial work orders and energy comparison history have unbounded retention (register
  GAP).
- Revocation is accepted per enforcing server by an operator operation; there is no
  propagation protocol. A server that has not yet accepted it keeps honouring the grant, and
  releasing queued searchsets under it, until the grant expires.
- The clinic enrollment register is local provisioned configuration. There is no
  identity-proofing, no registration protocol and no update operation; a change means
  re-provisioning.
- The service side of the public carriage does not observe a dropped response connection. The
  requester's recovery covers loss AFTER receipt (§22).
- Agreements are honoured only inside the agreement's own conversation: a transfer requested in
  a separate conversation finds no agreement, because provider state is scoped by the
  conversation's operation.

### Concepts the specification does not yet name (found while building §21–§23)

These are recorded for the specification authors; the abstract specification is not changed
here. Each one is handled locally by a pilot convention.

| Concept | Pilot convention |
|---|---|
| **Organisation signing key shared by several agents.** The framework separates party, actor and operator, but not *who inside an organisation* holds the key that signs mandates and representation. | One owner key per organisation (`--owner-name`), with no signing ceremony, threshold or rotation. |
| **Issuing function of a service.** A key that issues statements (tokens, authorisations) for an organisation is neither the party key nor the actor key. There is no statement binding an issuing key to its organisation. | Peers pin the issuer card out of band. |
| **Storage revision vs data identity vs grant.** The requirement to distinguish data identity from grant does not name the *storage event*. | The revision (§21.2). |
| **Attempt identity in transmission.** Outcomes belong to one attempt of a message. A late outcome of a superseded attempt must not settle the message. | §21.1. |
| **Hand-over of a third-party authorisation between organisations.** There is no message pattern for the user organisation to deliver an authorisation to the recipient organisation. | An operator hand-over (`export_authorisation` → `negotiate_offer`). |
| **Revocation distribution.** One party's revocation must reach every enforcing service of another organisation. | Accepted per server by an operator operation. |
| **Agreement reference across conversations.** Performance under an agreement is bound to the agreement's conversation. There is no concept for invoking it from another conversation. | Not supported. |
| **Fulfilment attestation.** Performance is an observation. The framework distinguishes agreement, action and performance, but not *who attests* performance or with what evidence. | A simulated planner-side observation. |
| **Non-identifying abuse controls for public access.** Quotas that do not identify the requester. | Only per-process concurrency bounds. |
| **Principal-to-subject binding at a data holder.** A consent's signer is authenticated, but which local record subject (compartment) that principal may authorise is a fact only the holder can assert. | A clinic-provisioned enrollment register (phase 9). |
| **Authorisation basis of a queued disclosure.** A decision taken when a reply is prepared must hold when it is sent. The framework separates decision and action, but has no term for the durable condition carried between them. | Typed disclosure conditions re-checked at transmission (§24). |

Tests:

- `src/pilot/{energy,health,industrial}-durable.test.ts` (in-process, restarts);
- `node scripts/pilot-regional-integration.mjs --sparq-bin=PATH [--only=E,H,I]` (separate
  processes → `reports/pilot-regional-report.json`).

## 24. Authorisation boundaries and send-time conditions (phase 9)

Before/after evidence for the five phase-8 review findings is in
`../reports/phase9-before-after.json`, reproduced by `../reports/phase9-authz-repro.mjs` and
`../reports/phase9-public-reply-repro.mjs`. Both scripts are run from `personal-agent/` against
`dist/`.

### 24.1 Health issuance and revocation (health operations version 0.2)

- **A signature proves who consented, not entitlement.** `AuthorisationServerHandler` issues a
  grant only if ALL of the following hold:
  1. The consent (`PatientAuthorisation`) verifies against the PINNED key of the patient it
     names.
  2. The requester is that patient's agent: the represented party, client actor and signing
     key all match.
  3. `audience` is THIS service's own receiving identifier (its actor IRI).
  4. `purpose` equals the requested purpose, and the service offers that purpose.
  5. The consent is currently valid:
     - `issuedAt` is not in the future beyond the profile's 5-minute clock skew
       (`not-yet-valid`);
     - `validUntil` has not passed (`grant-expired`);
     - the window is well-formed and at most 24 h.
  6. The **clinic's enrollment register** binds that authenticated principal to exactly the
     requested compartment. An unknown principal, or a mismatched compartment, is refused.
- **The register.** It lives in `patient-enrollments.json` and is provisioned by the clinic
  operator (`--role-input enrollments=FILE`). A register that binds a principal or compartment
  twice is refused. Without one, nothing is issued.
- **The grant.** It expires at the EARLIEST of session end and consent end. It names the
  patient principal, the compartment, the consent id and the purpose. Requested, approved and
  granted scopes stay in the `scope-decision` record; every refusal is a `consent-decision`
  record.
- **Revocation.** A `GrantRevocation` carries the issuer-signed grant (`grantStatement`). Each
  enforcing server accepts it only if:
  - the revocation verifies against the pinned key of the patient it names;
  - the grant verifies against the pinned token-issuer key;
  - the grant is the one named;
  - the grant's `patient` is the signer.

  An operator accepting a statement confers nothing. The accepted revocation is persisted
  with those facts (`revocations.json` version 2) and survives restarts. The authorisation
  service pins its OWN issuer public key at init to verify grants it issued. Owner, actor and
  issuing keys stay separate. The patient agent's read-only `current_grant` shows the grant to
  carry into `owner-sign --kind grant-revocation`.
- **Two synthetic patients.** Maya and Noah, each with their own agent and owner key, cover:
  - cross-patient issuance and revocation;
  - Noah's records never reaching Maya.

  An un-enrolled patient (Zoe) is refused. Tests are in `src/pilot/health-durable.test.ts`;
  regional H.2–H.8 repeat this across processes.
- **Not** SMART-on-FHIR/OAuth. No identity proofing is modelled.

### 24.2 Protected disclosures: authorisation basis re-checked at transmission

- **Mechanism.**
  - A handler's `deliver` may carry `conditions`: typed, payload-free, durable references to
    its authorisation basis (`DisclosureCondition {kind, ref}`).
  - The runtime stores them with the outbox entry and records them (payload-free) on the
    `message-out` record.
  - At EVERY transmission (`AgentRuntime.transmit`: A2A, public carriage, Gmail adapter, also
    after a restart) the checker the hosting role registered for `kind` re-decides the
    condition before any byte leaves:
    - a failure → `refused: condition-failed` (a `disclosure-condition` record); no attempt is
      written ahead and zero requests reach the recipient;
    - an unknown kind or a checker error fails closed.
- **Checkers.**
  - Checkers are PURE: they may record decision evidence but create no effects. A handler is
    never re-run.
  - The owner-mandate intent check still runs for messages with an intent; the checks are
    additive.
  - The mechanism is generic: no health or industrial code exists in the bindings.
- **Local renderings.** `list_outbound` and spool files omit the envelope of a protected item
  whose condition fails now (`status: blocked`, `withheld: <reason>`).
- **Limitation.** An envelope the operator obtained BEFORE a revocation and carries by hand, and
  the in-process direct test bus, are outside the transmission boundary.

| Concrete profile | Public metadata (no condition) | Protected payload (condition) | Checker |
|---|---|---|---|
| Health resource service | description, refusals (reason codes only) | FHIR searchset (`deliver`) | `condition/access-grant`: grant not revoked in this server's persisted list, not expired |
| NordWerk contracting (internal) | description, refusals | released dataset samples (`deliver` of `internal-dataset-read`) | `condition/purpose-store-release`: the SAME enforcement point re-decides internal delegation, grant validity, current item revision and the data-use policy through its policy module (SPARQ when selected), recorded as `access-recheck` |
| Energy retailer | the public plan list and description | — | — (public by declaration) |

Tests are in `src/pilot/protected-disclosure.test.ts`. Each case queues a reply, then:

- the patient revokes (health);
- the grant expires because the consent is shorter than the session (health);
- the store grant expires (industrial);
- the pinned SPARQ module is replaced (industrial).

Dispatch then leaves zero requests and zero bytes at the recipient, live and after restart.
Regional H.5 repeats the revocation case across processes.

### 24.3 Interruption semantics (what actually holds)

There is no whole-message transaction.

- **Nothing persisted during processing.** A crash loses the processing and its state change
  together, and a redelivery is processed afresh.
- **Processing that runs an effect.** It persists a WRITE-AHEAD snapshot first. After that the
  message is `interrupted`: never re-dispatched (a redelivery is a `duplicate`). `recover()`
  completes only the RECORDED effects (reconciled) and owed receipts. Handler steps after the
  snapshot that were not recorded are not re-run, and the `recovery` record shows the
  interrupted message.
- **Multi-step side effects** are recoverable step by step, through write-ahead and
  reconciliation; they are not atomic.
- **Received public replies** are retained before they count as sent (§22).
