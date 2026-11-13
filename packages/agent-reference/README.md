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
  ask the principal, or stop. The runtime calls them where the pilot already decided, so
  `@jeswr/personal-agent` behaves as before when no `gates` option is given.
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
