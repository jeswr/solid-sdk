<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/agent-reference

The reference agent runtime of the accountable agent architecture. It is the September
pilot runtime, lifted out of `@jeswr/personal-agent/pilot` without changes:

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
run departs from them. After an intended change, run `node scripts/update-outlines.mjs`
and review the diff.

Trace format extensions beyond the brief: `outcome` on decision events, `resolution` on
trust lookups, `fact` on memory events, and gate codes (`not-in-configuration`,
`no-claims`, `no-action-intent`, `conversation-bound`, `not-yet-agreed`,
`no-register-for-party`, `no-personal-data`) as the reason of `not-applicable` verdicts.

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
unsupported suites, legacy DER declarations and standing rules instead of substituting another check.
Thirteen paths run from data: `probing-counterparty`, `master-data-change`, `pay-an-invoice`,
`false-but-signed` and `flat-share`, including every branch of those cases. The other
18 paths retain explicit blockers, including all five mortgage migrations. A blocked path
is not counted as a run, regardless of whether it has a saved outline. Existing mortgage
drivers remain pending migration.

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
coverage, interpretations and the unfinished mortgage migration.

Anonymous public queries additionally exclude open numeric/date slots and core-selected
conversation IDs. A caller that needs variable personal parameters uses a represented,
authorized action. Existing snapshots without the generated-conversation marker fail
closed for new anonymous continuations rather than treating a remembered identifier as
proof that its original selection was safe.
