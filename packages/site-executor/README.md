<!-- AUTHORED-BY Claude Opus 5.5 -->

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
if (result.status === "needs-approval") {
  // show result.approval.summary, e.g. "Buy Trail Runner sneakers for GBP 20.00 on shop.test"
  gate.approve(result.approval.id);
  result = await executor.execute(request, { approvalId: result.approval.id });
}
// result.observations[i].turtle holds the extracted graph
```

- `createExecutor({ model, sessions, gate?, fetch?, now?, persona?, maxRequests?, maxRedirects?, maxResponseBytes? })`
- `execute(request, { approvalId? })` returns `{ status, target?, observations, approval?, error?,
  errorKind?, candidates?, requests }`. `status` is one of `done`, `needs-approval`, `denied`,
  `no-path` (the host should use the fallback browser), `ambiguous` (see `candidates`) or `error`.
- `planToRequests(request)` (a method, and a standalone `planToRequests(model, request)`) is a dry
  run. It returns the compiled requests and sends nothing. Flow step references show up as
  placeholders, and a plan never contains credentials.
- `SessionProvider` is `{ get(site, persona?), update(site, persona, bundle) }`.
  `SessionBundle = { cookies: Cookie[]; headers? }`. `Cookie` uses the shape of Playwright's
  `context.cookies()`, with `expires` in Unix seconds. `InMemorySessions` is the in-memory
  implementation.
- `Gate` is `{ authorize(GateRequest) }`. It returns `allow`, `ask` with an `ApprovalRequest`, or
  `deny`. A `GateRequest` carries the target, the effect class, the resolved inputs, any money
  fields (`amount` and `currency`, read from `schema:price`, `schema:offers`,
  `schema:priceSpecification`, `schema:amount` and similar), a plain-English summary and the
  binding digest. A host can build standing spending limits by returning `allow` without asking.

## Behaviour

1. **Match.** Flows are tried first, then operations. A candidate must have the same action type
   (`http://schema.org/` is read as `https://schema.org/`), and every required input must resolve
   through `Parameter.path` or a default. When several candidates match, the one that resolves the
   most inputs from the request wins, and a tie returns `ambiguous`. A class-ranged parameter takes
   the node's `schema:sku`, `schema:productID` or `schema:identifier` when present. Otherwise it
   uses the last path segment of the IRI. A blank node without an id property does not resolve.
2. **Gate.** The executor computes the effect it reports to the gate. For a flow, this is the
   strongest of the flow's declared effect and each step's effect. An unknown effect counts as
   `payment`. Before calling the gate, the executor loads the session and checks that every step
   it needs exists, so a missing sign-in does not use up an approval.
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
   `xsd:` and `rdf:` CURIEs are accepted. The run stops at the first failing step, with an error
   that names the step.
8. **Extract.** JSON uses RFC 6901 pointers. HTML uses CSS selectors through `css-select` and
   `htmlparser2`, with the full selector syntax css-select supports, and `""`, `.` or `:scope`
   select the item itself. Output is written as Turtle with `n3.Writer`, using the `schema:`,
   `sab:`, `rdf:` and `xsd:` prefixes. An untrusted field becomes
   `[ a sab:UntrustedText ; rdf:value "..." ]`. Item IRIs must be http(s).

## Security invariants

- **Origin guard.** Every operation URL, CSRF page and redirect target is resolved and parsed with
  WHATWG URL, then compared to the model's origin, including scheme and port. Absolute,
  protocol-relative, backslash, userinfo and scheme-change escapes are all refused before
  anything is sent. The model's origin must be https; http is allowed only on loopback.
- **Approval binding.** An approval is bound to a SHA-256 digest over the site, model version,
  target, effect, resolved inputs, money fields and persona. A retry is accepted only when its
  `approvalId` was issued by this executor for the same digest. The executor claims the approval
  synchronously, so it is single-use even when two retries run concurrently. It also overwrites
  the binding fields of the gate's `ApprovalRequest` with its own values.
- **No secrets out.** Results, errors and extracted RDF never carry cookies, session headers or
  CSRF tokens. Errors name only the origin and path, never the query string or the response
  body. Known secret values, and their URL-encoded forms, are redacted from extracted values when
  a hostile site echoes them back.
- **Limits.** `maxRequests` (default 25), `maxRedirects` (default 5), `maxResponseBytes` (default
  5 MiB). Extraction keeps at most 200 items and 4000 characters per value.

## Tests

`pnpm --filter @jeswr/site-executor test` runs the suite. The tests use their own fixture shop on
127.0.0.1 (a JSON API, HTML pages, a cookie session and CSRF) and a second "attacker" origin. They
cover RFC 6570 vectors, origin escapes, each CSRF source, approval binding (changed inputs,
single use, concurrent retries, forged ids), flow binding, untrusted marking and secret
redaction.
