---
name: site-executor
description: Use when working on @jeswr/site-executor, the semantic agent browser's executor that compiles an RDF action request into a site's own HTTP calls behind an approval gate.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/site-executor

Read README.md first. Private, security-critical package: it holds user sessions and makes HTTP
requests. Contract types come from `@jeswr/site-model` (`src/types.ts`); do not redefine them here.

Keep these invariants, and add an adversarial test for any change that touches them:
- `origin.ts` `guardUrl` runs on every URL before it is requested: operation URLs, CSRF pages and
  redirect targets. It compares the WHATWG-parsed origin, and http is allowed on loopback only.
  Never use `redirect: "follow"`.
- Nothing is sent before the gate allows it. Approvals are single-use and bound to
  `approvalDigest`, and the executor (not the gate) decides whether an approval id matches.
- Results and errors carry no cookies, session headers, CSRF tokens, query strings or response
  bodies. Extracted text goes through the redactor.
- Values reach requests structurally (RFC 6570 encoding, JSON values, form fields), never by
  splicing into raw text. Model headers cannot set credentials or framing.
- Untrusted fields are emitted only as `sab:UntrustedText` nodes. RDF output uses `n3.Writer`.

Tests use only their own 127.0.0.1 servers (`test/fixture-shop.ts`, `test/helpers.ts`) and fictional
data. Never contact a real site.

Security review hardening:
- Validate and freeze a cloned model at construction: IDs are unique across operations and flows,
  parameter names are unique and safe, and every flow operation/reference is valid.
- Validate flow inputs against their own ranges/options before matching can reach the gate.
- Authorize preparatory flow reads as reads. Compile and re-gate each write with its concrete
  inputs after earlier steps resolve. Bind the request, step index, session fingerprint, flow
  inputs and resolved write inputs. Approval retries resume a stored snapshot; never replay
  completed writes. Flow gate inputs expose `$step` and `$input.<name>` alongside concrete values.
- Payment requires site evidence: after any preceding write, aggregate every trusted on-origin
  Order/Invoice/totalPaymentDue record read after the last write. Require one distinct amount/currency
  pair or "needs one fresh basket total"; never fall back to unit prices. Only a first-write direct
  buy may use product price times quantity. Aggregate all matching own IRIs/typed IDs, reject
  conflicts, and never borrow a product identity from schema:object. No untyped suffix fallback.
- Totals match every order/basket identity bound by payment (orderNumber, identifier, object or
  referencesOrder IRI); empty identity lists cannot prove a match. Bind all contributing records
  and revalidate all source reads on retry. Planner prices are caps; wire amounts are cross-checks.
  Keep whole-value, exact-decimal and cumulative-spending checks. The README Money threat model
  is normative: client checks cannot prevent a site displaying one amount and charging another;
  the payment instrument's own limit is the backstop.
- Aggregate every amount OR currency claim before consistency checks, including partial records;
  bind and revalidate each contributing source. Truncated money- or identity-capable reads make evidence
  incomplete even when retained records do not match. Expose item/value truncation and detect
  item overflow before materializing fields (HTML needs at most one extra match).
- A site model is trusted input like code, supplied by the person's own profiler or a signed
  model (the host verifies signatures). Validate its structure and apply README Rule W.
- Replace parameter configuration matching with closed-world coverage of concrete requests after
  expansion and CSRF insertion. Inventory every query/form/multipart field, every JSON member by
  RFC 6901 pointer, each path variable by template name, and all model static/parameter/CSRF
  headers, tracking model header provenance at compilation. Refuse executor-owned Accept,
  Content-Type, Content-Length, Cookie, Origin, Referer, Host, credentials and framing names
  through static headers, parameters and CSRF targets (case-insensitively); never silently drop.
  Shared validation must report the same declarations. Reserve vault header names on session load.
  Derive Accept from extraction format and Content-Type from body encoding; profiler output must
  omit executor-owned headers. Vendor-specific Accept needs a future inventoried field.
  Normalize compiled multipart names/values to their serialized fields (CRLF, USVString and name
  quoting), including CSRF insertion. Verify actual Request serialization; LF and CRLF quotes differ.
  Compare header names case-insensitively, other wire names case-sensitively, and canonical values exactly. Refuse duplicate
  names across any locations within either request.
- Every payment field must be covered by the total request's same name/value, a whole checked
  order/basket identity equal to the total, or the CSRF target. CSRF names cannot alias anything
  else in payment or any total field. Every non-identity total field must be covered in payment
  too. Otherwise refuse "payment sends <name>, which the basket total did not cover" (or the
  reverse-coverage diagnostic). Semantic paths and declared defaults cannot establish coverage.
- Direct buys send only whole bound product identity, whole bound quantity multiplied into money,
  and unique CSRF decoration. Refuse payment-only static literals and wire amount/currency inputs.
  Retain whole-value checks for bound inputs; refuse unused, embedded, duplicate and transformed
  uses, including URI prefixes. Bind actual total wire inventories in the approval digest and
  repeat their reads on retry. Prepare payment CSRF before checking money and approval.
- Refuse item/value truncation in any money- or identity-capable evidence read, including a
  separate identity-only source even when retained records appear consistent.
- Aggregate orderNumber, identifier and normalized own IRI claims across every record of the
  selected order before skipping money-empty records. Follow shared typed identities even on
  records without total types; contradictions refuse. Bind and revalidate identity-only sources
  alongside monetary sources, so any identity change invalidates the previous approval.
- Reject payment flows without a payment-effect operation at construction. Preparatory writes
  retain their own effect; strongest steps inherit a stronger declared flow effect. Every write
  gated as payment must pass mandatory money checks.
- Reject endpoint dot segments, including encoded values, route separator injection and route
  changes caused by URL normalization. CSRF tokens cannot overwrite approved inputs.
- Untrusted marking overrides datatype, including `iri`, and untrusted fields cannot supply item
  subjects or flow facts.
- Register source and final transmitted cookie/header/token values after decoration, using the
  compiled wire inventory and final Fetch headers rather than duplicating normalization rules.
  Use shared `registerSecret` and `MIN_REDACTION_LENGTH = 4` for all credential intake.
  Values shorter than four characters are guessable and provide no confidentiality: never
  register them for redaction or suppress samples because of them. Keep the origin guard for
  every value. Registered values of four to seven characters require token boundaries; eight
  or more receive full redaction in every supported form. The eight-character floor applies only to heuristic,
  unregistered discoveries. Use exported `isSessionCredentialCookie` / `registerCookieSecrets` at every intake and
  learning boundary. HttpOnly, login-set/changed, model/vault-declared and common session-named
  cookies register from four characters; other cookies require a logical payload of at least eight.
  Preserve vault `credentialCookies` through updates. Register wire, unquoted, percent-decoded
  and decoded-unquoted payloads.
  Normalize form `+` to space before percent decoding. Keep trimmed, mixed/nested percent,
  JSON and HTML entity coverage. Redact before truncating, and re-render every observation with the final secret set
  on done, error, denial and approval returns. Retain structured values, never re-redact Turtle.
- Bound extraction before materializing items: 200 items, 100 values per field, 1000 total values,
  3000 quads, 1 MiB output, 4000 emitted characters per value. Value/quad/byte overflow fails closed.
- maxExecutionMs defaults to 30 seconds per execute call. An absolute deadline covers fetch,
  redirects and bodies, with AbortSignal and reader cancellation, and returns a limit error.
  Keep deadline tests on injected transports; never depend on external idle timeouts.

The execute/approval methods retain their existing use; additive commitment, revision and repeat-guard fields are documented below; callers must handle `refused`, multiple approvals
per flow, and supply trusted flow reads for payments. README documents the intentional
refusals and the additive deadline and extraction budget options. Tests use the in-memory fixture fallback when
127.0.0.1 socket binding is unavailable.

Execution rules:
- Record any sent write without a 4xx rejection: 5xx, reset, network error, timeout and failed
  extraction after 2xx/3xx are uncertain. Retain their fingerprints in committed before response
  processing. Emit sab:Uncertain for terminal failures with any retained write, and block automatic
  repeats. Only 4xx is Failed and uncommitted (unless an earlier write already committed).
- Keep RDF term kinds through resolution. Blank nodes cannot bind scalar inputs; IRI terms use
  WHATWG normalization before wire encoding and fingerprinting. Literal text stays literal.
  Extraction retains response kinds in structured `terms`, normalizes `datatype: "iri"` values
  before binding (including scalar targets), and leaves literal lexical text verbatim.
- Fingerprint concrete writes before session/CSRF decoration: method, WHATWG URL (sorted query)
  and canonical body. Canonicalize typed values on all wire surfaces and exclude unused inputs.
  Expose concrete plan fingerprints and enforce execute's excludeFingerprints at the boundary
  for response-bound writes too. Never fingerprint placeholder bindings as concrete writes.
- Redact each complete display value against all session secrets before normalization, formatting
  or truncation; include object names absent from mapped inputs and model labels.
- SessionProvider.update may return { accepted, revision? }. Advance the token after acceptance;
  after rejection stop persistence for the execution and keep the in-memory jar. Never fetch a
  revision to pair with old cookies. Void returns keep the old token. InMemorySessions uses this
  contract, advances accepted revisions and reports stale updates as rejected.
- no-path returns safe missing required input names from the closest matching action candidate.
  Do not invent a name/search query from an IRI. Keep diagnostics free of URLs and binding specs.

Session-protected list replay:
- `sab:operation` may select only a known operation/flow by exact IRI or catalogue fragment;
  explicit object classes narrow reads by extraction type. Both paths retain every gate and
  input check. Do not resolve unspecified ties arbitrarily.
- A query CSRF target naming one unbound whole simple path slot is session decoration. Reject
  embedded/reserved/duplicate occurrences, approved-input collisions, dot segments and encoded
  separators. Keep decoration after authorization and out of fingerprints. Test adversarial values.
- Decode RFC 6570-encoded form field names once at the wire boundary. Keep query names encoded
  through template expansion. An expired session returning an HTTP 200 HTML password form must
  fail as no-session, including probes performed by the host login adapter.

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
Created identities from 301/302/303 redirects require a declared first-hop created-location
pattern, every hop staying on its exact resource, no modeled error destination, and any declared
final success evidence. Otherwise emit Uncertain without identity bindings and retain the repeat
guard. Use the executor-local `writeResponses` policy until a coordinated shared-contract
extension can persist these declarations; see README. An undeclared redirect is Uncertain. Keep every write approval and repeat guard; never replay POST while following redirects.
The harness's opt-in live test creates and cleans up only its own product, blocks background
preference writes and uses a scripted planner. Never invoke a planner/model CLI for acceptance.

- Inventory decorated reserved path slots as path fields flagged sessionToken. Payment tokens
  get the unique CSRF exemption, never collision exemption; total tokens get reverse-coverage
  exemption only. Shared validation admits one otherwise-unbound whole simple segment per query
  CSRF target, keeping all other undeclared endpoint/body/source variables invalid.

Selection completeness requires observed `totalPath` equality or a zero-item next-page probe
using declared pagination, unchanged filters and session, through the read gate. Preserve the
observed start (0 or 1); require the strict `sab:pagination` description declaration documented
in README, and advance offsets by returned item count. Only an explicit empty JSON array at
a valid declared root of a 2xx success response proves exhaustion; malformed/missing roots,
error envelopes, non-success statuses and zero HTML matches leave completeness unknown. Unknown
completeness refuses with ambiguous-target, including explicit all. Compare every concrete
selection field on both requests, with only declared paging/sorting and CSRF exemptions.
Always show sent identifiers beside names in write approvals; refuse planner names conflicting
with trusted resolved/bound identity names. Keep display-converted money separate from
structured evidence values/terms; payment and totals accept only original decimal lexicals
with explicit currency, including complete lists. Round-9 regression files cover each boundary.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Form-name identity slots must be numeric; HTML CSRF selector slots must be ASCII slug characters
only. Expand before wire inventory and token insertion. Never interpolate arbitrary CSS or raw
form bodies. Keep denial and repeat protection before any HTTP, and test syntax injection.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Accept the profiler's learned `writeResponses` artifact beside the model. redirectCount and
finalStatus narrow success to the witnessed chain; a creation also requires a main-item extraction
or learned readBack plus inputEvidence. Keep the round-9
first-hop/same-resource/origin rules, and keep undeclared redirects Uncertain with no identity.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Keep Referer executor-owned: for writes using an HTML CSRF source it is the actual guarded
form page's final URL, never a model header. Use matchesCreatedIdentity for learned permalink
aliases; same-origin equal IDs alone cannot equate unrelated routes or conflicting item claims.

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
Round 17: scalar JSON roots are discriminators (exact value in not-found signatures, and
`jsonRootFailure` applies the authentication token/numeric rules to them). Classify every form
control with `html-controls.ts` (ASCII-case-insensitive names and types, missing/invalid input
type is text); never compare a raw `type` attribute. Profiler pairing takes change evidence
only from the latest same-identity read after the previous write and before this one.
Round 18: a 404/410 not-found deletion also needs the learned `verification.liveness` read
(gated, cache-bypassed, same session) to return its learned `livenessSignature`; anything else
is Uncertain. Element-less HTML 404s are scalar text documents. In the not-found context,
message-like values and main document text are checked with `authenticationText`; these
markers only ever reject.
Round 19: the liveness read must also be refused without credentials. After its credentialed
match, send the same gated, cache-bypassed GET once with `anonymous: true` (no session headers,
no cookies, no Set-Cookie applied, challenge reported, no redirect followed) and require
`authenticationRefusal` plus a signature mismatch. Missing learned `anonymous` evidence or CSRF
rules on the liveness read mean Uncertain. Never widen `authenticationRefusal` with
"forbidden", "denied", "permission", "token" or "private": there a match helps completion.
Round 20/21: the control keeps every cookie except those with positive login evidence
(`isLoginCredentialCookie`: declared credential cookies, login-set cookies, the login routes'
`sessionCookies`) and drops the session headers; never send it cookieless, and never use the
redaction classifier `isSessionCredentialCookie` for it (an HttpOnly or credential-named gate
cookie must stay). Round 22: the drop list is `controlContext` (`credentialCookieNames`, the vault's
`credentialCookies`, runtime login cookies, `loginCookieNames`, `sessionCookies`); never feed it
`declaredNames`, which hosts widen with CSRF cookie sources for redaction. Residual (accepted):
login evidence is every cookie the sign-in changed, including the session cookie itself and
cookies the post-login landing page sets; a gate stored in one of them (for example an age flag
in a server-side session that outlives an idle sign-out) cannot be separated from the
credential and is dropped with it. Nothing to drop means no control and no proof (Uncertain). Compare its answer with `sameRefusal(anonymous,
refusalEvidence(...))`: the pinned kind and, for `login-redirect`/`login-envelope`, the pinned
route. Refusal wording comes only from the title, headings outside chrome, the login form's
labels/buttons and message-like JSON values; login pages must pass `isLoginDocument`; a login
envelope needs an explicit expiry/authentication flag AND a redirect to a learned login route.
Collection absence also needs `sessionLive`. A redirect target becomes a login route only when the profiler verified it
(`anonymous.verifiedRoutes`: fetched as a credentials-only control and answered a login
document, at most one same-origin hop to a learned route; round 21: its login form posts to the
learned login operation's target (or self-posts with the learned credential field names while
the signed-in fetch redirects away), it is never the site root, and the signed-in context is not
served it as an ordinary page; validation rejects a root verified route); the pinned route still
matches exactly.
