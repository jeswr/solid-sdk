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

List/write learning additions: keep totalPath synchronized through types, ontology, both shapes,
codegen config and generated artifacts (regenerate, never hand-edit). List counts are integers
on ItemList; unseen records make observations partial. Display coercion requires a row currency
code for formatted prices and strict ISO-like timestamp syntax; payment evidence rules stay
unchanged. Type records from endpoint-owned words, ignoring user query values. Refund documents
fall back to Thing/additionalType text rather than Invoice/category.

Composite write templates must be witnessed by successful demonstrations, size bounded and
redacted. Prefer witnessed cookie CSRF over hidden/meta sources; script variables require a
contract discussion, never a hard-coded token. Preserve ordinary flat-form defaults/options.
Created identities may come from checked on-origin 301/302/303 redirects and supply later flow
bindings. Keep every write approval and repeat guard; never replay POST while following redirects.
The harness's opt-in live test creates and cleans up only its own product, blocks background
preference writes and uses a scripted planner. Never invoke a planner/model CLI for acceptance.

For product administration, a quantity input describes inventoryLevel, not purchase quantity.
A demonstrated destructive grid search remains a required dynamic input, including when the
site submits no explicit selected IDs. Never drop or fix that selector to a demonstration SKU.
