<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/site-profiler

Part of the semantic agent browser. The profiler learns a website once and returns a
`SiteModel` (the contract in `@jeswr/site-model`): the actions the site offers as schema.org
action types, each mapped to the site's own HTTP calls, plus flows learned from demonstrations.
The planner then asks for actions in RDF and never reads the page.

```ts
import { profileSite } from "@jeswr/site-profiler";

const { model, writeResponses, trace, warnings } = await profileSite({
  startUrl: "https://shop.test/",
  login: { username: "alex@example.test", password: "..." }, // optional, user-authorised
  demonstrations: [{ name: "buy-product", run: async (page) => { /* Playwright steps */ } }],
});
```

Options: `startUrl`, `maxPages` (default 40 attempted pages, including failures),
`maxProfileMs` (hard deadline, default 180000), `navigationTimeoutMs` (15000),
`networkIdleTimeoutMs` (5000), `login`, `demonstrations`, `labeller` (default
`heuristicLabeller`), `browser` (else headless Chromium is launched; `SAB_CHROMIUM_PATH`
overrides the executable), `now`, `modelId` (default `urn:sab:model:<host>`), `verify`
(default true), `version`.

## Steps (one module each)

| Step | Module | What it does |
| --- | --- | --- |
| Login | `login.ts` | Uses a password form on the redirected start page first, then a sign-in link, then a path-relative login fallback. Signs in through the password form, records every cookie the login set or changed and finds a probe URL that is 200 signed in and refused signed out. Bearer token endpoints in scripts give `refresh` info. |
| Crawl | `crawl.ts` | Navigation menu anchors first, then other same-origin links and GET forms (free text gets a word seen on the site). Skips logout/delete-like links and static files. |
| Guard and trace | `recorder.ts` | Records same-origin requests without cookies, authorization or credential-like body fields. Aborts every non-GET request outside the login and demonstrations. |
| Scripts | `scripts.ts` | acorn analysis of same-origin JS: `fetch`, fetch wrappers, `XMLHttpRequest`, axios, jQuery; URL patterns from literals and concatenation; CSRF headers read from `document.cookie` or a meta tag. |
| Templates | `templates.ts` | Clusters requests into RFC 6570 templates (numeric, uuid, sku-like and known-id path variables; query and body parameters) and merges crawl, form and script evidence. |
| Forms | `forms.ts` | Fields, select options, hidden fields; hidden csrf/token/authenticity fields become html CsrfRules. |
| Extraction | `extraction.ts` | JSON arrays (including administrative row envelopes; Product, Person or Order where evidenced) or one product-like object and repeated HTML cards (link plus price) or product detail pages, mapped to schema.org by key name. Descriptions and reviews are `untrusted`. |
| Labelling | `labeller.ts` | `Labeller` seam with deterministic heuristics; unknown writes are `irreversible-write`. |
| Operations | `operations.ts` | Parameters mapped onto property paths of the action node, request template, CSRF, session. |
| Demonstrations | `demonstrations.ts` | Runs scripted sessions, turns their writes into operations and the session into a Flow with inferred bindings. |
| Verify | `verify.ts` | Replays each read (signed out, then signed in), preferring a successful recorded request to that operation's examples. Retries a failure once with recorded successful values before dropping the read. Sets `session` and provenance counters; never replays a write. |

## The learning rule

Writes enter the model only from demonstrations (`provenance.method: "demonstration"`). Write
endpoints found in forms or scripts are reported in `warnings` and left out. The one exception is
the login operation: the password form the profiler submitted with the user's credentials
(`method: "form"`), and a token endpoint found in a script (`method: "js-analysis"`, lower
confidence), each referenced from a `LoginRoute`. Their username and password parameters have an
empty path, so only the credential vault can supply them.

Request examples stay with their endpoint; failed probes supply no parameter examples. Script
probes use the crawl word only for search fields and skip required query values they cannot infer.
Verification prefers successful demonstration requests, then crawl requests, keeping each request's
values together rather than mixing independent examples or defaults. Matching includes the method,
origin, path template and any fixed query values.

## Flow bindings

Every write of a demonstration is kept. For each value a kept step sent, the profiler looks for
the value on an earlier step's first extracted item (exact match first, then an IRI whose last
segment equals it). A write binds to the latest such step (the page the person acted on); a read
binds to the earliest (the shortest chain back to the inputs). Reads that supply a kept step are
kept too. Order/Invoice/totalPaymentDue reads demonstrated after the last write before payment
are also retained as money evidence, even when checkout sends no price. JSON totalPaymentDue
objects become Order extractions before considering nested product lines. Other values become flow inputs; a search query becomes `schema:object/schema:name`.
When a total read and payment share a delivery input, both bind to that input, which inherits the
payment form's default and options even when the read introduces it first.
Trivial values (`1`, `true`, ...) are never matched.

## Extraction selectors

Generated CSS selectors stay inside a small subset (type, `#id`, `.class`, `[attr]`,
`[attr="v"]`, `:scope`, descendant and child combinators) so any CSS engine reads them the same
way. `:scope` selects the item element itself (for `data-*` attributes on the card).

## Known limits

- Nested arrays in JSON (reviews of a product) are expressed as one field rule per index (up to
  five) because `FieldRule.path` is a single pointer.
- HTML prices without a numeric attribute are extracted as text.
- Path variables are only inferred for id-like segments; slugs need an id seen in a response.

## JSON list applications

Rendered administrative grids commonly GET their rows after the document loads. The crawler waits
for network idle (bounded), visits hidden submenu anchors without clicking action buttons, and
stops after 120 seconds of crawling or the page budget. The whole profile has a separate hard
`maxProfileMs` deadline, including probes, demonstrations and verification; timeout rejects and
closes the profiling context. A supplied browser stays open. Script probes are capped at 30.
Only the chosen same-origin password form may POST during login. Other writes are blocked outside
demonstrations, including background requests; known destructive GET routes are also blocked.

Observed `namespace`, `resource`, `collection` and `dataset` query selectors distinguish resources
sharing a dispatcher URL. They become fixed URL fields. Observed paging, sorting, search and filter
values stay separate inputs, preserving percent-encoded bracket names under RFC 6570. A JSON list
with a search input produces both SearchAction and ViewAction. Lists retain observed non-search
defaults, with page sizes capped at 25 for execution. Native forms containing only hidden fields
are not treated as search controls. Empty/config-only JSON with no extraction is omitted.

A witnessed nested `filter[...]` or `filters[...]` parameter also allows named controls outside
native forms on that request's referring page to propose individual filter members. This is an
inference: verification checks the recorded endpoint tuple, not every possible filter. Use the
site's actual filter semantics and page through large results explicitly; no automatic pagination.

Known JSON keys map to schema.org (including identifiers, names, email, order numbers, totals,
statuses and creation dates). Unknown scalar keys map to `sab:` plus the percent-encoded original
key; unknown text is untrusted. Nested objects, nulls and credential-like fields are not flattened.
Formatted monetary strings keep their text unless a row currency code supports conservative display conversion by the executor.

Opaque URL values (16–256 characters) repeated in at least two requests and supplied by a hidden
HTML input, meta tag or cookie become session/CSRF sources, never planner inputs or constants.
Cookie sources take precedence. Query tokens are decorated at replay time; path tokens use the
executor's documented whole-segment convention. Before any trace or sample returns, register every learned hidden/meta credential value from
both crawl and demonstration pages (including standalone inputs outside forms), alongside
cookies and passwords, and redact all occurrences in returned samples and warnings.
Route-specific tokens computed only by script are not inferred by this rule.

Analysis tries classic script syntax before module syntax. Scripts above 512 KiB, recorder-truncated
scripts (256 KiB body bound), and parse failures are skipped with one summarized warning per run.
Verification retains observed XHR headers and resolves session tokens afresh. HTTP 200 password
pages and JSON error/redirect envelopes are refused as data; a password page can establish a
signed-out probe even when the server uses HTTP 200.

The opt-in live acceptance test lives in `tools/webarena-bench/test/live.test.ts`, where the profiler,
executor and host login dependencies already exist. See that tool's README for the command and
artifact option. It performs only GETs and sign-in, without a planner or mutation demonstration.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Demonstrated composite forms and list quality

A JSON row envelope proposes `totalPath` only for a sibling safe integer whose key contains
`total` or `count` and whose value covers the observed items. Endpoint-owned nouns override
coarser field-based item typing. Query text never chooses a type. Currency-code suffix keys
map to priceCurrency; the executor conservatively types formatted row prices and ISO-like dates.

Successful demonstrated composite form payloads become semantic name, sku, price and quantity
inputs, with form templates mapping them to original bracketed wire fields. Presence/nonempty
values across the demonstration determine requiredness. Other stable, witnessed fields remain
fixed template values; missing, redacted, opaque session-like and undemonstrated values do not.
Routing configuration numbers stay fixed; item IDs remain inputs and matching body identity
fields bind to that ID. Ordinary flat forms keep their existing defaults/options.

Text multipart bodies are decoded under a 256 KiB request-body bound and a 2000-field limit.
Oversized/malformed/upload payloads are marked and excluded from write learning. CSRF fields
are redacted structurally; a witnessed matching cookie is preferred to a hidden input. Hidden
sources come from observed pages, including JS-page responses. Script-only token sources are
unsupported by the current CsrfSource union and are never baked into templates.

Tokens are rediscovered after demonstrations. Demonstrated redirects may propose later flow bindings even when the destination form is
rendered by JavaScript. Execution still requires the executor's declared created-location policy
and redirect/success checks; undeclared redirects remain Uncertain without identity bindings. Demonstrated POST
save-with-ID and delete/remove routes are labelled UpdateAction/DeleteAction conservatively;
unknown writes, including creates, remain irreversible-write. Failed/aborted demonstration
requests never teach a write. The opt-in harness demonstration and acceptance create and clean
up their own disposable products, block background preference writes, and run no model CLI.

For product administration, a quantity input describes inventoryLevel, not purchase quantity.
A demonstrated destructive grid search remains a required dynamic input, including when the
site submits no explicit selected IDs. Never drop or fix that selector to a demonstration SKU.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Such a filter-selected write gets a dedicated two-step Flow: the matching grid read, then
the write. Dispatch selectors (`namespace`, `resource`, `collection`, `dataset`) or the
endpoint family must agree. Search and nested filter inputs share their original Flow
bindings. A required empty-path identity Parameter, omitted from the write's explicit
body template, binds to a trusted resolver identity (`identifier`, `sku`, `productID` or
`orderNumber`). This marks the selection structurally without changing the contract or
adding a wire field. Direct execution of the write has no path. If no unique identity read
is available, the write stays flow-only and a warning explains the missing resolver.
Demonstration flows retain the matching read and identity binding too. Explicit selected
IDs keep their ordinary identity inputs. The executor re-resolves these filter selections
for approval and refuses ambiguous, empty, partial or changed selections; an all-items
request requires `sab:all true` with no `schema:object`.

A saved search returning no rows can teach its row shape through at most eight deduplicated,
read-only probes with the ordinary search cleared and size capped at 25, preserving its observed paging position.
Dispatch/session values and observed XHR headers are preserved; preferences are never saved.
A fresh password login retains its page CSRF source so the host can bootstrap its cookie jar;
the cookie preference applies to demonstrated writes after sign-in.

Model headers omit executor-owned content negotiation, credential and framing headers, including
Accept. Verification derives Accept from extraction format, as the executor does; JSON grid reads
therefore retain their JSON negotiation without storing Accept in the learned model. Vendor-specific
Accept media types require a future first-class, inventoried field.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
`discoverCredentialSources(pages, cookies, responses?)` returns explicit first-use credential secrets and
supported CSRF sources independently of repetition. Meta/hidden token fields and cookies can
supply session slots; recognised script credential literals are secrets only, since script
variables are outside CsrfSource. The fallback uses this stricter credential boundary alongside
`discoverSessionTokens`; ordinary opaque-value repetition discovery is unchanged.
The optional same-origin response inventory scans HTML from any method/status, nested JSON
credential keys and external scripts (including scripts with nonstandard media types). Script
credential analysis shares the profiler's parser, AST traversal and constant evaluation; variable
and global-object assignments supply secrets, never invented executable CSRF sources.
Numeric credential literals also register their runtime string and source spellings (including
hexadecimal, exponent and separated forms), so snapshots and learning cannot retain them as
ordinary constants. Parse/size failure recovery recognizes direct numeric assignments too.

Round-9 `test/review-r9.test.ts` profiles fictional standalone hidden `form_key` and meta
credentials on demonstration-only pages and verifies learning plus redaction before traces return.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## HTML discussions and demonstrated form identities

Repeated semantic HTML articles can teach DiscussionForumPosting, Comment and CreativeWork
collections without a demonstration. Headings, author links, machine dates, comment-count
attributes and permalinks supply the evidence; a profile's own heading link teaches Person.
Headlines, bodies, author labels and profile/collection names are untrusted. Child selector
chains keep nested comments separate; visible parent links become parentItem. Different record
classes on one document get separate read operations using the same HTTP request. Counts are
not inferred from the number of visible cards. Explicit sort menus supply path options and
next links supply optional cursor inputs; a cursor is never a starting-page default.

Demonstrated bracketed text forms expose title, body, forum and comment text inputs. A forum
selector's witnessed labels can identify a path context input (forumName); its numeric option
values remain the create form's forum input. Item IDs embedded in field names and CSRF selectors
become numeric slots. Tokens are scoped to the actually demonstrated form, including repeated
row tokens. Witnessed redirect aliases let a CSRF page use an identity route rather than a
particular title slug. Delete variants still target explicit path identities. Votes and unknown
writes stay irreversible-write; a displayed retract button alone does not establish reversibility.
Only trusted extracted fields can teach flow bindings.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Cookie intake and learning use the executor's shared classifier/registration and redactor.
HttpOnly, login-set/changed, model/vault-declared and common session-named cookies are credentials
from four characters, using the shared `MIN_REDACTION_LENGTH` floor. Other cookies need a logical payload of at least eight characters;
a preference `1` does not mask item IDs. Register wire, unquoted, percent-decoded and
decoded-unquoted payloads together. Traces, warnings and snapshots share HTML-entity and mixed
plus/percent form normalization with executor observations. Sub-four-character values are
guessable, provide no confidentiality, and never register for redaction or suppress samples;
the origin guard still confines them to their own site. Registered values of four to seven
characters keep token boundaries; eight or more receive full redaction in every supported form.

Pagination defaults preserve demonstrated/crawled positions. To prove a filter selection complete
without a total, the profiler must witness both a starting request (page 0/1 or offset 0) and its
continuation with the same scope. It stores the executor's strict `sab:pagination` declaration
in the existing Parameter.description, which survives RDF round trips. Offset continuation must
match the observed row span, including server caps. Missing semantics leave completeness unknown
and execution refuses. Empty JSON collection roots prove exhaustion only on successful responses;
missing/invalid roots and error envelopes cannot. HTML lists currently need a total for this proof.
`test/review-r10.test.ts` exercises learned round-tripped zero-based/offset models; encoded trace
and warning echoes are in `test/review-r9.test.ts`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Learned write responses

`profileSite` also returns `writeResponses`, keyed by operation ID in the executor's
`ExecutorOptions.writeResponses` shape. Pass it beside the model to `createExecutor` or
`createTaskExecutor({ model, writeResponses, sessions })`. The host owns both trusted artifacts;
policies never enter the planner catalogue.

Policies are learned only from demonstration writes with a complete, witnessed redirect chain.
The recorder links each redirect request to its actual parent; a later GET of the same URL is
insufficient. Every hop must stay on origin and on the first Location's resource, and no hop
may be blocked, incomplete or a password page. Creation also rejects alert/validation regions;
completion-only policies compare the demonstrated success flash. Conflicting witnesses
produce no policy. The path pattern replaces only the response identity and whole path inputs
declared by a matching learned read; other segments remain literal. The observed redirect
count and final successful HTTP status are retained. A learned single-item extraction or
identity read-back, plus matching submitted-value evidence, is mandatory for a created identity. A collection landing never teaches a creation policy; non-creating writes
can carry a completionOnly policy without promoting its URL.
No pattern means the executor still returns Uncertain and retains its repeat guard.

**Known persistence gap:** `sab:` model RDF cannot store these policies. A generated-contract
change across site-model's ontology, shapes, codegen profile and types is needed before that
can be supported. Until then, store `writeResponses` separately alongside the model; a model-only
RDF round trip loses them. The benchmark host stores them in its profile JSON sidecar.
`test/write-responses.test.ts` covers fictional recorded chains, rejected evidence, and executor
completion/Uncertain behavior with one approved POST and repeat refusal.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
The recorder checks the complete witnessed HTML/JSON response for error/validation evidence
before bounding its returned sample. It retains `responsePageError` and `responsePageFailure`
(including error-classed alerts while excluding neutral notices) and opaque `responseFlash` hashes alongside
that sample. A truncated landing can teach a completionOnly route/status policy only with the complete-response
failure check and flash inventory; a truncated sample alone remains insufficient. Reads/extractions still retain their
ordinary sample bounds. In particular, large administrative form pages can teach their witnessed
identity redirect without storing their entire HTML in the trace.

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

Neutral alerts (`role=alert`) and assertive live regions block created-identity promotion.
Error-classed alerts, aria-invalid and shared HTML/JSON failure evidence block all write
response verification. A demonstration flash becomes `successFlash` only after a 2xx
landing explicitly marked free of page errors by the recorder and an independent learned
read verifies the effect before another write: a targeted empty JSON collection proves
deletion, as does a 404/410 at the exact previously readable main-item URL whose witnessed
form submitted that delete. The prior item must expose its own matching permalink; all
path context must agree, and collections, access errors and redirects prove no absence.
An identified item's edited fields must equal the submitted values. Votes have
no independent effect verifier yet and teach no flash. Hashes of stable attributes and
normalized text are equality evidence only. A changed, additional or missing learned flash
at runtime yields Uncertain; flash-free landings retain the existing route/status rules.
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

Cleanup can make a demonstrated detail fail later read replay. Flash learning retains its
recorded before/after effect evidence even when replay drops that operation; executable
creation read-backs still require a retained, learned read. Fictional regressions for both
learning paths live in `test/learning-evidence.test.ts`.

Resource-pattern learning keeps that witnessed namespace even when an unclassified failed
background POST precedes the read. Its item identity and submitted-value checks still apply.
The separate flash-effect verifier retains its strict before-next-write window.
