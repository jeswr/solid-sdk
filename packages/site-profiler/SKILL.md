---
name: site-profiler
description: Use when changing @jeswr/site-profiler, the semantic agent browser's profiler that crawls a site, analyses its forms and scripts, runs demonstrations and writes a SiteModel.
---
<!-- AUTHORED-BY Codex GPT-6 -->

<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/site-profiler

Read README.md first. The output contract is `packages/site-model/src/types.ts`; never change it
from here, and keep the profiler returning a `SiteModel` object (the site-model package owns RDF).

Invariants the tests keep:

- The recorder's route guard aborts every non-GET request outside the `login` and
  `demonstration` phases. The crawler only navigates. Probes and verification send GET only.
  `test/e2e.test.ts` checks the shop's request log for this; keep that assertion.
- Writes enter the model only from demonstrations; the login operation is the single exception.
- The trace never holds cookie values, authorization headers, passwords or CSRF tokens.
  `sanitiseHeaders` and `redactBody` protect recording. Before returning any trace/sample,
  register every learned hidden/meta credential source from crawl and demonstration pages,
  including standalone hidden inputs outside forms, and redact against that complete set.
- Third-party text (descriptions, reviews, authors) is extracted with `untrusted: true`.
- Retain demonstrated Order/Invoice/totalPaymentDue reads after the last write before payment,
  even when no wire binding consumes their amount. Prefer the JSON total object over nested lines.
- Failed probes supply no parameter examples. Probe search fields with the crawl word; skip other
  required query values when no endpoint-specific value is known.
- Verify with complete recorded 2xx request values matching the operation's own method, origin,
  path and fixed query; prefer demonstrations, then crawl, and retry a failure once with recorded
  successful values. Total reads and payment share delivery defaults/options through their flow input.
- Generated selectors stay inside the subset `html.ts` implements.

Tests use only 127.0.0.1: `@jeswr/test-shop` and small fixtures in the test files. Playwright
launches through `launchChromium` (`SAB_CHROMIUM_PATH` overrides the browser). Run
`pnpm --filter @jeswr/site-profiler run test`; never leave `coverage/` behind.

Administrative applications:
- Inspect the redirected start page for a password form before navigating elsewhere. Preserve
  application base paths in fallbacks, bracketed credential wire names and path-scoped cookies.
- Keep navigation, post-render idle and full-profile deadlines bounded. Page attempts include
  failed navigations. Prioritize navigation-menu anchors; never click unknown action buttons.
- Dispatch query selectors partition resources. Preserve encoded bracket names for paging,
  sorting and filters; observed defaults belong to that resource only. Inferred filter members
  require a witnessed filter prefix and the request's own referring page.
- Session URL material needs both repetition and a page/cookie source. It never becomes an
  input/example/default. The executor owns path-token decoration; shared contract types stay unchanged.
- Script syntax/size failures produce one summary, not a warning per vendor bundle. Try script
  before module; skip truncated source. Preserve XHR headers during verification, and never treat
  an HTTP 200 password form or redirect/error JSON as successful data.
- JSON unknown scalar properties use stable keyed sab IRIs; unknown text is untrusted, secrets
  and nested objects are excluded. Order status is contextual, not inferred from product status.
- Keep every new heuristic covered by small fixtures. `test/generic.test.ts` covers pure inference;
  `test/generic-browser.test.ts` covers actual login/menu/idle/deadline behavior. The explicitly
  authorized disposable live fixture is opt-in via SAB_LIVE_SITE_URL in webarena-bench; the default
  suite remains deterministic and local. Never run a planner as part of live profiling acceptance.

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
Demonstrated redirects may propose bindings; execution promotes them only with the executor's
created-location declaration and redirect/success checks. Undeclared redirects stay Uncertain. Keep every write approval and repeat guard; never replay POST while following redirects.
The harness's opt-in live test creates and cleans up only its own product, blocks background
preference writes and uses a scripted planner. Never invoke a planner/model CLI for acceptance.

For product administration, a quantity input describes inventoryLevel, not purchase quantity.
A demonstrated destructive grid search remains a required dynamic input, including when the
site submits no explicit selected IDs. Never drop or fix that selector to a demonstration SKU.

- Never emit executor-owned headers (including Accept and Content-Type) as model static headers,
  header parameters or CSRF header targets. Keep body encoding in request.contentType. Verification
  derives Accept from extraction format; recorded JSON Accept is not a model header. Vendor-specific
  Accept requires a future first-class, inventoried field.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
HTML record learning uses structural evidence, never theme names or site routes. Keep text
untrusted, nested comment selectors bounded to their own article, parent links explicit, and
record classes separate when one document contains several. Sort options and paging cursors
come from visible navigation; do not default to a next-page cursor. Demonstrated form tokens
must belong to the particular action/form. Numeric IDs in names and token selectors are slots,
not demonstration constants. Only witnessed redirect aliases may shorten a CSRF source route.
Never infer a write or reversible vote from page controls alone. The opt-in forum acceptance is
in webarena-bench (SAB_LIVE_FORUM_URL); reads also run with no demonstrations.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Use the executor's shared cookie classifier, registration helper and normalization-aware redactor
at intake and learning boundaries. Register all logical cookie forms. HttpOnly, login-set/changed,
model/vault-declared and common session names qualify from four characters; other cookies require an
eight-character logical payload. Values below the shared `MIN_REDACTION_LENGTH = 4` floor are guessable and provide no
confidentiality: never register them for redaction or suppress samples because of them. Keep
the origin guard unchanged, token-boundary redaction for four to seven characters and full
redaction for eight or more; short preferences must preserve item identities. Never add a separate display decoder
or redaction algorithm. Protect trace/warning/snapshot HTML entities and mixed plus/percent echoes.

Preserve observed page/offset defaults everywhere, including selection Flows and empty-list probes.
Emit the strict `sab:pagination` Parameter.description declaration only after witnessing a starting
request and same-scope continuation. Offset spans come from returned rows. Unknown semantics,
invalid roots, error envelopes and non-success probes never prove exhaustion (see executor README).

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Learn executor-local `writeResponses` only from exact recorder-linked demonstration redirect
chains; never infer a hop from URL coincidence. Reject off-origin, missing, incomplete and
conflicting witnesses. Creation rejects alert/validation regions; completion-only policies
record and compare the demonstrated success flash. Slot only response identity and declared whole path inputs.
Return the witnessed redirect count, final status and successful landing extraction next to the
model. Hosts must carry this separate artifact through RDF round trips; persistence into sab:
requires a future generated-contract change. A landing collection proves no created identity.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Check full witnessed HTML/JSON for error/validation pages before truncating recorder samples.
Only the recorder's complete-response error evidence can admit a truncated landing sample;
never infer success from a partial sample alone. Retain extraction/sample bounds.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Round-11 success evidence

Exhaustion requires a 2xx probe with an explicitly empty JSON collection and the same
keys on every envelope ancestor as the resolve read's first page. Collection contents
and declared paging fields are excluded from shape comparison. The shared executor
`jsonFailure` predicate rejects `ok:false`, `success:false`, error/errors, exception,
validationErrors and error/fail status envelopes on every ancestor. A changed shape,
failure marker, missing root or non-success response leaves completeness unknown.

A created-location policy needs a learned single main item of the operation's object
type, with an identifier matching the route identity, or the learned read-back below. Arrays and repeated-item selectors
remain collections even when they contain one matching row. The policy's `inputEvidence`
records a submitted input name and main-item property. Learning and execution require
an exact field match to the concrete value sent. Untrusted title/name text may satisfy
only this equality check; it remains untrusted in observations and flow bindings.
Missing or changed evidence yields Uncertain and retains the repeat guard. No route/status
fallback creates an identity. Updates, deletes and votes may instead learn `completionOnly`
policies; these never promote a landing URL to a created identity.

Alerts (`role=alert`), assertive live regions and error/validation regions block only
created-identity promotion and learning a created-location policy. Non-creating writes
keep their route/status outcome rules. A successful demonstration landing records its
flash regions as `successFlash`: sorted hashes of stable attributes and normalized text,
used only for equality, never as instructions. The same flash is success evidence; a
changed, additional or missing flash at runtime yields Uncertain. Password pages and
shared JSON failure evidence still fail closed.
Login-discovered session cookie names and model declarations feed every profiler cookie
context. Re-register all retained cookie values as soon as their classification is known,
before returning traces or warnings. Round-11 regressions live in the profiler's
`test/review-r11.test.ts`, `test/write-responses.test.ts` and `test/generic-browser.test.ts`.

HTML main-item learning requires one record under `main` whose permalink identifies the
landing resource. A witnessed `-` permalink can replace only the display slug immediately
after the same numeric parent ID; every other path segment must agree. Parent collections,
different parents and multiple matching records remain collections. Order detail pages retain
their Order type and can expose heading identity and deliveryMethod as submitted-value evidence.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
When a script-rendered landing has no main-item extraction, `readBack` in the same
`writeResponses` artifact names an already learned GET operation and its input bindings.
A `{ identity: true }` binding sends the newly assigned identity; `{ input: "name" }`
binds a concrete submitted input, and `{ value: "1" }` retains a witnessed read control.
The demonstration or its follow-up crawl must witness the read returning exactly one
item of the created type, with that identity and an `inputEvidence` field equal to a
submitted value. A collection landing cannot use a row match to promote its URL.

After the approved write, the executor authorizes this read through the read gate and
runs it with the current session, origin guard, budgets, extraction and redaction. Only
exactly one matching identity and the recorded input-to-field equality promote the
created URL. Missing/unlearned reads, denied reads, duplicates, partial results or changed
fields yield Uncertain and retain the write fingerprint; the write is never retried.
Untrusted prose participates only in the bounded equality check. The shared SiteModel
contract stays unchanged; persist the policy artifact alongside the RDF model.
`site-profiler/test/write-readback.test.ts` covers matching/different delete flashes,
script-rendered creation, duplicate results, name/identity mismatch, a denied gate and
unlearned reads. The live product demonstration witnesses an ordinary ID-range grid read
before editing or cleaning up its own product.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Identity-filtered demonstration reads do not turn their item filters into defaults on
ordinary list/search reads. Nested filter defaults retain the first successful request's
scope, including absent filters. The read-back policy carries its explicit identity
bindings separately. This preserves subsequent broad searches and two-match refusals.
