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
- Derive money from wire-mapped operation/flow inputs or trusted extracted facts from earlier
  reads in the same flow. Recognize schema price/amount/value/totalPaymentDue and currency mappings.
  Prefer a same-origin Order/Invoice/totalPaymentDue total read after the last reversible write;
  otherwise match a product's SKU/id or IRI to concrete write inputs and multiply its unit price
  by the bound quantity. Ignore untrusted fields and off-origin items/read provenance. Never use
  observations from another action. Wire money wins; disagreement with facts refuses execution.
  Planner money is only a cap/cross-check: fact totals above the cap or currency mismatches return
  `refused` with the site's real price and no approval. Missing planner money is allowed when the
  site establishes it; missing both evidence sources fails closed. Keep strict wire-only checks.
  Run preparatory reads before write approval so each summary shows the real price. Bind facts'
  amount/currency/source item in the digest and re-read that source on approval retry. A change
  voids approval and re-asks; never replay completed writes. Other reads retain their snapshot.
  Unit price times schema:orderQuantity (or profiler sab:quantity) and cumulative flow payments
  use exact decimals; the gate sees the cumulative total. Verify each wire monetary input reaches
  the request once as a whole value; refuse unused/transformed/duplicate bindings and JSON number
  rounding. Facts need not be sent as price fields: real checkouts derive prices from the basket.
  Never authorize from moneyFields alone.
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

The execute/approval methods remain unchanged; callers must handle `refused`, multiple approvals
per flow, and supply payment wire mappings or trusted flow reads. README documents the intentional
refusals and the additive deadline and extraction budget options. Tests use the in-memory fixture fallback when
127.0.0.1 socket binding is unavailable.
