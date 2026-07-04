# `@jeswr/guarded-fetch`

> Experimental, AI-agent-generated. SSRF / DNS-rebinding-guarded `fetch` for the `@jeswr` Solid
> suite. **Security-critical** — a behaviour regression is a CVE.

A `fetch`-shaped guard for dereferencing an **attacker-influenceable URL** (a user/config-supplied
remote origin: a federation registry/storage document, a community-feed source, an LDN cross-pod
delivery target, a WebID profile). It consolidates the suite's three divergent SSRF-guard copies
(`federation-client`, `solid-community-feeds`, `solid-agent-notify`) and the prod-solid-server
`@pss/guarded-fetch` reference into one exhaustively-tested implementation that is a strict
**superset** of every defence any one of them had.

## Why not just use a maintained SSRF library? (the replace-vs-harden evaluation)

"SSRF-safe fetching is a common server need — why roll our own instead of using a well-maintained
library?" is the right question, so it was answered with a rigorous, *verified* evaluation BEFORE any
custom code was kept. The short answer: **for the IP-literal classification we DO use a maintained
library ([`ipaddr.js`]) — we do not hand-roll that. For the connection-layer protection on the
suite's HTTP path (native `fetch` / undici), no maintained library is adoptable, because every
maintained SSRF filter is an `http.Agent` subclass and the suite uses undici's `Dispatcher`, which
`http.Agent` is not.** Empirically: <!-- claim-ok: the undici-rejects-http.Agent result is reproduced by a committed characterization test (test/node.test.ts → "replace-vs-harden evidence — undici Dispatcher vs http.Agent") — verified, not asserted -->

```text
fetch('https://…', { dispatcher: new RequestFilteringHttpsAgent() })
  → TypeError: fetch failed   (cause: agent.dispatch is not a function)
```

### The candidate matrix (each criterion VERIFIED against primary sources, 2026-06)

The five criteria are the ones where naive SSRF libraries actually fail. ① full block-set
(private/loopback/link-local/IPv6-ULA/IPv4-mapped/`0.0.0.0`/CGNAT/**metadata 169.254.169.254**);
② **DNS-rebinding/TOCTOU defence** — does it PIN the connection to the validated IP, or re-resolve
at connect (the make-or-break criterion); ③ redirect re-validation; ④ surface (`http.Agent` vs
**undici `fetch` dispatcher**); ⑤ supply-chain fit.

| Library (latest) | ① block-set | ② rebinding **pinning** | ③ redirects | ④ surface | ⑤ supply chain | Verdict |
|---|---|---|---|---|---|---|
| **`request-filtering-agent`** 3.2.0 | YES — `ipaddr.js` `range()!=="unicast"`, blocks meta `0.0.0.0`/`::`, + allow/deny CIDR lists | **YES** — injects a validating `lookup` into `net.connect` (no re-resolve = pinned), validates **all** records when `all:true`, blocks direct-IP `host` | NO — out of scope (it is only an Agent; the caller must re-validate hops) | **`http.Agent`/`https.Agent` ONLY — NOT undici/native-`fetch`** (`agent.dispatch is not a function`; undici support is the open, unbuilt [issue #23]) | MIT, **2-node graph** (`+ipaddr.js`), 248k dl/wk, OSV-clean, OpenSSF 5.3, SLSA-attested, active (3.0→3.2 across 2025-08…12) | **The strong one — but unusable on the undici path.** Its connection-layer technique is exactly what `./node` reimplements on the undici seam. |
| `ssrf-req-filter` 1.1.1 | YES — `ipaddr.js` `range()` | **NO** — `socket.on('lookup')` + `socket.destroy()` **observe-and-destroy** (racy TOCTOU), validates only the **single** lookup-event record | NO | `http.Agent` only | MIT, OSV-clean, 38k dl/wk, **stale** (last publish 2024-05) | Reject — non-pinning + single-record + http.Agent-only. |
| `ssrf-agent` 1.0.5 | **NO** — uses the legacy `ip` package (`isPrivate`), CVE-bypassable (`127.1`, `::ffff:127.0.0.1`, octal) | NO — observe-and-destroy on a CVE primitive | NO | `http.Agent` only | **`ip@^1.1.5` carries HIGH [CVE-2024-29415] (GHSA-2p57-rm9w-gvfp)**, dead (86 dl/wk, 2022) | Reject — pulls a HIGH-severity SSRF CVE transitively. |
| `ssrf-agent-guard` 0.1.14 | partial — `ipaddr.js` + `is-valid-domain` | undocumented "rebinding detection" flag, opaque | NO | `http.Agent` (node-fetch `{agent}`, not undici `{dispatcher}`) | MIT, **23 dl/wk** (unproven), extra dep | Reject — too new/unproven, no undici, opaque mechanism. |
| `nossrf` | partial | **NO** — resolves via Google DoH then **re-resolves** at fetch (independent-resolver rebinding bypass; advisory <1.0.4) | NO | wrapper | advisory-laden | Reject — structurally rebinding-bypassable. |
| **undici built-ins** | n/a | — | — | undici interceptors (`redirect`/`retry`/`dns`/…) | the `dns` interceptor only **caches** lookups — no IP validation | **No SSRF interceptor exists** ([open undici #2019]); nothing to adopt on the native path. |
| **[`ipaddr.js`]** 2.4.0 | the classifier itself — `range()` covers loopback/private/linkLocal/carrierGradeNat/uniqueLocal/ipv4Mapped/6to4/rfc6052/reserved/unspecified | n/a (a classifier, not a fetcher) | n/a | pure-JS primitive | MIT, **zero-dep**, **108M dl/wk**, OSV-clean | **ADOPTED** — the IP-literal parse/range/embedded-v4 extraction. We do NOT hand-roll this. |

### The decision (applying the suite's replace-vs-harden rubric honestly)

1. **ADOPT `ipaddr.js`** for IP parsing + range classification + embedded-v4 byte extraction
   (`src/addresses.ts`). It is the same primitive the maintained agents themselves use, it is the
   strongest one (the legacy `ip` package is CVE-laden — see the matrix), and hand-rolling IP
   classification is exactly what this rubric forbids.
2. **KEEP a custom connection-layer guard** — but with the precise, per-candidate reason, which IS
   the maintainer's answer:
   - **No maintained library targets the suite's HTTP path.** The suite is native `fetch`/undici;
     every maintained SSRF filter (`request-filtering-agent`, `ssrf-req-filter`, `ssrf-agent`,
     `ssrf-agent-guard`) is an `http.Agent` subclass, and an `http.Agent` cannot be a
     `fetch(url, { dispatcher })` (proven above + by a committed test). undici ships no SSRF
     interceptor (open undici #2019), and `request-filtering-agent`'s undici support is an open,
     unbuilt proposal (issue #23).
   - **The strongest lib (`request-filtering-agent`) and our `./node` entry use the identical
     pinning technique** (inject a validating `lookup` so `net.connect` dials the pre-validated IP
     and never re-resolves). We reimplement that ~25-line technique on undici's `Agent({ connect:
     { lookup } })` seam — the only seam the suite's HTTP path exposes. So this is not "rolling our
     own SSRF library"; it is the *one* connection-hook the maintained lib would itself need if it
     supported undici.
   - **The rebinding-vulnerable libs are vulnerable for a verified reason** (observe-and-destroy
     races; single-record validation; CVE-laden `ip`) — so even an `http.Agent`-only deployment
     would not want them.
3. **KEEP the small custom POLICY layer** — no library encodes the suite's posture (https-only,
   no-userinfo, production port-gate, cloud-internal hostname denylist, redirect re-validation with
   cross-origin credential/body strip, body cap + timeout, allowed-content-type) — and the
   **browser-path URL policy**, which is *necessarily* custom: a browser cannot hook the connection
   layer, so the browser entry can only do URL-shape policy (https-only, no-userinfo, reject
   internal/`.local`/`localhost` names, classify IP literals), with the inherent residual documented.

Net: the audit surface is `ipaddr.js` (vetted, adopted) + a small reviewed policy core + a ~25-line
undici DNS-pinning lookup (the maintained technique on the only seam the suite supports). The
characterization tests below are the audit artifact for that custom surface.

[`ipaddr.js`]: https://www.npmjs.com/package/ipaddr.js
[issue #23]: https://github.com/azu/request-filtering-agent/issues/23
[open undici #2019]: https://github.com/nodejs/undici/issues/2019
[CVE-2024-29415]: https://nvd.nist.gov/vuln/detail/CVE-2024-29415

## Architecture — a small reviewed POLICY core over a mechanical IP primitive

- **The policy core** (`src/guard.ts`) is small, reviewed custom code encoding the suite's specific
  posture: https-only, no-userinfo, production port-gate, cloud-internal hostname denylist,
  alternate-IP-encoding normalisation, per-resolved-record DNS-rebinding re-check, a
  `redirect:"manual"` re-validation loop (cross-origin credential + body strip, method rewrite,
  loop + hop caps), a response-size cap + timeout, an injectable-fetch seam, and a Node-vs-browser
  branch selected by capability detection.
- **The mechanical IP-literal classification** (`src/addresses.ts`) delegates parsing + range
  classification + embedded-v4 byte extraction to the vetted, zero-dependency [`ipaddr.js`]. The
  *policy* (which ranges are public, the loopback-only dev override, the 6to4/NAT64/IPv4-mapped
  embedded-v4 re-check) stays reviewed custom code — no generic library encodes exactly this set.
  A separate browser-safe `classifyIpLiteral` (a pure-JS `node:net#isIP` equivalent, **fuzzed
  against the real `isIP`** in the tests) decides literal-vs-hostname without importing a `node:`
  builtin.

[`ipaddr.js`]: https://www.npmjs.com/package/ipaddr.js

## What it blocks (on the initial request AND every redirect hop)

- non-`https:` schemes (`http:` only under the dev `allowLoopback` hatch, loopback-only);
- userinfo (`https://user:pass@host`);
- a non-default port in production (443 https only) — opt-out via `enforcePortGate: false`;
- the cloud-internal hostname denylist (`metadata.google.internal`, `*.svc.cluster.local`,
  `*.internal`, …) **before DNS** (split-horizon defence);
- private / loopback / link-local (incl. **cloud metadata `169.254.169.254`**) / RFC-1918 / CGNAT
  (RFC 6598) / `0.0.0.0/8` / multicast / broadcast / TEST-NET / benchmarking IP literals — in any
  textual form, incl. decimal / hex / octal / short-form IPv4 and IPv4-mapped / 6to4 / NAT64 IPv6
  embedding a private v4;
- **DNS rebinding**: every resolved A/AAAA record must be public — one private record fails the
  whole request;
- a redirect to any of the above (re-validated per hop; `redirect:"manual"`, never auto-followed);
- an oversize body (declared `Content-Length` up front, streamed body on overflow) and a slow
  response/body (single timeout over fetch + redirects + body).

## Two entries

### `@jeswr/guarded-fetch` (default, BROWSER-SAFE)

No top-level `node:` import — a browser/edge bundle resolves + tree-shakes it with no polyfill shim.
On Node it auto-detects `node:dns/promises` (lazy, opaque import) and runs the full DNS-resolve +
every-record-public + rebinding check; with no resolver it runs the DNS-less syntactic guard
(fails closed for a public-looking hostname in a non-browser runtime; allows it only in a
positively-identified browser, the inherent browser residual).

```ts
import { createGuardedFetch, SsrfError } from "@jeswr/guarded-fetch";

const guarded = createGuardedFetch({ maxBytes: 256 * 1024, timeoutMs: 8_000 });
const res = await guarded("https://registry.example/catalog"); // throws SsrfError on a refusal
```

The default entry validates the host and (on Node) every resolved record, but plain `fetch`
re-resolves the name at connect time — so the default best-effort posture documents a residual
DNS-rebinding window (lookup→connect TOCTOU). Set `requireDnsPinning: true` to **fail closed** for a
hostname target unless a branded `pinningFetch` is supplied — which is exactly what the `./node`
entry provides.

### `@jeswr/guarded-fetch/node` (opt-in, FULL DNS-rebinding closure)

The ONLY artifact that imports `undici` / `node:*`. It builds an undici `Agent` whose
`connect.lookup` resolves once → validates every record → **pins the validated IP onto the socket**,
so the connection cannot be rebound between validation and connect. TLS SNI + certificate validation
stay against the original hostname (we never set `rejectUnauthorized: false`).

```ts
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

const fetchImpl = createNodeGuardedFetch(); // strict posture, DNS-pinned
const res = await fetchImpl("https://registry.example/catalog");
```

`SsrfError` thrown by the `./node` entry is the SAME class as the one exported from the default
entry, so `instanceof SsrfError` works across both.

## Errors

- `SsrfError` — the **security boundary**: scheme / userinfo / private-target / rebinding /
  oversize / timeout / malformed.
- `GuardError` — the **policy boundary**: a disallowed port, or a content-type allowlist miss when
  `allowedContentTypes` is configured.

Both are guard refusals; a guarded fetch never silently succeeds on a refused target.

## The pod-scope guard (`podScope`) — "is this URL within MY container?"

Distinct from the SSRF guard (host safety), the **pod-scope guard** is the suite's one reviewed
home for the *capability* check: is a candidate URL within the ONE pod (sub-)container this
component was configured to touch? It consolidates the ~8 bespoke `assertWithinBase` copies
(rxdb-solid, y-solid, n8n-nodes-solid, solid-mcp, unite, solid-components, solid-granary,
matrix-chat-to-pod) into a single implementation that is the **union of every defence** any one
of them had — fail-closed on any doubt. Browser-safe (WHATWG `URL` only), exported from the
default entry.

```ts
import {
  normalizePodBase,       // canonical container address (trailing /, no query/fragment) — throws
  assertWithinPodScope,   // fail-closed assert; returns the CANONICAL in-scope URL — throws
  isWithinPodScope,       // boolean form (false on ANY doubt, incl. an invalid base)
  podScopedUrl,           // filter form: canonical URL | undefined (drop hostile listing entries)
  createPodScopedFetch,   // fetch wrapper: every request AND redirect hop re-checked in scope
  isContainerUrl,         // LDP trailing-slash convention, query/fragment-proof
  PodScopeError,
} from "@jeswr/guarded-fetch";

const base = "https://alice.pod.example/notes/";
assertWithinPodScope(base, "doc.ttl");                      // → https://alice.pod.example/notes/doc.ttl
assertWithinPodScope(base, "https://h/notesfoo/x");         // ✗ PodScopeError (segment boundary)
assertWithinPodScope(base, base, { allowRoot: false });     // ✗ strict-descendant (write-target) mode
const podFetch = createPodScopedFetch(base, { fetch: authedFetch }); // refuses out-of-scope hops
```

What it enforces (each rule came from at least one hardened copy): http(s)-only schemes;
scheme-relative (`//host/…`) refused; embedded credentials refused **and never echoed in error
messages** (`redactUserinfo`); same-origin (scheme+host+port); **segment-boundary** path prefix
(`/podfoo` is NOT under `/pod/`); `.`/`..`/`%2e%2e`/backslash traversal collapsed-then-validated;
encoded path delimiters (`%2F`/`%5C`) refused outright (server decode-order ambiguity); root-absolute
refs NOT silently re-rooted; the base root gated by `allowRoot` (default in-scope; `false` = strict
descendant, the rxdb/y-solid write-target semantics). `createPodScopedFetch` additionally re-checks
**every redirect hop** (manual redirects, bounded hops, loop detection, Fetch method/body semantics)
so a poisoned in-scope resource cannot `302` an authenticated fetch out of the pod. It composes with
the SSRF guard: `createPodScopedFetch(base, { fetch: createGuardedFetch(opts) })`.

## GitHub-installable under `ignore-scripts=true`

The committed `dist/` is **self-contained**: `ipaddr.js` is bundled inline (esbuild) into
`dist/index.js`, so a consumer can `npm install github:jeswr/guarded-fetch#main` and import it with
no build step under the suite's `ignore-scripts=true` invariant. `undici` (used only by `./node`) is
kept external — a single shared, audited copy resolved by the consumer. The `check:dist` gate fails
if the committed `dist/` drifts from a fresh build of `src/`.

## Gate

```bash
npm run lint        # biome + check:lockfile-transport (no git+ssh:// in any lockfile)
npm run typecheck   # tsc --noEmit
npm test            # vitest (the characterization suite = the security audit artifact)
npm run build       # esbuild bundle (ipaddr.js inlined) + tsc .d.ts
npm run check:dist  # committed dist/ matches a fresh build of src/
npm run check:api   # api-extractor — etc/guarded-fetch.api.md + etc/guarded-fetch-node.api.md
npm run publint     # publint --strict
npm run attw        # are-the-types-wrong (node16 profile; cjs-resolves-to-esm ignored — ESM-only)
npm run gate        # all of the above
```

> attw: this is an intentionally **ESM-only** package (`"type": "module"`); the `cjs-resolves-to-esm`
> rule is ignored because a CJS consumer using a dynamic import is the correct, expected behaviour.

## The reviewable public API

`etc/guarded-fetch.api.md` (default entry) and `etc/guarded-fetch-node.api.md` (`./node` entry) are
the api-extractor-generated, committed API reports — the surface a reviewer reads.

## Tests = the audit artifact

The maintainer audits SSRF code by reading the tests. `test/` ports every security test from all
three consolidated copies + the reference, plus the union of attack vectors (private / loopback /
link-local / IPv6-ULA / IPv4-mapped / decimal-and-octal-IP / `0.0.0.0` / metadata /
redirect-to-private / DNS-rebind-on-second-resolution / userinfo-smuggling / non-https /
oversize-body / timeout / port-gate / cloud-internal-denylist / browser branch / edge fail-closed /
node:dns-import-failure fallback / TLS-servername-under-pin). `classifyIpLiteral` is fuzzed against
the real `node:net#isIP`.

## License

MIT
