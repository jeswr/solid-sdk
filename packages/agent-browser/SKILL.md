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
  requires site evidence: after any preceding write, all trusted fresh basket totals must agree;
  only first-write direct buys may use all matching product prices times quantity. Wire money is
  a cross-check and planner money a cap. Bind/revalidate every source record, reject mismatched
  order IDs and never borrow product identity from schema:object. Keep completed/uncertain writes
  single-use and never authorize from a separate planner action's observations. The learned shop
  flow must retain a total read after adding to the basket and still display "for GBP 20.00".
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

Repeat guard and recovery:
- Remember every executor committed entry as soon as any execute call returns, including approval
  pauses and uncertain/failed flows. Use planToRequests fingerprints before execute and pass the
  task's excluded fingerprints back to the executor to cover response-bound writes. Canonical
  method/URL/body fingerprints exclude unused inputs and equate typed lexical variants. Never
  infer lack of commitment from result.status, and do not replay a sab:Uncertain receipt.
- Preserve commitment memory on host denial, approval-limit exhaustion and later execution errors.
  5xx, resets, network errors, timeouts and post-success extraction failures retain uncertain
  fingerprints; only 4xx is uncommitted. allowRetryOf grants host recovery for specific fingerprints;
  allowRepeats explicitly disables this task guard.
- Post-execution session/secret refresh is auxiliary: always return the executor's result with
  its status, receipt and committed/uncertain list intact. Report a safe `refreshError` separately
  on TaskExecutionResult and TraceStep; never expose the store exception or replace execution
  with an empty failure. Retain earlier commitments when a later approval retry throws too.
- Surface no-path.missing as safe planner-history error text. A Buy flow learned from a product-name
  search still requires that name; an object IRI cannot resolve the search input. Let the planner
  correct the mapped inputs instead of weakening typed identity matching.
- Session revisions belong to the executor/vault seam. Advance accepted update revisions; rejection stops persistence for the rest of the execution
  while keeping the in-memory jar; void retains the prior token. Never fetch a new token for old cookies; model learning and planner history must never carry it.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Browser fallback:
- Configure `createFallback` only with a host-supplied/scripted `FallbackPlanner`; this package
  supplies no model-backed planner or prompt. Keep browser snapshots out of the RDF planner.
- Trigger only on `no-path` with unknown matched effect and no missing known inputs. Retain
  all existing ambiguous/refused/denied/error paths. Update the task catalogue and executor
  together after learning; return the new model to the host for storage.
- All snapshot names/values are untrusted. Bound nodes/text and preserve explicit truncation.
  Use Chromium AX refs, fail cleanly on removed/navigated nodes, and retain human pacing.
- Block off-origin traffic, windows, frames, downloads and WebSockets. Dismiss dialogs.
  Each non-GET requires the same task approver before dispatch; grants bind concrete wire
  content and one browser step and cannot be shared by concurrent requests. Denial aborts.
  Summaries show site/button/field names, never password values or session material.
- Compile fingerprints through the existing executor compiler, before session/CSRF decoration.
  Remember sent writes even if learning fails, and emit Uncertain on incomplete executions.
  Check task exclusions at the browser write boundary as well as the executor boundary.
- Keep raw recorder evidence inside the driver. Use profiler redaction and token-source
  detection before exposing candidates; no credentials or personal write examples in models.
  Persist only changed cookies once with the loaded session revision; never retry rejection.
- Learn only after `done`. Replay reads through the executor, require an extracted item,
  and use fallback provenance/confidence below crawl. Admit writes only from this run's
  approved successful traffic; never replay them or infer flows. Validate and RDF-round-trip
  the new model. Every rejected learning candidate needs a safe reason.
- Keep real loopback/Chromium tests enabled. Assert the next task uses the executor with zero
  browser launches for both reads and approved writes. Test guards, rejection, bounds, secrets,
  session revision failure, single-use grants, uncertain writes and canonical repeat blocking.
