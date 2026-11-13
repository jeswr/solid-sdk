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
  implementation. Revisions are opaque: every cookie update in an execute call passes the exact
  revision returned by its `get()`. InMemorySessions issues a new session generation on `set()`;
  cookie updates retain that generation, and stale updates are silently ignored.
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
Terminal errors, refusals and denials use `uncertain` when a write already received a 2xx/3xx
response; otherwise they use `failed`. Reads and approval pauses have no outcome. Every result
includes `committed: { target: Target, fingerprint: string }[]`, including pauses and failures.
Each entry identifies an operation whose write received 2xx/3xx, recorded before cookies, redirects,
body consumption or extraction. A later failure never removes these entries. Hosts must not
repeat those writes merely because the overall execution failed.
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
   name/search inputs still need their mapped values: an object IRI cannot supply its name.
   `no-path.missing` identifies those inputs without exposing URLs, defaults or binding specs.
2. **Gate.** The executor computes the effect it reports to the gate. For a flow, this is the
   strongest of the flow's declared effect and each step's effect for writes. Preparatory flow
   reads are authorized separately as reads. Every write is compiled and authorized immediately
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

## Security invariants

- **Origin guard.** Every operation URL, CSRF page and redirect target is resolved and parsed with
  WHATWG URL, then compared to the model's origin, including scheme and port. Absolute,
  protocol-relative, backslash, userinfo and scheme-change escapes are all refused before
  anything is sent. Parameter-generated dot segments (including encoded forms), reserved values
  that introduce path separators, and URL normalization that changes the modeled route are refused.
  The model's origin must be https; http is allowed only on loopback.
- **Approval binding.** An approval is bound to a SHA-256 digest over the site, model version,
  target, effect, resolved inputs, concrete request, execution position, session fingerprint,
  money fields, the source item of any site-fact money evidence, and persona. A retry is accepted only when its
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
- **Money.** Establish a payment's amount and currency from wire mappings or trusted facts from
  an earlier read in the same flow. For wire mappings, map
  `Parameter.path` to `schema:price`, `schema:amount/schema:value`, `schema:totalPaymentDue/schema:value`
  (or `schema:amount`), and `schema:priceCurrency` or `schema:currency`. A flow may instead supply
  those semantic mappings through `$input` paths or trusted `$stepN` properties. These mappings
  take precedence; disagreement with trusted site facts refuses execution. Monetary mappings must
  reach the wire once as whole values; unused, duplicated or
  transformed mappings and numeric amounts that round during JSON conversion are refused.
  Facts come only from extracted fields whose `FieldRule` is not `untrusted`, on the site origin
  (off-origin item IRIs are ignored too). They pair `schema:price`, `schema:amount`, `schema:totalPaymentDue` or
  `schema:value` with `schema:priceCurrency` or `schema:currency` on the same item. Prefer a fresh
  basket/checkout total (an `Order`, `Invoice`, or item with `totalPaymentDue`) read after the last
  write of any effect class preceding payment. Distinct totals in that window refuse, including
  conflicting basket identities or quantities. If payment itself binds quantity or an item,
  the total must carry the same `schema:orderQuantity` and typed item identity; otherwise fall
  back to a matching product price times quantity, or refuse with "needs a fresh basket total".
  On the selected item all amount and currency values must agree; conflicts return `refused`
  with a reason naming the conflict. All raw values of that pair enter the approval digest.
  Identities are typed: request IRIs compare exactly after WHATWG normalization, SKU only to
  `schema:sku`, productID only to `schema:productID`, identifier only to `schema:identifier`.
  Identifier-free wire IDs may use an IRI suffix only for one on-origin item; a second candidate
  matching any identifier type refuses as ambiguous. Every quantity-bearing write must be
  explained by the amount, including checkout writes without IDs. Unrelated quantities or
  multi-product changes require a fresh total. `schema:orderQuantity` and `sab:quantity` use
  exact decimal arithmetic. Mixed payment currencies fail closed.
  Preparatory reads run as separately authorized reads before any write approval, so even an
  add-to-basket approval in a payment flow displays the site's real amount, such as
  "Buy Trail Runner sneakers for GBP 20.00 on shop.test". Approvals bind the facts' amount,
  currency, every pair value and source item. Retrying re-reads all contributing sources and recompiles the next write; a change
  invalidates the approval and asks again, without replaying completed writes.
  Planner money is a cap and cross-check, never evidence: site facts above its cap or in a
  different currency return `refused` with a safe reason stating the site's real price, without
  offering approval. An omitted planner price is allowed when site evidence establishes money.
  Existing wire-only planner cross-checks remain strict. Payments without either source are
  `refused` even by an allow-all gate. Observations from a separate action cannot authorize money.
- **Limits.** `maxRequests` (default 25, cumulative across an approved flow), `maxRedirects`
  (default 5), `maxResponseBytes` (default 5 MiB), `maxExecutionMs` (default 30,000 per execute call).
  The absolute deadline covers fetch, redirects, CSRF reads and body consumption, aborts requests
  and cancels readers; expiration returns `errorKind: "limit"`. Extraction keeps at most 200 items
  (limited before item materialization) and 4000 characters per emitted value. Each extraction
  also enforces 100 values per field, 1000 total values, 3000 quads and 1 MiB of Turtle. Exceeding
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
