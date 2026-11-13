---
name: agent-browser
description: Use when implementing or consuming @jeswr/agent-browser, its RDF-only planner protocol, approval loop, CLI planners, host-side password login, trace format or fictional shop demo.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-browser

Read README.md and the site-model, site-executor and site-profiler package skills first.
The shared contract belongs to site-model; keep adaptations local to this package.

- Keep planner input to the goal, rendered catalogue, optional persona and bounded RDF
  history. Never include HTML, response headers, login operations' credentials, cookies,
  tokens, model request templates or arbitrary external URLs in prompts.
- Preserve untrusted nodes when sanitising/truncating RDF. Build Turtle with n3.Writer.
  The standard schema/xsd/rdf/sab prefixes may be omitted by planners and supplied locally.
- `runTask` reuses the exact parsed action and executor-issued approval id after consent.
  Denial sends no second execution. A limit covers only this request's amount in its
  displayed currency; it must never establish unbounded or cross-currency consent.
- Handle every per-write approval and price-change reapproval in the same action, bounded by
  `maxApprovals` (default 25). Record all prompts in `TraceStep.approvals`; `approval` is the latest.
  Payment summaries must contain the site's real amount (the shop asserts "GBP 20.00"). Money
  comes from executor-verified wire mappings or trusted, on-origin reads earlier in the same
  flow: fresh basket/order totals first, otherwise the matching product price times bound
  quantity. The planner's price is a cap/cross-check, never evidence. Above-cap/different-currency
  site facts return `refused` without invoking the approver; absent planner price is allowed.
  A fact source is re-read on retry and changed money/items require new consent. Keep completed
  writes single-use and never authorize from observations cached by a separate planner action.
  Model session fixtures with a preparatory Buy-flow read when checkout sends no price.
- Use `createTaskExecutor` to expose the existing gate methods. Never let the planner
  manufacture approvals or replace the gate with unconditional permission.
- Run `loginWithPassword` only in host code, with `createExecutorFetch` sharing the
  executor's sessions/persona. Neither credentials nor raw login responses enter history.
- CLI planners are opt-in. Use stdin, bounded output, timeout + one retry, no tools and
  an empty working directory. Do not inspect/copy auth files or set API keys. Tests mock
  the process boundary; they never run a real model.
- The demo/test-shop is fictional and disposable. Clear its learning order before the
  task. Retain the demonstrated search surface to avoid the HTML/API ambiguity; never
  weaken production matching to resolve a demo tie.
- Run package lint/build/typecheck/test and root lint after changing the skill index or
  suite inventory. The real shop e2e requires Chromium and loopback; do not hide failures
  behind environment-dependent skips.
