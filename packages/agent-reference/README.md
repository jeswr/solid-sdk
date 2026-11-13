<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-reference

Brief 22 R1 is **partly implemented**. The published RDF model is in `vocab/`;
`@jeswr/agent-reference/wire` provides pinned JSON-LD reading, SHACL validation,
stable writing, JCS/JWS and RDFC/Data Integrity primitives, and
`@jeswr/agent-reference/model` provides RDF views and the generated GrantRecord.
The running reference gates still use the legacy object pipeline. The
`check:rdf-pipeline` command reports that remaining migration and fails; no Data
Integrity scenario configuration is advertised as implemented. See
[the Brief 22 report](ENGINE-REPORT.md#brief-22) for exact boundaries and validation.

The reference agent runtime of the accountable agent architecture. It began as the September
pilot runtime lifted from `@jeswr/personal-agent/pilot`, and now executes profile/scenario
data through the same checked runtime:

- `core/` — the transport-neutral message model, conversation state machine, limits, schema
- `mechanisms/` — JWS signing, pinned trust store, owner mandates over an ODRL subset,
  signed statements, policy engines
- `profile/` — configurations, implementation descriptions, vocabulary
- `runtime/` — the agent runtime (inbound pipeline, executor, transmission, retention)
- `store/` — state stores and the hash-chained ledger
- `bindings/direct` — the in-process direct binding
- `domains/`, `fixtures/`, `scenarios/` — the synthetic mortgage flow and what it needs
  (purpose-bound store, scheduling payment operation, mandates)

`@jeswr/personal-agent/pilot` re-exports every moved module from its old path, so existing
callers and tests are unchanged. Each module is reachable by path, for example
`@jeswr/agent-reference/runtime/agent`.

## Gates, suites and traces

- `suites/` — `SuiteRegistry`: one interface per layer (ids from the explorer model),
  `Configuration` (one suite per layer) with `check()`, and `baselineRegistry()` holding the
  baseline suites and the `BASELINE` configuration. A message declares exactly one
  configuration; `settle()` matches configurations whole, never layer by layer.
- `gates/inbound` — `InboundGate` and `Admission`: integrity, source, authority, terms,
  fitness, then admit or refuse. `gates/outbound` — `OutboundGate.release()`: mandate,
  recipient, disclosure, data terms, limits and approval, then `seal()` for evidence; go,
  ask the principal, or stop. The runtime calls them before release, including protocol messages. Unknown text and
  untyped commitment content now fail conservatively even without trace collection.
- `trust/resolver` — `TrustResolver`: own list, then a root, then the register it delegates
  to; every answer carries its path.
- `trace/` — the `agent-trace/0.1` types, `TraceRecorder`, packet views and `outlineOf()`.
- `reference/` — reproducible runs (fixed test keys, deterministic ids, fixed clock,
  scripted core) of the mortgage flow and its branches.

`pnpm run build` writes every trace to `traces/<scenario>--<configuration>.json` (plus
`traces/index.json`). Expected outlines are committed in `outlines/`; a test fails when a
run departs from them. After an intended change, use `pnpm run scenarios --record-outlines`
and review the diff. The five maintained mortgage outlines retain their original array format.

Traces carry outcomes, trust-resolution paths, labelled facts and declared stand-ins. New
cases use the core reason registry; the public pilot extension-code union remains available
for compatibility. A signature establishes attribution, not truth or permission.

Experimental. Synthetic parties and data only; both sides of every exchange run this code.

<!-- AUTHORED-BY Codex GPT-6 -->

The data engine loads `profiles/<id>.json` (`agent-profile/0.1`) and
`scenarios/<id>.json` (`agent-scenario/0.1`). Their JSON Schemas are in `schemas/`;
the runtime validators and published schemas come from the same Zod definitions.
Data imports include the `.json` suffix, for example
`@jeswr/agent-reference/scenarios/probing-counterparty.json` and
`@jeswr/agent-reference/profiles/mortgage.json`. The data export patterns are
`./scenarios/*.json`, `./profiles/*.json`, `./schemas/*.json` and `./outlines/*.json`;
code such as `@jeswr/agent-reference/scenarios/common` resolves to the built module.
`runScenario()` runs the main path and each branch in a fresh synthetic world,
using real runtimes, signatures and gates. It checks branch outcomes and outlines.
`pnpm run scenarios` writes runnable traces and `scenario-runs.json`, which also
names every blocked path and its reason. `--record-outlines` explicitly records
new expectations for review; ordinary runs fail on drift.

Scripts use literal JSON and whole-value references such as
`{ "$ref": "steps.request.conversation" }`. They can start exchanges, route
messages, propose replies or synthetic effects, answer approval requests, introduce
hostile mutations, record readings and check records. They cannot write gate events.
Branch `change` objects merge into the scenario; arrays replace. The engine rejects
unsupported suites and legacy DER declarations instead of substituting another check.
Thirty-one paths run from data, including every branch of the first ten catalogue cases
and all five mortgage references. Only the separately named hidden-validity proof remains
blocked: ordinary selective disclosure cannot prove a predicate about a concealed date.
The mortgage reference entry points load the data engine; their complete maintained
outlines are unchanged. Public mortgage operation handlers remain available and supply
the closed checked implementations installed by the scenarios.

Free text is detected recursively through the vocabulary's types and closed values.
Unknown strings remain text, wherever they occur. Vocabulary paths use `*` for one
member or index and `~1` for a literal dot in a key. Optional `claimType` labels
identify data required by a purpose. Each task keeps the items its core actually
sees, including memory reads and principal instructions; callers should declare
`gates.taskId` when several conversations belong to one task. Unscoped fetched
items conservatively affect every task. Text that fails the context rule is held
before the outbox and requires a single-use approval of its exact message digest,
when the signed mandate permits asking. `recordReading()` requires a declared core
and records its signed implementation statement, original digest and model authorship.

<!-- AUTHORED-BY Codex GPT-6 -->
Installed handlers may supply a `contentProfile` with explicit vocabulary, purposes,
known identifiers and reliance rules. The runtime snapshots it before calling the core.
An identifier declaration accepts only identifiers already in the installed profile,
verified conversation history, task context or runtime mint registry. An arbitrary IRI
remains free text. `mintIdentifier()` and a handler's `identifierFor()` register their
results; principal instructions may include structured task data in `instruct(text, data)`.
A protected compound term needs an installed signature verifier, strict schema and
vocabulary for its claims; a signature alone does not type prose or grant authority.

<!-- AUTHORED-BY Codex GPT-6 -->

Brief 11 adds closed derived-data templates in `src/derive/rules.ts`: `sum`, `count`,
`min`, `max`, `annualise-consecutive-months`, `ratio`, `threshold`, `all-of` and `any-of`.
The schema publishes their parameter shapes. Inputs use admitted claim types (numeric or
boolean `value`, or a monthly series); `field` selects a series measure such as `gross`.
Aggregates require a signed completeness claim naming `forClaim`, `complete: true` and
an exact `period`. Source aliases come from profile `sources`. Rules can name another
rule's output; cycles fail at load, and derivations have a maximum depth of three.
`derive()` supplies only the rule, subject, purpose and assurance: the runtime selects
inputs from its own task memory. `by-source` additionally requires a host-installed
`sourceKey` pinned to the source party, and every input must be that source's own claim.
`proved`, `joint` and `attested` scenario assurances remain blocked.

Profiles can declare agreement-bound `assessments`, `personDecisions`, claim-level
`corroboration`, and own-list-only `trust`. Assessment discard removes payloads and accepted
support while retaining context tombstones and restrictions; retained outputs keep their
terms. Signed mandate permission rules may add `approvals` and payment `limit` objects.
Role statements use `organization.role`, `subjectKey`, `organization`, `role`, validity
and `status`. Organization approvals are exact-action signatures by independently pinned
staff keys, counted against admitted directory roles. Requester identity is supplied by
the authenticated task host or verified conversation, never by a core-chosen parameter.

Payments use action `pay` with structured payee, amount, currency, reference and optional
account. Account instructions need an admitted `payee-account` binding and sharing terms.
The actual instruction and adapter parameters must equal the authorized payment. The
runtime reserves integer minor-unit totals in its atomic state snapshot before release.
The payment, corroboration and pinned-list cases use distinct, signed local configuration
identifiers. Their filename suffix `--baseline.json` is retained for artifact compatibility;
the trace header and index name the actual configuration. These are fictional local
implementations; the bank records submission, without claiming settlement.

Scenario steps also support `derive`, `assess`, `organisation-approve`, `trust-decision`
and data assertions. A branch can supply `profileChange` to vary receiver policy. An
assertion inspects runtime results; it cannot supply a gate verdict. Profile `standIns`
lists local replacements and is copied to the trace header. See `ENGINE-REPORT.md` for
coverage, interpretations, exact-outline comparisons and the intentionally blocked proof.

Anonymous public queries additionally exclude open numeric/date slots and core-selected
conversation IDs. A caller that needs variable personal parameters uses a represented,
authorized action. Existing snapshots without the generated-conversation marker fail
closed for new anonymous continuations rather than treating a remembered identifier as
proof that its original selection was safe.


<!-- AUTHORED-BY Codex GPT-6 -->
Brief 12 adds the following bounded capabilities without new dependencies:

- Signed messages may contain text or raw-byte `content` parts with IDs, media types and raw-byte
  digests. They enter context as unstructured data, never instructions. `readContent()`
  supplies one immutable part to a host-installed reader without runtime capabilities and
  keeps only the types/closed values declared by profile `readings`. Readings retain
  `model-output`, the reader's signed implementation and the original digest. Required
  action claims supported only by unaccepted readings ask their provenance source for
  structured form. Inherited terms and principal-facing reading labels remain mandatory.
- A signed mandate's `standing` rules can allow an emergency read of named items for a
  current, register-attested clinician with a signed emergency declaration. The declaration
  is a self-report. The actual authenticated request and output must match the named scope.
  Each release creates durable principal/contact notification duties; the runtime discharges
  them through signed, gated messages and records missed deadlines, including after restart.
- `LocalResourceHolder` implements reader/item/purpose/expiry-bound signed grants and
  authenticated, recorded reads. The receiver admits holder-signed statements under both
  grant and original terms. Sending a reference discloses every item its grant names.
  Health-referral uses `by-reference-local-holder`, explicitly replacing the catalogue's
  Solid store; it implements no Solid access-control protocol.
- Organization policies install a document resolver, registrar, required operation roles,
  action kinds, required-status claim types and maximum status age. Current registrar-signed
  documents restrict introduced organization/agent keys. Organization-signed mandate
  credentials and issuer-signed status lists establish current scoped authority. Supplier
  onboarding uses a local resolver, with no live DID-method claim.
- `issueSelectiveCredential()` signs salted claim digests using existing JWS/SHA-256.
  `presentSelective()` reveals selected disclosures; integrity, source, fitness and outbound
  disclosure checks inspect those actual claims. API salts use cryptographic randomness;
  reproducible fictional fixtures use fixed salts. No hidden-value proof or unlinkability
  is claimed.

Mortgage data additionally installs closed handlers and purpose-bound stores and can
perform challenge retries, source issuance, agreement invocations, store requests,
profile-bound assessments and consent-bound underwriting handovers. The underwriting
release checks the real consumer agreement, exact onward fields and current store item
revisions; transmission rechecks its protected outbox condition. Assessments record an
output receipt and input digests without retaining an extra assessment copy of the inputs.
The shared source store continues to enforce its separate agreed retention/grants.

<!-- AUTHORED-BY Codex GPT-6 -->
Brief 14 makes `actionClaims` apply to inbound operations as well as outbound actions:
use an operation IRI in `action` for an inbound requirement, or an action name such as
`read` for an outbound requirement. Fetched-statement `admit` steps may name their
`operation`. A required claim rejected for a curable source or fitness failure produces
`ask-more` with a gate-built replacement-evidence challenge. The statement stays out of
facts and core context; later dependent actions retain its rejection reason. Unknown
terms, including unmatched prohibitions and duties, never count as permission.
Actor-keyed profile `termsAcceptance` entries list the purposes a principal accepts in
an incoming request's offered `input.terms`.

A profile can name self-statement kinds in `personMayRelyOn` for a person's exact-action
reliance decision. The gate holds the unadmitted statement separately, shows its author
and the absence of anyone vouching for it, and asks at limits-and-approval with
`method-not-accepted`. A yes binds both the action and statement digests and is consumed
once. Payment and unrestricted disclosure dependencies fail at load. Catalogue
comparison uses the first non-pass/admit/go decision, equates inbound `refuse` with
catalogue `stop`, and keeps later decisions in manifest `consequences`.
