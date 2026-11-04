---
name: agent-sandbox
description: Use when gating AI agent tool calls, agent-written code or MCP tools with ODRL global rules, data-attached policies and send/spend limits via @jeswr/agent-sandbox, or when changing the IDEA sandbox demo world.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/agent-sandbox

Read README.md before changing this security-critical package. The gate is in src/gate.ts,
limits in src/limits.ts, the hash-chained record in src/record.ts, and plain-English rule text
in src/policy-text.ts (the UI shows this text, so it must stay generated from the same policy
the gate enforces).

Rules for changes:

- Fail closed. A missing operand, an unknown tool, an unparseable judge answer or a throwing
  `context(args)` refuses the call. Unlisted calls stop unless `unlisted: "review"`.
- A model may only make an answer stricter. Never let `llm` or `hybrid` permit what `policy`
  stops.
- Tool specs are trusted and arguments are not. Derive recipients, amounts, regions and
  purposes in `context(args)`, never from free text the agent chose.
- Read permissions in data policies use `read`, not `use`: in solid-odrl `use` also covers
  `distribute`, which would let a read permission authorise sending.
- An approved call is checked again before it runs, and refused if what it would do changed since it was held; keep both.
- New scenarios go in src/world/scenarios.ts with an expectation per step, and must pass in
  `test/stories.test.ts` under policy and hybrid modes.

- Automation rules (src/automation.ts) are data checked by `validateRule`; their policy is
  built from the closed vocabulary in `RulePolicy`, never from free ODRL a model wrote. A rule's
  mandate goes in `GlobalRules.also`, which may only narrow the organisation's rules.
- The mortgage world (src/world/mortgage.ts) gives each agent its own sandbox and mandate;
  data labels carry the data owner's policy across organisations. Its steps are pinned in
  `test/mortgage.test.ts`.

Run `pnpm turbo run test --filter=@jeswr/agent-sandbox` (coverage thresholds are per file).
The app that shows this package to non-technical visitors is apps/idea-sandbox.
