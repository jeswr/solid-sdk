# `@jeswr/guarded-fetch`

> Experimental, AI-agent-generated. SSRF / DNS-rebinding-guarded `fetch` for the `@jeswr` Solid
> suite. **Security-critical** — a behaviour regression is a CVE.

A `fetch`-shaped guard for dereferencing an **attacker-influenceable URL** (a user/config-supplied
remote origin: a federation registry/storage document, a community-feed source, an LDN cross-pod
delivery target, a WebID profile). It consolidates the suite's three divergent SSRF-guard copies
(`federation-client`, `solid-community-feeds`, `solid-agent-notify`) and the prod-solid-server
`@pss/guarded-fetch` reference into one exhaustively-tested implementation that is a strict
**superset** of every defence any one of them had.

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
