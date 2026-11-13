<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

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
than the planner's spending cap. When the final extraction or a write's 303 Location
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
   and their `options`. Static headers from the model cannot set `Cookie`, `Authorization`,
   `Host`, `Origin`, `Sec-*` or framing headers. Header values containing control characters are
   rejected.
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
  body. Every nonempty secret is registered. Raw, mixed percent-encoded and nested encoded echoes
  are redacted before truncation. Every complete summary display value, including unmapped object
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

  **Rule W — closed-world wire coverage.** Compare payment P with each total read Q that
  contributed the single fresh amount/currency pair, using the concrete compiled requests after
  template expansion and CSRF insertion:

  1. Inventory every query parameter, form/multipart field, JSON body member (named by its
     RFC 6901 pointer), URL path variable (named by its template variable), and model-supplied
     request header: static, parameter and CSRF headers. Include static body/query literals.
     Exclude session/vault headers and executor transport headers `Content-Type`, `Content-Length`,
     `Accept`, `Cookie`, `Origin` and `Referer`. Names compare case-insensitively; values compare
     exactly after the existing typed canonicalisation. JSON pointers retain their leading `/`:
     a JSON `/delivery` member is distinct from a query/form `delivery` field.
  2. Refuse any name occurring more than once within P or within Q, across all locations.
  3. Every P field must have the same name/value in Q, be the target of P's CSRF rule, or be a
     whole, checked order/basket identity matching the total record. A CSRF name must not occur
     in Q or elsewhere in P, including case aliases. Otherwise refuse with
     "payment sends <name>, which the basket total did not cover".
  4. Every non-identity Q field must also occur in P with the same name/value. An identity
     exemption requires a whole value checked against the selected order's records.
  5. For a direct buy (payment is the first write), every P field must be the whole bound
     product identity, the whole bound quantity multiplied into the amount, or the unique CSRF
     token. Even static submit values and wire amount/currency fields need a fresh matching total.
  6. Refuse item or value truncation in any read capable of supplying money or identity evidence
     for the selected order/product, including separate identity-only reads. The incomplete
     tail cannot prove the absence of a conflicting identity or price.

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
unsafe routes and invalid flow inputs. The shared site-model TypeScript contract is unchanged; the additive executor result/session APIs are described above.

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

A 301/302/303 write redirect can provide a result identity, extending the existing 303 behavior.
When no extraction is declared, a checked numeric/UUID identifier in the server's on-origin
redirect becomes trusted identifier/url facts and a result receipt. This also supplies flow
bindings from a JS-rendered form. Secret-bearing URLs, off-origin targets and non-ID routes do
not supply identities. The POST is sent once; only GET follows the redirect. Approvals,
commitment/repeat guards, CSRF decoration and payment rules retain their existing boundaries.
