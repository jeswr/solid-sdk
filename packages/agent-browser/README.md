<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
# @jeswr/agent-browser

Private, experimental Node 24 package composing `site-profiler`, `site-model` and
`site-executor`. The profiler learns a site once. The planner receives an action
catalogue and bounded RDF observations; the executor holds the session and runs actions
behind its approval gate. The planner never receives page HTML or endpoint templates.

```ts
import {
  createExecutorFetch, createTaskExecutor, loginWithPassword, runTask,
} from "@jeswr/agent-browser";
import { InMemorySessions } from "@jeswr/site-executor";

const sessions = new InMemorySessions();
const executorFetch = createExecutorFetch({ model, sessions, persona });
await loginWithPassword(model, executorFetch, credentials);
const executor = createTaskExecutor({ model, sessions, persona });
const trace = await runTask({ goal, model, executor, planner, persona,
  approver: async (request) => showApproval(request), // "approve", "deny", or { limit: 20 }
});
```

`createTaskExecutor` wraps the existing executor and exposes its gate's `approve` and
`reject` methods. An ordinary `Executor` also works when the approver updates that
executor's gate itself. An approval never bypasses the executor: the identical parsed
action is retried with its issued, single-use approval id. `runTask` handles each approval in a
flow, including reapproval when the price changes; it asks the host again for every write.
`maxApprovals` bounds prompts per action (default 25). A numeric limit approves
only this action, in the displayed currency, when its declared amount is nonnegative,
finite and within the cap. It is not standing consent or independent price verification.

Payment amounts require trusted on-origin site reads in the same flow. After any preceding
write, only totals read after the last write qualify; all Order/Invoice/totalPaymentDue records
must agree on one amount/currency pair and match any bound order identity. There is no unit-price
fallback. Only direct buys whose payment is the first write may use matching product unit prices
multiplied by quantity. Every matching record contributes to conflict checks, consent binding and
retry revalidation; schema:object references cannot supply a product's own identity. Planner prices
are caps and wire money is a cross-check. The executor README's Money section states the threat
model: a client cannot stop a site displaying one amount and charging another; the instrument's
own limit is the backstop. Approvals show, for example, "for GBP 20.00" from verified site evidence.

A write may have committed after 5xx, reset, network failure, timeout, or failed extraction after
2xx/3xx. These attempts retain fingerprints and terminal receipts say `sab:Uncertain`. Only a 4xx
rejects a sent write as Failed and uncommitted. Never infer charge failure from an `error` result.

Within one `runTask`, every executor `committed` entry is remembered, including writes in an
uncertain execution or a flow paused for later approval. Before each action, `runTask` calls
`planToRequests` and blocks a concrete write whose `fingerprint` is already committed:
"already done in this task: <summary>; ask the person if they really want another".
Fingerprints cover the effective method, normalized URL with sorted query and canonical body.
Equivalent typed lexicals, JSON key order, hostname case, blank-node labels on unused inputs,
and optional inputs absent from the wire cannot bypass the guard. Response-bound writes are
checked again by the executor once their inputs resolve, using `excludeFingerprints`.
Changed effective bodies or URLs represent different writes. Reads and failures before any
write commits can be retried. `allowRetryOf: fingerprint[]` explicitly authorizes host recovery for those fingerprints only.
`allowRepeats: true` disables the entire guard; each task has its own memory.

`loginWithPassword(model, executorFetch, { username, password })` compiles the model's
password operation, obtains its CSRF token, submits it and checks its session cookie
and optional signed-in probe. An Uncertain redirected login requires both the learned
session cookie and a successful signed-in probe; the host never replays that login POST.
`createExecutorFetch` returns a host-only transport
configuration (sessions, optional injected fetch, persona and site). Login delegates
requests to the existing executor, including its origin guard, manual redirect checks
and cookie storage. Login
does not run through the planner. Use the same session provider and persona for login
and execution. The adapter remembers login/session secrets for trace redaction.
`createTaskExecutor.execute` returns `TaskExecutionResult`, extending the executor result with
an optional safe `refreshError`. A post-execution session/secret refresh failure preserves the
executor's status, observations, receipt and committed/uncertain list. `runTask` reports the
auxiliary error in `TraceStep.refreshError` and still blocks repeats; store exceptions never
enter the trace or planner history.

## Planner protocol

`Planner.next({ goal, catalogue, history, persona? })` returns one of:

- `{ kind: "act", turtle }`: one schema.org `*Action` node with catalogue input paths.
- `{ kind: "answer", text }`: finish the task.
- `{ kind: "ask", question }`: stop and return a question to the host.

History entries contain `request` Turtle, result `status`, `observations` Turtle and an
optional safe `error` (including the plain-text repeat-blocked result). Observations share
a default 12,000-character budget, allocated newest first. Within an execution they put
`sab:ActionOutcome` first, then the final step's trusted facts, then earlier steps.
`sab:Completed` means the action is done and the planner must not repeat it. `sab:Uncertain`
means a write may have committed but execution did not finish: do not repeat it or claim full completion.
For `no-path`, the executor's safe `missing` names appear as "Missing required inputs: ..."
in planner history. A learned Buy flow may require `schema:object/schema:name` for its search;
an object IRI supplies identity but cannot supply that name. The planner can then correct its
request using the catalogue's input paths.
In the planner view, each `sab:UntrustedText` value is capped at 200 characters, including
an explicit `[truncated]` marker. Untrusted structures receive space after all trusted
facts across history; truncation preserves connected blank nodes and untrusted wrappers.
The trace retains full extracted text. `maxSteps` defaults to 12; each planner call counts as a step.
Parsing, execution and planner failures become history text, so the next call can recover.

`promptFor(input)` renders the fixed system instructions and input. Vocabulary prefixes
are written as CURIEs without URL declarations; the planner can omit their declarations
in replies. Links and markup in text are escaped/omitted, and only observed item IRIs
are retained as URLs. Third-party text remains in `sab:UntrustedText` nodes and is always
data. `parsePlannerReply` takes the first fenced `turtle` block, or an `ANSWER:` / `ASK:`
line. `scriptedPlanner(steps)` accepts outputs, protocol strings or input-dependent callbacks.

`claudeCliPlanner({ model, bin?, timeoutMs? })` uses the existing Claude login, JSON output,
an explicit system prompt, `--tools ""`, a deny-all tool rule and disabled customisations/MCP.
`codexCliPlanner({ model: "gpt-6.1-sol", timeoutMs? })` uses the supplied `codex-sol.sh`
wrapper, low reasoning, read-only sandbox and `--output-last-message`. It disables shell,
exec, patch, multi-agent and web search features and user/project instructions. Both use
stdin, an empty temporary working directory, a 60-second timeout, a 1 MiB output bound
and one retry. Neither adapter reads auth files, sets API keys or forwards CLI diagnostics.
The supplied Codex wrapper manages its own login. Real models are opt-in and never used by tests.

## Trace and demo

`runTask` returns `format: "agent-browser-trace/0.1"`, an outcome (`answer`, `ask` or
`maxSteps`), optional answer/question text, and steps recording request, statuses,
approval summary/decision, observations, elapsed milliseconds and prompt token estimate
(`ceil(chars / 4)`). It excludes transport headers, credentials and raw HTTP responses.
The executor owns extraction redaction; the task adapter also redacts known login and
session values. Custom executors must uphold the same no-secrets result contract.
Host options accept `credentialContext` (registered `secrets`, cookie `declaredNames` and
`loginCookieNames`); the existing `cookieContext` option also contributes declarations.
Login, fallback discovery, replay verification and replacement executors share this context
for the same session provider, site and persona. Extraction renders against it before RDF
enters observations, the trace or planner history, including after a learned-model rebuild.
The inner executor accepts the same option. Host-only password login uses a single-use
grant for the learned login operation so credentials never become approval fields.
Each step's `approvals` array records all prompts in order; `approval` retains the latest
for compatibility. Refused payments are recorded as `refused` in trace and planner history.
Blocked repeats are recorded as `repeat-blocked` in both, without another HTTP request.

```sh
pnpm --filter @jeswr/agent-browser run build
node packages/agent-browser/scripts/demo.mjs --out /tmp/shop-trace.json
node packages/agent-browser/scripts/demo.mjs --planner claude --model sonnet --out /tmp/shop-trace.json
node packages/agent-browser/scripts/demo.mjs --planner codex --model gpt-6.1-sol --out /tmp/shop-trace.json
```

The demo starts a fresh fictional shop, profiles login plus a search/view/add/checkout
demonstration including a fresh checkout-total read after adding to the basket, round-trips the learned RDF model, resets the learning order and logs in
through the model. It then buys one pair of Trail Runner sneakers for GBP 20 with a
per-action cap. It prints step/status/token totals and writes JSON (`--out` defaults to
`agent-browser-trace.json`). Chromium must be installed; `SAB_CHROMIUM_PATH` overrides it.

The learned HTML and API search operations are equivalent and tie in the current
executor. The demo retains the demonstrated search operation before model round-trip;
the shared contract and profiler are unchanged. The Buy flow binds the observed product's
name to its demonstrated search input and resolves its SKU through its own view step.

## Validation

Run `pnpm --filter @jeswr/agent-browser run lint`, `build`, `typecheck` and `test`.
Unit and in-process transport tests need no network. `test/e2e.test.ts` needs a loopback
listener and Chromium; it profiles the actual shop and checks both approval outcomes,
the product/price summary, RDF provenance of the requested product, session isolation and
untrusted review wrapping. It fails if those facilities are unavailable; it does not skip.

`test/review-r2.test.ts` covers uncertain successful charges, canonical repeat detection,
response-bound write checks and missing-input recovery. Session bundles accept an opaque
`revision`; the executor advances it after accepted updates. Rejected updates stop persistence while the
in-memory jar continues; void updates retain the prior token.

For administrative list models, a host may construct a request with `sab:operation` set to a known
catalogue fragment (or full operation IRI); the executor retains its ordinary approval and input
checks. Explicit object types can also narrow read candidates. Bracketed credential fields and
path-scoped session cookies work through the learned login route. The read-only live acceptance
in `tools/webarena-bench/test/live.test.ts` exercises fresh host login and execution without
calling a planner CLI; see the harness README for opt-in settings.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
The opt-in `tools/webarena-bench/test/live-writes.test.ts` uses a scripted planner and learned
operations to create/update/delete a disposable product. It records seven approval decisions
(including a second create), requires exactly four POSTs, checks an identical-create
repeat refusal and observes prices/deletion through the grid. Only explicitly declared, verified redirect identities bind subsequent actions; an undeclared
redirect stays Uncertain and requires a verifying read. Paged ItemList counts and partial markers remain in planner RDF history;
formatted list prices do not relax payment evidence requirements. No planner CLI is used.

## Browser fallback

`runTask({ fallback })` can learn a missing operation during a task. Configure it with the
same session provider/persona as the executor and a host-supplied `FallbackPlanner`:

```ts
import { createFallback, scriptedFallbackPlanner } from "@jeswr/agent-browser";

const fallback = createFallback({
  sessions, persona,
  // Steps may also be callbacks that find an interactive ref in input.snapshot.nodes.
  planner: () => scriptedFallbackPlanner(browserSteps),
  maxSteps: 20,
});
const trace = await runTask({ goal, model, executor, planner, approver, fallback, persona });
const updatedModel = trace.model ?? model; // host decides where to store it
```

Fallback runs once for an action that returns `no-path` with no matched effect or missing
known inputs. Its step has `via: "fallback"` and `learned` operation IDs. The next planner
call receives the updated catalogue, and subsequent actions use a new executor over that
model. Executors returned by `createTaskExecutor` expose `withModel(model)`, which rebuilds
from the original host options, retaining response declarations, transport, session/persona,
clock and limits. Custom executors can
provide the same `withModel(model, credentialContext)` hook or pass
`executorFactory: (model, credentialContext) => executor` to
`createFallback`. Without either hook, learning retains the prior model/executor pair and
reports rejection rather than discarding host policy. The ordinary approval loop and task
commitment memory continue across learning. Without `fallback`, the return shape and execution
path stay unchanged. The ordinary RDF planner receives only bounded executor observations,
including untrusted-text wrappers.
Custom rebuild hooks must forward the supplied credential context to their executor along
with their original host policy; it includes secrets discovered during the fallback.
`Fallback.run` and `learnFallback` also return `proposed` operations and `rejected` reasons.
No model-backed fallback planner or prompt is supplied. `scriptedFallbackPlanner` accepts
steps, `done`, `give-up`, and input callbacks; an exhausted script gives up. A planner factory
creates a fresh sequence for each fallback run.

`BrowserDriver.create` owns one Chromium browser, context and page. It installs same-site
cookies from `SessionProvider.get`; at close it persists changed cookies once using the
original revision. Rejected updates are never retried. Navigation, resources and credentials
are restricted to the model origin. New windows, frames, downloads and WebSockets are blocked;
dialogs are dismissed. Every non-GET pauses at the request boundary. The task's `approver`
sees the site, form/button label and field names, with no password values. Only `"approve"`
issues a grant for that exact concrete request and browser step; it is consumed once.
A denied request is aborted. A numeric spending limit cannot approve an unknown write.
Sent writes retain executor-compatible fingerprints and Completed/Uncertain RDF receipts,
so task repeat blocking also covers fallback writes and failures after submission.
Redirect hops stay manually checked. A redirected document's final response is rendered at
its checked final URL without fetching it twice, before site scripts run; relative forms,
links and scripts therefore resolve against that destination.

`snapshot()` returns Chromium accessibility roles, names, values and stable interactive refs,
labelled `UNTRUSTED PAGE CONTENT` and `untrusted: true`. Defaults are 100 nodes and 8,000 text
characters, with explicit truncation. Individual names and values are capped at 300 characters
including a visible `[truncated]` marker; clipping either sets the snapshot's `truncated` flag.
Refs expire after navigation or DOM removal. Actions are `goto`, `click`, `fill`, `select`,
`press`, focused `type`, and `back`, with a 200 ms minimum interval;
`clock` and bounds are injectable. `launch` allows host browser configuration and launch
counting. `SAB_CHROMIUM_PATH` is respected by the default launcher.

After `done`, recorded traffic supplies templates, forms, extraction and labels. Each read
must replay through the HTTP executor with the session and extract an item. Reads have
`provenance.method: "fallback"`, confidence at most 0.35, and verification counters. Only
approved successful writes become write operations; they are never replayed while learning.
No flow is inferred. Aborts, other origins and credential-bearing candidates are excluded.
Explicit credential sources (meta/hidden tokens, cookies and recognised script variables) are
registered as secrets on their first use, including numeric script literals and their string
spellings. Verified sources use CSRF slots, including path slots; unsupported sources and
unresolved secret constants are rejected. Ordinary opaque IDs still need
the profiler's source/repetition evidence. Models validate, round-trip through site-model RDF,
and pass a dry executor construction before admission.
Writes currently support flat JSON string/number/boolean fields and URL-encoded forms; unsupported bodies fail closed.

`test/fallback.test.ts` exercises real Chromium/loopback order learning, address approval and
zero-launch executor replay, plus browser guards, pacing, snapshots, refs and revision rejection.
`test/fallback-learning.test.ts` covers executor verification, token slots, write admission and
canonical fingerprints. `test/fallback-routing.test.ts` covers statuses that must stay in the executor.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
The driver sends every redirect hop with automatic redirects disabled. Cross-origin redirects
become a navigation error page before transmission. A 301/302/303 after a write continues only
as GET; a 307/308 body resend needs another approval bound to its exact method, URL and body,
with a separate fingerprint. Cookies and session headers are attached by the driver per hop.
Fingerprints and learned parameters use the transmitted inventory; unsent controls and form
defaults cannot change them. Grants also bind the page generation and are invalidated by
navigation, frame changes or document replacement during approval.

Approval summaries identify the clicked submitter (or pressed control's form), show method and
target path, quote page strings, escape controls/newlines, and explicitly mark truncation.
Snapshots use the executor's secret redactor with display-encoding normalization and also scrub
sensitive URL queries and userinfo. Sent-write commitments survive learning, validation,
construction and task-processing errors. A clean write that cannot be learned retains a Completed
receipt with an explanation; an incomplete/uncertain execution retains Uncertain. The previous
model/executor pair stays available when admission fails.

`test/fallback-review-r1.test.ts` covers all seven review findings: controlled redirects and
reapproval; wire-only fingerprints and the one-POST constructor regression; learning/construction
and task-processing failures; first-use meta/script tokens; encoded snapshot secrets and URL
credentials; navigation during approval; and quoted, submitter-specific approval summaries.

`test/fallback-review-r2.test.ts` checks one shared wire-operation builder against conflicting
forms, leading zeros, empty values, repeated control names and JSON scalar types, including
repeat refusal. Each candidate keeps one transmitted request; page controls cannot change its
typing. Repeated wire fields are refused because the scalar-input contract cannot preserve them.
Credential discovery scans all same-origin HTML, JSON and JavaScript responses before page
exposure, including external scripts and unsuccessful responses. Unsupported script/JSON sources
cause unresolved templates to be rejected before replay. Session headers retain raw, trimmed,
scheme-normalized and credential-only secret spellings. Snapshots and trace text share URL
scrubbing for queries, fragments, userinfo and registered-secret path segments. Approval and
snapshot strings render Unicode formatting and control characters as visible escapes.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
`tools/webarena-bench/test/live-forum.test.ts` additionally exercises a disposable HTML forum.
A scripted planner creates a post, comments, edits, votes, deletes the comment and deletes the
post, with deny/approve decisions recorded at every write and an identical-comment repeat refusal.
The host logs in through the learned cookie-check login route; page HTML stays outside planner
history. Enable with SAB_LIVE_FORUM_URL; see the harness README for the command.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Cookie intake and learning use the executor's shared classifier/registration and redactor.
Host `cookieContext` declarations are merged with the current model at fallback creation,
learning and executor rebuilds. Pass the same context to `createExecutorFetch` and
`createTaskExecutor` for host session redaction; host names and vault `credentialCookies`
are combined without dropping `loginCookieNames` or other context fields.
HttpOnly, login-set/changed, model/vault-declared and common session-named cookies are credentials
from four characters, using the shared `MIN_REDACTION_LENGTH` floor. Other cookies need a logical payload of at least eight characters;
a preference `1` does not mask item IDs. Register wire, unquoted, percent-decoded and
decoded-unquoted payloads together. Traces, warnings and snapshots share HTML-entity and mixed
plus/percent form normalization with executor observations. Sub-four-character values are
guessable, provide no confidentiality, and never register for redaction or suppress samples;
the origin guard still confines them to their own site. Registered values of four to seven
characters keep token boundaries; eight or more receive full redaction in every supported form.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
When hosting a profiler result, pass both `model` and `writeResponses` to `createTaskExecutor`.
These demonstration-learned response policies remain a separate trusted artifact through model
RDF round trips; model RDF alone cannot preserve them. The scripted shop host forwards the
profiler output, without hand-written created-location patterns. Missing policies retain the
executor's Uncertain outcome and repeat guard.

`test/fallback-review-r3.test.ts` covers numeric credential discovery before snapshots/trace,
rejection of unresolved credential constants before replay, retained host executor options
and custom factories across learning, and visible per-value snapshot truncation.

`test/fallback-review-r4.test.ts` uses `createFallback` and real Chromium to check declared
and login-cookie redaction in both snapshot forms, rejection before read replay, and
retained context after learning with both fallback-created and host executors.

`test/fallback-review-r5.test.ts` checks script-token echoes under `items[].name`, host-declared
six-character cookie echoes, profiler-registered secrets, replay observations and the next
planner input across learning/rebuilds (including a raw executor returned by a host factory).
It also checks final document URLs, approved/denied relative forms, relative links/scripts,
queued navigation/back history and query/fragment aliases in both snapshot forms and trace.

Credential query and fragment values enter the shared context through the executor's
`registerSecret`, using the same `isCredentialKey` policy as URL scrubbing. Intake covers
navigations, redirect hops, form actions, links and recorded requests. Before snapshot rendering,
the driver reads live password-like `.value` properties, including `current-password`,
`new-password`, `one-time-code` and every control covered by snapshot masking. Input and submit
listeners also capture values before navigation can remove the document. Script-set values
and complete credential fills use the same registration path.

`test/fallback-review-r6.test.ts` checks the `sid` name echo across both snapshot forms,
driver/task traces, replay RDF and subsequent planner input, plus credential entry,
script-set live values, one-time codes, credential fragments and URL intake boundaries.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Protected controls accept complete `fill` values and only the exact `press` keys `Enter`,
`Tab` and `Escape`. Printable keys, editing/selection keys, modified keys (including paste
shortcuts) and `type` are refused before dispatch with a safe reason. The driver determines
protection from fresh CDP focus inspection, descending through closed shadow roots; unknown
focus, failed inspection and timeouts refuse keyboard input. Masked shadow hosts pass their
protection to inner controls. Protection includes accessibility
password labels/states, password-like DOM attributes, credential autocomplete (`username`,
`current-password`, `new-password`, `one-time-code`, `webauthn`) and values the snapshot masks.
Ordinary controls retain printable and editing keys; `type` rechecks focus before each character.
Complete credential fills are registered as secrets before dispatch, including into closed
shadow roots, and fill/type text is masked in planner history. Refused actions never enter
history, and refusal reasons never quote supplied keys/text. Snapshots, traces and approvals
use the shared secret redactor and registration floor described above.

Live collection uses CDP's shadow-piercing DOM traversal to read values in closed shadow roots;
the configured `timeoutMs` bounds collection. Collection failure or timeout withholds the snapshot
with a safe reason. Cookie persistence on close runs independently of collection and renderer
evaluation, preserves the loaded revision, and makes one update attempt for a changed jar.
Concurrent and repeated closes await the same pending persistence and cleanup.
`test/fallback-review-r7.test.ts` covers closed-shadow press refusal and script echoes in both snapshot forms,
registration before dispatch even when input handlers remove controls, collection failures/timeouts,
and exactly one cookie update after `Target crashed` or collection timeout.
`test/fallback-review-r8.test.ts` covers the edited-password and per-keystroke-history
reproductions, zero input dispatch on refusal, masked closed-shadow fills/history/approvals,
allowed Enter/Tab/Escape, unknown focus and focus changes before or during keyboard actions.
