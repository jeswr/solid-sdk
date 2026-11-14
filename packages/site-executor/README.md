<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/site-executor

Part of the semantic agent browser. A planner asks for an action in RDF, for example a
`schema:BuyAction` for a product at GBP 20 or less. The executor matches that request to a flow
or an operation of a `@jeswr/site-model` `SiteModel` and asks the approval gate. If the gate
allows it, the executor runs the site's own HTTP calls with the user's session and turns the
responses back into RDF facts. The LLM never reads the site's HTML.

Private and security-critical (`"securityCritical": true`): this package holds user sessions and
makes HTTP requests.

## API

```ts
import { createExecutor, createApprovalGate, InMemorySessions } from "@jeswr/site-executor";

const gate = createApprovalGate();              // reads allowed, everything else asks
const executor = createExecutor({ model, sessions: new InMemorySessions(), gate });

let result = await executor.execute(request);    // request: ActionRequest (site-model)
while (result.status === "needs-approval") {
  // show result.approval.summary, e.g. "Buy Trail Runner sneakers for GBP 20.00 on shop.test"
  gate.approve(result.approval.id);
  result = await executor.execute(request, { approvalId: result.approval.id });
}
// result.observations[i].turtle holds the extracted graph
```

- `createExecutor({ model, sessions, gate?, fetch?, now?, persona?, maxRequests?, maxRedirects?, maxResponseBytes?, maxExecutionMs? })`
- `execute(request, { approvalId?, excludeFingerprints? })` returns `{ status, target?, outcome?, observations, approval?, error?,
  errorKind?, candidates?, missing?, committed, requests }`. `status` is one of `done`, `needs-approval`, `denied`,
  `refused` (unsafe or unverifiable money; see `error`), `no-path` (`missing` lists unresolved required input names for the closest candidate), `ambiguous` (see `candidates`) or `error`.
- `planToRequests(request)` (a method, and a standalone `planToRequests(model, request)`) is a dry
  run. It returns the compiled requests and sends nothing. Flow step references show up as
  placeholders, and a plan never contains credentials. Concrete writes include a `fingerprint`;
  response-bound writes get theirs when their inputs resolve at the write boundary. Fingerprints
  hash the method, WHATWG-normalized URL with sorted query, and canonical body. JSON keys are
  sorted; typed values use canonical XSD lexicals on JSON, form, path, query and header surfaces.
  Unused inputs, session credentials and CSRF decoration are excluded. `excludeFingerprints`
  refuses a matching concrete write before approval or transmission (`errorKind: "repeat"`).
- `SessionProvider` is `{ get(site, persona?), update(site, persona, bundle) }`.
  `SessionBundle = { cookies: Cookie[]; headers?; revision?: string }`. `Cookie` uses the shape of Playwright's
  `context.cookies()`, with `expires` in Unix seconds. `InMemorySessions` is the in-memory
  implementation. Revisions are opaque. `update` may return `{ accepted: boolean; revision?: string }`.
  An accepted revision replaces the previous token for every later update in that execution.
  A rejection stops persistence for the rest of the execution while its in-memory cookie jar
  continues to work. The executor never fetches a new revision to attach to old cookies.
  Returning `void` preserves the original token. `InMemorySessions` returns this same contract,
  advances its revision on every accepted update or `set()`, and reports stale updates as rejected.

- `Gate` is `{ authorize(GateRequest) }`. It returns `allow`, `ask` with an `ApprovalRequest`, or
  `deny`. A `GateRequest` carries the target, the effect class, the resolved inputs, any money
  fields (`amount` and `currency`, derived from wire mappings or trusted site facts), a plain-English
  summary and the binding digest. Flow write approvals include concrete operation inputs, the
  original flow inputs under `$input.<name>`, and `$step` (the zero-based step index). A host can
  build standing spending limits by returning `allow` without asking. For payment steps, `amount`
  includes payments already sent in the same flow, so the host enforces the authorized total.
  The exported `moneyFields(request)` helper reads planner claims only; conflicting claims throw
  `BindingError`. It is not sufficient to authorize a payment.

Every completed effectful operation or flow returns an `outcome` (`ActionOutcome` from
site-model): `{ status: "completed", target: <label>, effect, amount?, currency?, result? }`.
`ExecutionOutcome` locally extends the shared `ActionOutcome` with `status: "uncertain"`.
Terminal errors, refusals and denials use `uncertain` when a write may have reached the site;
otherwise they use `failed`. Reads and approval pauses have no outcome. Every result includes
`committed: { target: Target, fingerprint: string }[]`, including pauses and failures. Entries
include successful writes and uncertain attempts: HTTP 5xx, network errors, resets, timeouts,
and 2xx/3xx followed by failed response processing or extraction. Only HTTP 4xx rejects a sent
write without retaining its fingerprint. Registration precedes cookies, redirects and extraction.
A later failure never removes entries. Hosts must guard all of them against automatic repeats.

The first observation is an executor-authored receipt: `a sab:ActionOutcome`,
`sab:status sab:Completed` (or `sab:Uncertain` / `sab:Failed`), `sab:target` (the label) and `sab:effect`.
Payments carry the authorized total as `schema:price` / `schema:priceCurrency`, rather
than the planner's spending cap. When the final extraction or a verified declared write redirect
identifies a created item, `schema:result` points to its on-origin IRI and the receipt
includes that item's trusted facts. Secret identities and URLs containing queries are
excluded. The remaining observations retain their original step order and untrusted wrappers.

## Behaviour

1. **Match.** Flows are tried first, then operations. A candidate must have the same action type
   (`http://schema.org/` is read as `https://schema.org/`), and every required input must resolve
   through `Parameter.path` or a default. When several candidates match, the one that resolves the
   most inputs from the request wins, and a tie returns `ambiguous`. A class-ranged parameter takes
   the node's `schema:sku`, `schema:productID` or `schema:identifier` when present. Otherwise it
   uses the last path segment of the IRI for the wire input, while retaining its original typed
   identity for money checks. A blank node without an id property does not resolve. Required
   scalar inputs reject blank nodes, and IRI terms are WHATWG-normalized before sending and
   fingerprinting. Required name/search inputs still need their mapped values: an object IRI cannot supply its name.
   Scalar inputs reject blank nodes. IRI terms are WHATWG-normalized before sending and
   fingerprinting. `no-path.missing` identifies those inputs without exposing URLs, defaults or binding specs.
2. **Gate.** The executor computes the effect it reports to the gate. For a flow, this is the
   strongest of the flow's declared effect and each step's effect. The strongest steps inherit
   any stronger declared flow effect; preparatory steps keep their own effect. A payment flow
   must contain a payment-effect operation, checked at construction, and every write gated as
   payment passes the mandatory money checks. Preparatory flow reads are authorized as reads.
   Every write is compiled and authorized immediately
   before execution, after its earlier-step bindings resolve. An unknown effect counts as
   `payment`. The executor loads the session before calling the gate, so a missing sign-in does
   not use up an approval. Every flow input is validated against its own range and options before
   any authorization or HTTP request.
3. **Compile.** URL templates use RFC 6570, implemented here for levels 1 to 4. Query parameters
   that the template does not name are appended with the same encoding. JSON body templates are
   parsed and filled structurally:
   - A whole-value placeholder (`{qty}` or `"{qty}"`) keeps the parameter's JSON type.
   - A placeholder embedded in a longer string is filled as text.
   - An absent optional value drops its member.

   A value can never break out of its JSON string. Form and multipart bodies are built from
   `form`/`body` parameters or from a form template. Values are checked against their XSD range
   and their `options`. The executor owns `Accept`, `Content-Type`, `Content-Length`, `Cookie`, `Origin`,
   `Referer`, `Host`, credentials and framing headers (including `Sec-*` and `Proxy-*`). Static
   headers, header parameters (even unset optional ones) and CSRF header targets naming any of
   these are refused case-insensitively with `BindingError`; structural validation reports them.
   No forbidden model header is silently dropped. Vault header names are also reserved when the
   session loads. Header values containing control characters are rejected.
   `Accept` derives from extraction: json uses `application/json`, html uses `text/html`, and
   none uses `*/*`. `Content-Type` derives from the declared body encoding; multipart boundaries
   belong to the transport. Vendor-specific Accept media types are a known limitation; a future
   first-class, inventoried accept field would be needed to support them.
   Multipart names and values are normalized at compilation (including CSRF insertion): CR/LF
   becomes CRLF and lone surrogates become U+FFFD. Multipart name quoting is canonicalized to
   its decoded field name. The compiled body retains those values and sends them unchanged.
   URLencoded forms preserve line breaks and use the same USVString conversion as URLSearchParams.
4. **CSRF.** Each source kind is supported: `cookie` (read from the jar), `html` (a CSS
   selector plus an attribute), `meta` and `json` (an RFC 6901 pointer). The token can go into a
   header, a form field (or a top-level JSON member) or a query parameter. A missing token stops
   the run before the write is sent.
5. **Session.** Each request carries the cookies that match its URL under RFC 6265 domain, path,
   secure and expiry rules, together with the vault's session headers. Each `Set-Cookie` is merged
   and stored through `sessions.update`. A `Domain` attribute that does not match the responding
   host is ignored.
6. **Redirects.** Redirects are never followed automatically. An on-origin redirect after a GET is
   followed manually, up to `maxRedirects`. After a 301, 302 or 303 on a write, the executor GETs
   the `Location`. A 307 or 308 on a write is an error, because following it would send the body
   again.
7. **Flows.** Steps run in order. A binding is one of:
   - `$input.<name>`, a flow input;
   - `$step<N>.<propertyIRI>`, the first value on step N's first extracted item;
   - `$step<N>.@id`, that item's IRI.

   Steps are numbered from 0, and a step can only refer to an earlier one. `schema:`, `sab:`,
   `xsd:` and `rdf:` CURIEs are accepted. Approval pauses retain structured observations and the
   completed step position. Retrying the same request with its approval resumes that snapshot;
   completed writes are not replayed. Reads supplying money evidence are revalidated on approval
   retry; other completed reads retain their snapshot. Each later write may require another approval.
   A changed request starts a fresh execution. The run stops at the first failing step, with an
   error that names the step. Untrusted fields cannot supply subsequent operation bindings.
8. **Extract.** JSON uses RFC 6901 pointers. HTML uses CSS selectors through `css-select` and
   `htmlparser2`, with the full selector syntax css-select supports, and `""`, `.` or `:scope`
   select the item itself. Output is written as Turtle with `n3.Writer`, using the `schema:`,
   `sab:`, `rdf:` and `xsd:` prefixes. An untrusted field becomes
   `[ a sab:UntrustedText ; rdf:value "..." ]`, including fields with `datatype: "iri"`.
   Untrusted fields cannot supply subject identities. Item IRIs must be http(s).
   Structured items retain RDF kinds in `terms` alongside lexical `values`. Fields declared
   `datatype: "iri"` are WHATWG-normalized before storage, binding and fingerprinting, even
   when bound into an `xsd:string` parameter. Literal text stays verbatim.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Filter selections and target summaries

A learned filter-selected write is available through a resolve/read → write Flow. Its
required, empty-path identity parameter is absent from the explicit body template and
bound to a trusted identity property of the resolver. Both steps bind each search/filter
to the same flow input. These existing Parameter/Flow structures survive RDF round trips;
parameter names and descriptions do not activate this behavior. The underlying write
cannot be invoked directly from an ActionRequest.

Before approval, completeness needs positive evidence: a declared `totalPath` whose observed
count equals the resolved item count, or modeled pagination whose declared starting page matches the actual request and whose
next-page probe returns an explicitly empty collection at the declared JSON root in a 2xx
success response, with the same filters and session. Missing/invalid roots, error envelopes,
HTTP errors and zero HTML selector matches leave completeness unknown. The probe is an ordinary
authorized read and repeats on approval retry. A single row without either proof has unknown
completeness and refuses with `errorKind: "ambiguous-target"`. Both explicit-all and ordinary
selections use this rule.

Until pagination gains a shared contract field, a paging Parameter's description carries the
strict declaration `sab:pagination page start=0 advance=1` (start may also be 1), or
`sab:pagination offset start=0 advance=observed-items`. The profiler emits this only after
witnessing a starting request and its continuation in crawl/demonstration traffic with the same
scope. Defaults alone and ordinary description prose cannot establish semantics. Offset probes
advance by the actual returned item count, including server-capped responses; requested limits
never set the span. No paging value is reset. Old models without a declaration need an observed
total or reprofiling. HTML lists without totals currently cannot establish exhaustion.

Compare every concrete query, form/JSON and path-filter field in both requests. Only declared
paging/sorting parameters and CSRF decoration are exempt. Unrecognized names such as `status`
still participate; names are case-sensitive. Missing or different fields refuse.
Zero matches, partial/truncated results, missing identities and multiple matches return `refused` with `errorKind: "ambiguous-target"`. To deliberately
select every matching item, omit `schema:object` and put `sab:all true` on the action
(`sab:` is `https://jeswr.org/ns/site-action#`; exactly one lexical `true` is required).
This does not permit partial or empty selections or bypass payment checks.

Approvals show up to five resolved names/identifiers, followed by `and N more`. Their
digest includes the full identity set. Approval retries authorize and repeat the resolver
in the current session, using the same filters; a changed identity set refuses the write.
Response ordering does not change the identity set. Completed writes remain single-use.
The exact vault session is checked before revalidation. The executor's own reads may renew
expiry metadata and storage revisions with unchanged credentials; external revision changes
or changed cookie/header credentials require fresh consent. Resolver and write remain separate
HTTP requests, so sites without atomic selection semantics retain a read/write race.
The resolver uses the ordinary origin, session, read gate, extraction and redaction paths;
the write retains Rule W, repeat protection and Uncertain handling.

Every write summary shows the concrete identifying inputs sent (IDs, SKUs and path tokens)
next to the preferred request or trusted bound name. A planner name conflicting with a trusted
resolved/bound identity name refuses with `errorKind: "ambiguous-target"`. Filter selection
summaries include resolved names and identities. Display strings
are quoted, controls and bidi characters escaped, and capped with `(truncated)`, after
redacting the complete value.

## Security invariants

- **Site-model trust.** A site model is trusted input on a par with code. It comes from the
  person's own profiler run or from a signed model. The executor validates its structure and
  applies Rule W below; it refuses whenever payment and total requests differ on the wire,
  apart from the explicitly checked identity and CSRF exemptions. A signature's verification
  belongs to the model-loading host; this package does not authenticate model publishers.

- **Origin guard.** Every operation URL, CSRF page and redirect target is resolved and parsed with
  WHATWG URL, then compared to the model's origin, including scheme and port. Absolute,
  protocol-relative, backslash, userinfo and scheme-change escapes are all refused before
  anything is sent. Parameter-generated dot segments (including encoded forms), reserved values
  that introduce path separators, and URL normalization that changes the modeled route are refused.
  The model's origin must be https; http is allowed only on loopback.
- **Approval binding.** An approval is bound to a SHA-256 digest over the site, model version,
  target, effect, resolved inputs, concrete request, execution position, session fingerprint,
  money fields, every contributing site-fact record, and persona. A retry is accepted only when its
  `approvalId` was issued by this executor for the same digest. The executor claims the approval
  synchronously, so it is single-use even when two retries run concurrently. It also overwrites
  the binding fields of the gate's `ApprovalRequest` with its own values. The executor validates
  model IDs, parameter names, operation references and forward step references at construction,
  and retains an immutable model snapshot.
- **No secrets out.** Results, errors and extracted RDF never carry cookies, session headers or
  CSRF tokens. Errors name only the origin and path, never the query string or the response
  body. Both source secrets and their effective transmitted values are registered after request
  decoration, using the compiled wire inventory and final Fetch headers. This includes multipart
  CRLF normalization, USVString conversion, header trimming and percent-encoded path slots.
  The shared `MIN_REDACTION_LENGTH = 4` floor applies to every credential, regardless of
  classification: values shorter than four characters are guessable, provide no confidentiality,
  and are never registered for redaction. They never suppress samples. The origin guard still
  confines these values to their own site. Registered values of four to seven characters match
  only at token boundaries, outside longer alphanumeric runs; eight or more receive full
  redaction in every supported form. Heuristic, unregistered discoveries retain the eight-character
  floor. Session credential cookies qualify when HttpOnly, set/changed by login, declared by the
  model/vault, or named like session/auth/token/remember/CSRF cookies. Other cookies qualify only
  with a logical payload of at least eight characters. Cookie registration includes wire,
  unquoted, percent-decoded and decoded-unquoted payloads; an encoded or quoted value cannot
  evade the logical payload floor. Raw, trimmed, mixed/nested percent-encoded (including form `+`
  spaces), JSON-escaped and HTML-entity-escaped echoes are redacted before truncation.
  Every complete summary display value, including unmapped object
  names and model labels, is redacted before whitespace normalization, formatting or truncation. Every return path renders all observations against the final
  secret set, including secrets discovered by later steps.
- **Money.** A site that displays one price and charges another cannot be stopped by any client;
  the payment instrument's own limit is the backstop. The executor guarantees only that a payment
  approval shows the site's own unambiguous, fresh, purchase-bound statement of the amount, or refuses.

  For a payment preceded by **any write** in the flow, only a basket/order total read after the
  last preceding write is evidence. Collect every trusted on-origin total record from every read
  in that window: an Order, Invoice, or item with `schema:totalPaymentDue`. Exactly one distinct
  (amount, currency) pair is required; otherwise refuse with "needs one fresh basket total".
  Aggregate amounts and currencies independently across every contributing record, including
  records with only an amount or only a currency, before checking consistency.
  Product prices never supply a fallback after a write. Totals explain the whole basket and need
  not duplicate checkout's product quantities.

  When payment is the flow's **first write** (direct buy), use unit price times the bound quantity,
  with exact decimal arithmetic. Aggregate every trusted on-origin product record whose own
  WHATWG-normalized IRI or identifier of the same type matches the bound purchase identity.
  Require exactly one distinct (price, currency) pair across all matching records. SKU, productID
  and identifier stay distinct; untyped suffixes cannot establish identity. A referenced
  `schema:object` never supplies a product's own identity. Conflicting purchase bindings refuse.

  If payment binds `schema:orderNumber`, `schema:identifier`, or an order/basket IRI through
  `schema:object` / `schema:referencesOrder`, each contributing total must carry that same identity.
  Different identifiers refuse; empty identity lists never count as a match. An unbound checkout
  may use the fresh basket total read in its own flow.
  Aggregate orderNumber, identifier and normalized own IRI claims across all records of the
  selected order, including identity-only records and records linked by those typed identities
  that do not repeat the Order/Invoice type. Contradictory claims refuse even when the payment
  does not explicitly bind that identity. Identity-only records and their source reads join the
  approval digest and retry revalidation; changing them invalidates the previous consent.

  Payment and total evidence consumes original plain decimal lexicals and an explicit model
  currency. Formatted prices such as `$12.00` and `1.234 €` remain display-only, even on complete
  lists, and cannot authorize payment. Extraction's structured `values`/`terms` preserve original
  monetary lexicals (including numeric JSON spellings); presentation conversion is retained
  separately for rendering.

  **Rule W — closed-world wire coverage.** Compare payment P with each total read Q that
  contributed the single fresh amount/currency pair, using the concrete compiled requests after
  template expansion and CSRF insertion:

  | Rule | Required behavior |
  |---|---|
  | W1 — inventory | Every query, form/multipart field, JSON member (RFC 6901 pointer), path variable and model header (static, parameter or CSRF). Header provenance is recorded at compilation; only executor/session headers are excluded. Multipart inventory describes serialized fields, including CRLF normalization; an LF quote and CRLF payment differ and refuse. Header names compare case-insensitively; query, form, JSON and path names compare case-sensitively. Canonical values compare exactly. A JSON `/delivery` differs from query/form `delivery`. |
  | W2 — duplicates | Refuse repeated names within P or Q across all locations, including session path tokens. |
  | W3 — payment coverage | Each P field has the same name/value in Q, is a whole checked order/basket identity matching the total, or is P's unique CSRF/session path token. Token names cannot occur elsewhere in P or anywhere in Q, including another token. Otherwise refuse "payment sends <name>, which the basket total did not cover". |
  | W4 — reverse coverage | Each Q field has the same name/value in P, except whole identities checked against the selected order and decorated session path tokens. Duplicate checks still apply. |
  | W5 — direct buy | Only whole bound product identity, whole bound quantity multiplied into the amount, and unique CSRF/session path decoration. Static submit values and wire money fields require a fresh matching total. |
  | W6 — truncation | Refuse item/value truncation in any money- or identity-capable read for the selected order/product, including identity-only reads. |
  | W7 — trust | The model is trusted like code; validate its structure and refuse differences on the wire except these explicit exemptions. |

  Keep the whole-value invariant for bound payment inputs: unused, embedded, duplicated and
  transformed uses (including URI prefix modifiers) refuse. Configuration matching never uses
  parameter names or semantic paths: only the effective wire fields establish coverage. A static
  literal is allowed only when covered by Q. The evidence digest retains the total requests'
  actual wire inventories; their source reads are repeated on approval retry. Payment CSRF reads
  are authorized as reads before payment consent so Rule W sees the decorated request, and repeat on retry.

  Bind every contributing record's subject, raw amount/currency values, typed identity, source
  read and quantity in the approval digest. Re-read every contributing source on approval retry;
  changed evidence invalidates consent without replaying completed writes. Untrusted fields,
  off-origin reads/items and observations from separate actions cannot authorize money.
  Every contributing partial record is bound and its source is re-read too. If any money- or identity-capable
  read in the evidence window reports item or value truncation, evidence is incomplete and
  payment is refused, even when the retained items do not match the purchase identity.
  Wire monetary mappings remain strict cross-checks (whole values, sent exactly once, exact JSON
  numeric representation); they cannot establish payment money by themselves. The planner's
  price is a cap, never evidence: above-cap or different-currency site facts refuse without approval.
  Mixed payment currencies fail closed and the gate sees cumulative flow spending. Earlier write
  approvals may show a product quote; payment still needs its own evidence under these rules.
- **Limits.** `maxRequests` (default 25, cumulative across an approved flow), `maxRedirects`
  (default 5), `maxResponseBytes` (default 5 MiB), `maxExecutionMs` (default 30,000 per execute call).
  The absolute deadline covers fetch, redirects, CSRF reads and body consumption, aborts requests
  and cancels readers; expiration returns `errorKind: "limit"`. Extraction keeps at most 200 items
  (limited before item materialization, detecting one extra HTML match) and 4000 characters per emitted value.
  `ExtractOutput.truncation` reports `{ items, values }`; truncation never silently authorizes money.
  Each extraction also enforces 100 values per field, 1000 total values, 3000 quads and 1 MiB of Turtle. Exceeding
  any value, quad or output budget fails extraction. The standalone `extract` options can tune
  `maxValuesPerField`, `maxTotalValues`, `maxQuads`, and `maxOutputBytes`; its result also offers
  `render(redact)` for rendering the retained structured values with an updated redactor.

These stricter checks intentionally refuse formerly accepted malformed models, unbound payments,
unsafe routes and invalid flow inputs. Forbidden model headers that were previously silently dropped now refuse at construction/compilation;
header parameter errors also occur before input resolution. Previously retained model Accept headers
are invalid and fixtures/profiler output omit them. Multipart LF/CRLF differences now refuse.
The shared site-model TypeScript contract is unchanged; the additive executor result/session APIs are described above.

## Tests

`pnpm --filter @jeswr/site-executor test` runs the suite. The tests use their own fixture shop on
127.0.0.1 (a JSON API, HTML pages, a cookie session and CSRF) and a second "attacker" origin.
When sandbox socket binding is prohibited, the same fixture handlers run through an in-memory
Fetch transport. The security regressions use injected in-memory transports throughout. They
cover RFC 6570 vectors, origin escapes, each CSRF source, approval binding (changed inputs,
single use, concurrent retries, forged ids), flow binding, untrusted marking and secret
redaction. Money regressions also cover caps, currencies, trusted/on-origin fact selection,
total preference, exact quantity multiplication and price/item changes during approval.

Review round 2 regressions live in `test/review-r2.test.ts`: conflicting evidence and approval
binding (finding 1), typed collisions and fallback ambiguity (2), total freshness and purchase
binding (3), checkout quantity coverage (4), committed writes and uncertain receipts (5),
canonical request fingerprints (6), and summary redaction before display transformations (7).
The same suite covers session revision passthrough and safe `no-path.missing` diagnostics.

Round 3 regressions are in `test/review-r3.test.ts`: duplicate products across reads and retry
binding (#1), referenced-object identity borrowing (#2), typed order/IRI mismatch (#3), mandatory
post-write totals (#4), 5xx/reset/timeout commitment (#5), scalar blank nodes and normalized IRIs
(#6), plus accepted/rejected session revision handoff. Agent-browser covers repeat blocking and
explicit `allowRetryOf` recovery for uncertain writes.

Round 4 regressions are in `test/review-r4.test.ts`: partial monetary claims and source retries (#1),
bounded item overflow and value truncation (#2), total/payment configuration and direct-buy options (#3),
payment-flow construction and per-step effects (#4), and response IRI kinds and repeat fingerprints (#6).
Agent-browser's `test/review-r4.test.ts` covers preservation of committed/uncertain results and repeat
blocking after auxiliary session-refresh failures (#5).

Round 5 regressions are in `test/review-r5.test.ts`: payment-side whole-value transmission for
quoted options and checked identities, static shadowing across JSON/query/form/multipart,
direct-buy quantities, and payment-only submit literals (now refused by Rule W) (#1); contradictory identity-only
order records, evidence-digest inclusion and revalidation of identity-only sources (#2).
Unsafe payment configurations now return `refused` before payment approval or transmission.

Rule W regressions live in `test/review-r6.test.ts`: static delivery headers, case-aliased CSRF
headers, hard-coded total queries, swapped parameter values, truncated identity-only reads,
all field locations, duplicate names, reverse coverage, checked identities, canonical values,
direct-buy restrictions and trusted-model structure validation. Earlier tests now refuse
payment-only submit literals and direct-buy wire money, semantic-path aliases with different
wire names, and query versus JSON-pointer name differences. Receipt, commitment and retry fixtures use requests covered by
Rule W so their original behavior assertions remain exercised.

Agent-browser's `test/wire-checkout.test.ts` learns operations and a buy flow from demonstration
records and a CSRF-bearing checkout form, round-trips the model through RDF, and executes the
shared-delivery total/payment requests over an injected transport. It asserts "for GBP 20.00"
and exactly one checkout. The real browser e2e remains a separate loopback/Chromium check.

## Session-protected JSON lists

Read actions may include `sab:operation "search-people-json"` (or a full operation IRI) to select a
known catalogue entry. `schema:object [ a schema:Person ]` also narrows reads by extraction type.
No selector means the existing match-count and ambiguity behavior. This local request convention
uses the existing ActionRequest.values API; no shared contract change is required.

CSRF query targets also support an existing-contract convention for tokens in URL paths: when the
target name identifies exactly one otherwise-unbound simple `{name}` occupying a whole path
segment, compilation reserves that slot and session decoration fills it after authorization.
It is not a planner input. Embedded/reserved/duplicate slots, collisions with inputs, route
separators (including nested encodings), and dot segments refuse. Cookie, HTML, meta and JSON
sources use the existing origin-guarded machinery. Tokens remain excluded from fingerprints and
results. A first-class path target could replace this convention in a future coordinated contract
revision; this implementation leaves the contract unchanged.

Form field names encoded as RFC 6570 variable names are decoded once on the form wire, preserving
bracketed credential fields. A signed-in operation that receives an HTML password form with HTTP
200 returns `errorKind: "no-session"`, rather than an empty successful observation. Unit and
adversarial cases are in `test/session-reads.test.ts`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Paged display facts and redirected write identities

An extraction's optional `totalPath` reads a safe integer from the response root (JSON pointer)
or one HTML selector. One ItemList carries numberOfItems; `sab:partial true` and
`truncation.items` mark unseen rows. Invalid totals fail extraction. Counts and display totals
are not payment evidence; the existing Money/Rule W checks remain unchanged.

List row price/totalPrice text is normalized to xsd:decimal only with a row currency-code fact;
symbols alone do not establish currency. ISO-like creation/modification timestamps become
xsd:dateTime (a space separator becomes T; no timezone is invented). Other strings stay text.
Untrusted fields remain untrusted and secret redaction precedes presentation conversion.
Endpoint-described refund records use Thing plus additionalType text, never Invoice/category.

A 301/302/303 write redirect supplies a created identity only with a declared created-location
pattern matching the first Location, every subsequent hop staying on that exact resource, and
no destination matching a declared error/validation pattern. Declared final success evidence
must also pass. Otherwise the result is Uncertain, has no identity facts or later bindings, and
retains its repeat fingerprint. The POST is sent once; redirects use GET.

The shared SiteModel contract has no created-location or success-evidence fields. Until a
coordinated contract extension, declare these locally through executor option `writeResponses`,
keyed by write operation ID, and persist them separately from model RDF:

```ts
writeResponses: {
  "urn:create": {
    createdLocationPattern: "/products/id/{id}",
    errorLocationPatterns: ["/errors/validation"],
    extraction: {
      format: "json", itemType: "https://schema.org/Product",
      fields: [
        { property: "https://schema.org/identifier", path: "/id" },
        { property: "https://schema.org/name", path: "/name" },
      ],
    },
    inputEvidence: { input: "name", property: "https://schema.org/name" },
    success: { format: "json", path: "/saved", value: "true" },
  },
}
```

Patterns are on-origin paths/URLs with whole-segment variables. HTML success checks use
`{ format: "html", selector, attribute?, value? }`; without `value`, the element must exist.
No declaration means a redirect cannot supply an identity and the write is Uncertain.
The profiler learns these declarations from witnessed demonstrations and returns `writeResponses`
beside its model. Forward that result directly instead of writing host-specific patterns.
Learned policies can also require `redirectCount` (exact witnessed hop count), `finalStatus`
(the witnessed 2xx status). Created identities require `extraction` (one main item of the
operation's object type), or `readBack`, and `inputEvidence` (a submitted input matching an item field). These checks
add evidence requirements; the first-Location, same-resource and origin rules still apply.

Review r7 regressions are in the `review r7` groups of `test/review-r6.test.ts`: executor-owned
headers through all three routes, static/direct-buy/header-parameter Accept and Accept aliases,
derived extraction Accept, actual serialized form inventories, multipart newline mismatches,
and path tokens on payment, total, both, and direct buys with collision refusals. Shared validation
also tests the one unbound whole-segment CSRF slot and every other undeclared-variable refusal.

Review r8 regressions are in `test/review-r8.test.ts`: source and serialized token echoes across
header, form/multipart, JSON, query and path targets; trusted and untrusted RDF; approval summaries,
results and errors; observations retained across approval pauses; vault headers; common echo
encodings and registered short-secret redaction. Transports inspect serialized `Request`
objects to verify the effective token values.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
`secretRedactor(secrets)` is also exported as a read-only utility for browser snapshot consumers.
The executor, profiler, host and fallback share this normalization-aware implementation,
including HTML entities and mixed plus/percent form encodings. `isSessionCredentialCookie` and
`registerCookieSecrets` share classification and wire/unquoted/decoded/decoded-unquoted
registration; `CookieSecretContext` accepts model, login and vault declarations.
`SessionBundle.credentialCookies` supplies vault-declared names and survives session updates.
Both vault-cookie and response-cookie intake union the host `credentialContext.model`'s
login/CSRF declarations with the executor model, preserving `declaredNames`,
`loginCookieNames`, vault declarations and the host's shared `secrets` set.
`registerSecret` applies the shared `MIN_REDACTION_LENGTH` floor at each credential intake;
`secretRedactor` enforces the same floor for callers supplying their own sets.

Round 9 regressions: `test/selection.test.ts` covers unknown completeness, pagination probes,
scope mismatches and conflicting names; `test/review-r9.test.ts` covers concrete summary IDs,
complete display-money lists, redirect policies, short credentials, retained samples below the registration floor, cookie
payloads and mixed encodings. `test/list-quality.test.ts` also verifies the formerly masked
complete display-payment case. Rule W cases in `test/review-r6.test.ts` retain coverage with
case-sensitive query/form/JSON/path names.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
HTML form templates also allow numeric identity placeholders in URL-encoded form field names
and form CSRF target names. HTML CSRF selectors allow placeholders containing only ASCII letters,
digits, underscores and hyphens, so learned route slugs cannot introduce CSS syntax. Missing or
invalid substitutions refuse before transmission. The expanded names enter the ordinary wire
inventory, fingerprint, token collision checks and approval binding; form values remain encoded
structurally. This small compiler extension supports forms whose names contain an item ID.
`test/form-identities.test.ts` covers denial, one approved POST, repeat protection and injection.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
For an HTML CSRF source, effectful requests send the actual guarded form page's final URL as
executor-owned Referer (without a fragment). This preserves native form redirect behavior after
a canonicalizing page redirect. Models still cannot set Referer, and created-location checks,
approval binding, fingerprints and one-POST redirect handling remain in force.
Learned extraction identities may use on-origin permalink aliases within the declared route or
its trailing display-slug alias; equal IDs on unrelated routes and conflicting identity claims
are rejected. `matchesCreatedIdentity` shares that check with the profiler.

For a form served at an identity alias, the learned policy's extraction may resolve its single
matching on-origin canonical permalink for Referer. The permalink must fit the learned route
and the guarded form's identity; unrelated or ambiguous links never become request context.

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

<!-- AUTHORED-BY Codex GPT-6 -->
Not-found signatures preserve exact scalar values for discriminator keys (status, code,
error, error_code, type, reason and compound variants) at any depth, plus HTML titles
and headings. The shared failure predicate and signature generator use the exported
`isDiscriminatorKey` predicate, including `HTTP_Status`, `error_code`, `statusCode` and
`errorType` without case or separator distinctions. Authentication markers include
`not_authenticated`, `forbidden` and `restricted`, plus numeric or numeric-string values
401, 403, 407, 419 and 440 under every discriminator key. These
404 responses leave a deletion Uncertain; an honest matching not-found still verifies.
`test/response-evidence.test.ts` covers discriminator and heading preservation.
