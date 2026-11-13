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

Experimental. Synthetic parties and data only; both sides of every exchange run this code.
