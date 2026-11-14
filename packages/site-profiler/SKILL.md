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
conflicting witnesses. Creation rejects alert/validation regions; existing-item policies
require runtime effect verification. Slot only response identity and declared whole path inputs.
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
fallback creates an identity. Updates, deletes and votes instead require a learned `verification` read;
these never promote a landing URL to a created identity.

Neutral alerts (`role=alert`) and assertive live regions block created-identity promotion.
Learned flashes never establish success. The profiler does not learn `successFlash`, and
legacy sidecars carrying it confer no completion evidence.

Existing-item writes (delete, update, vote and similar) need `verification` in the trusted
`writeResponses` sidecar. It names a learned GET, its concrete input bindings, the target
identity input and a witnessed resource pattern with aliases. Whole path context inputs
can occupy slots, so parent IDs and tenant/store inputs stay bound to the write. Literal
namespace segments stay literal. A numeric detail route may witness a following display
slug; this affects only that single presentation segment. A related parent item cannot
stand in for the operation's object. Filter-selected writes can bind their structurally
validated resolver identity to an ordinary identity-filtered read.

After approval, immediately before sending the write, the executor runs that read through
the read gate. A complete matching target establishes the baseline. An unverified baseline stops before
the write and returns Uncertain without a committed write fingerprint. The same compiled GET,
headers, session and origin are used after the write. A deletion needs a 404/410 matching its learned not-found signature and without
authentication/failure evidence, or a successful explicitly empty identity-filtered JSON
collection with the baseline's envelope keys and, when declared, total zero. The collection
must bind the written identifier as an equality filter or an equal from/to range; broader
filters never prove absence. Learning requires the same template and context to show exactly
the target before the demonstrated deletion and zero items afterward. Complete bounded
collection-envelope evidence survives sample truncation; the profiler may fetch the witnessed
GET through the read gate. A fresh singleton baseline is still required at execution. Updates need every submitted
state field value; votes may use a witnessed numeric count delta. Neither read can be redirected,
partial, a login/password page, 401/403, a changed credential-cookie context or a shared
failure envelope. Any missing verification leaves a sent write Uncertain, with its
fingerprint retained and no automatic retry. A denial before approval sends nothing.
Typed numeric inputs may carry a bounded presentation template learned from that submitted
value on a later target read. Verification compares its exact prefix, suffix and decimal
scale without rounding. This private comparison never converts RDF observations or money
evidence; all payment and display-money checks remain in force.

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
item of the created type, with a trusted identity IRI and an `inputEvidence` field equal
to a submitted value. `readBack.identityPattern` retains the witnessed origin and resource,
tenant/store prefixes, replacing only the whole identity segment with `{id}`. Optional
`identityAliases` come from that item's trusted URL claims or recorder-linked GET redirects.
Execution requires every identity IRI to match one of those templates with the new identity;
numeric equality alone never proves a match. Old sidecars need reprofiling to learn this evidence. A collection landing cannot use a row match to promote its URL.

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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Nonstandard JSON row link fields can learn `schema:url` only from a recorder-linked
successful creation landing and a subsequent singleton identity read.
The link must match the whole witnessed resource prefix through its explicitly labelled
identity (or the complete landing URL); tenant/store segments remain literal. The original
field stays untrusted, and the learned URL pattern still controls runtime read-back.
No equal-ID route inference or site-specific field mapping is used.

Cleanup can make a demonstrated detail fail later read replay. The profiler retains a
witnessed existing-item verification read when cleanup removed its example; runtime still
requires a fresh baseline. Creation read-backs require a retained, learned read. Fictional regressions for both
learning paths live in `test/learning-evidence.test.ts`.

Resource-pattern learning keeps that witnessed namespace even when an unclassified failed
background POST precedes the read. Its item identity and submitted-value checks still apply.
Runtime verification still requires the exact target resource and request context.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Verification learning compares shared query/header selectors, excluding declared paging/sorting,
executor-owned headers and CSRF slots. Scope fields also include request-level controls in the write's form/JSON body; words
buried in domain property paths such as `product[stock_data][website_id]` are not controls.
Names compare across surfaces after lower-casing and stripping one leading `x-`, with no
synonyms. Matching scope fields must carry the same constant or the same bound input;
constant/input mixtures, conflicting values across surfaces, and different bindings refuse. A read-only scope
constant is permitted only after a read with the same method, origin, path template and
constant, in the same session, isolated exactly the written identity and reflected all
submitted values after the demonstrated write. Search/filter parameters may differ; other
request context must agree and no write may intervene.
The sidecar pins it; substitutions, input bindings and write-only scopes remain refused.
Execution repeats scope comparison after compilation and token decoration. Coverage includes
all bound action inputs and literal form fields changed from the pre-edit form; unchanged
carried form values are excluded. Partial coverage teaches no verification.

Submitted inputs pair with read fields by witnessed equality under the input datatype,
without changing either semantic label. The field must either have changed from a
pre-write read at that identity, or share the input's normalized wire leaf key (for
example `qty` and `product[quantity_and_stock_status][qty]`). Change evidence outranks
a leaf-key match; equal-strength candidates are ambiguous and unused. An equal value
with a different leaf and no change witness supplies no pairing. Runtime compares the
paired field with the concrete submitted value, retaining exact numeric presentation
checks. Untrusted values participate only in this private equality comparison.

Stored samples retain BODY_LIMIT (256 KiB). Verification alone uses a separate 8 MiB cap.
After demonstrations, the profiler fetches witnessed candidate GETs through the read gate in
the profiling session and stores only bounded extraction and field/value evidence. The
executor uses the same cap for both verification reads. Oversized, prematurely ended or
failed streams are Uncertain; partial evidence never proves completion.

A private `verification.notFound` sidecar entry records the status, content type and opaque
JSON-envelope or HTML-document structure of a read fetched for the demonstrated deleted
identity, in the same context. Per-profile keyed credential-context tags must agree across
the witnessed read, write and not-found probe; missing context evidence learns no signature.
Missing signatures never authorize 404/410 absence. Authentication
status envelopes, login/SSO documents and redirects cannot prove absence. Verification and its
CSRF sources pass the read gate before transmission. Reads use Fetch `cache: "no-store"`,
`Cache-Control: no-cache` and `Pragma: no-cache`; positive Age and cache-hit metadata invalidate
both baseline and post-write evidence. These private artifacts leave the shared contract unchanged.
`site-profiler/test/runtime-effects.test.ts` includes the round-14 adversarial reproductions.

<!-- AUTHORED-BY Claude Opus 5.5 -->
Read input types only through `htmlControlType` / `isHtmlInputType` from `@jeswr/site-executor`
(credential discovery, selector witnessing, forms, standalone CSRF sources). Pairing change
evidence uses only the immediate baseline: the latest same-identity read of the field after
the previous sent write and before this write; vote deltas start from it too.
