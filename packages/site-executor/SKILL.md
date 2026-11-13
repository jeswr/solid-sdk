---
name: site-executor
description: Use when working on @jeswr/site-executor, the semantic agent browser's executor that compiles an RDF action request into a site's own HTTP calls behind an approval gate.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

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
  headers. Exclude only session/vault and Content-Type, Content-Length, Accept, Cookie, Origin,
  Referer headers. Compare names case-insensitively and canonical values exactly. Refuse duplicate
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
- Register every nonempty cookie/header/token. Normalize mixed/nested percent encoding for
  redaction, redact before truncating, and re-render every observation with the final secret set
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
