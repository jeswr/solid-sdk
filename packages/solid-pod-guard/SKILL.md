---
name: solid-pod-guard
description: Use when a server-side route must act on a Solid pod on behalf of an authenticated caller — DPoP-bound Solid-OIDC route guarding, deriving the ONE authorized pod from the token WebID (bidirectional pim:storage binding), configuring trusted issuers / pod-origin allowlists, or wiring a client-credentials service identity for WAC-protected pod IO.
---
<!-- AUTHORED-BY Claude Fable 5 -->

# The authenticated-caller pod-route boundary

`@jeswr/solid-pod-guard` is `"securityCritical": true` and Node-only. It is a
behavior-preserving extraction of a reviewed reference implementation:
changes here get adversarial review and are never auto-merged. Do not weaken, reorder, or make configurable any fail-closed
step described below.

## The layered model

| Layer | Control | Where |
| --- | --- | --- |
| L1 | DPoP-bound Solid-OIDC authentication (anonymous ⇒ 401) | `createPodRouteGuard` via `@jeswr/solid-api-auth` |
| L2 | Authorized pod DERIVED from the token WebID — bidirectional `pim:storage` binding; `pod`/`webid` request params rejected 400 | `resolveAuthorizedPod` |
| L3 | `credentialSubject == webid` on every consumed credential | **the consumer's handler — NOT this package** |
| L4 | Service identity for WAC-protected pod IO | `createServicePodFetch` |

## The route pipeline (order FIXED, not configurable)

```ts
const guard = createPodRouteGuard({ config: configFromEnv("MYAPP") });
export async function GET(request: Request) {
  return guard.handle(request, async (caller, body) => {
    // caller.webid  — the VERIFIED token WebID
    // caller.podBase — the ONE pod that WebID is bound to (trailing slash)
    return Response.json({ ok: true });
  });
}
```

1. **authenticate** — anonymous is ALWAYS 401 (+ `WWW-Authenticate`), even with
   malformed params; an empty `trustedOidcIssuers` is 503, never open.
2. **reject overrides** — any `pod`/`webid` in the query, or ANYWHERE in the
   body (nested objects/arrays included), is 400 (`param_rejected`): identity
   and pod are never request inputs. The scan is iterative with a fixed
   structural budget (64 nesting levels / 25k nodes); a body beyond it is not
   a legitimate route body and is rejected 400 (`param_rejected`) rather than
   traversed.
3. **validate body** — optional JSON object; malformed ⇒ 400 before ANY pod
   IO. DoS containment is built in and fixed: a 64 KiB size cap enforced
   while the stream is consumed (⇒ 413 `body_too_large`; a `Content-Length`
   precheck is an optimization only, chunked bodies are capped mid-stream)
   plus a 10 s read deadline (⇒ 408 `body_timeout`).
4. **bind pod** — `resolveAuthorizedPod`; any violation ⇒ 403 (`pod_binding`),
   allowlist unset ⇒ 503, unreachable profile ⇒ 502.
5. only then your handler. A thrown `PodAccessError` lowers to its status;
   anything else is a generic 500 (details never leak).

Error bodies carry the fixed `simulated: true` watermark key (the extraction
kept the reviewed response shape verbatim).

Construct the guard ONCE at module scope: the verifier owns the jti replay
store and JWKS cache — a per-request guard would let captured DPoP proofs
replay.

## The pod binding (L2) — why bidirectional

1. FORWARD claim: the WebID's own profile must claim `<webid> pim:storage <pod>`.
2. ALLOWLIST: claims filter through `allowedPodOrigins`; **exactly one** must
   survive — zero or several ⇒ 403, never pick-first. A pod base must be a
   plain origin+path: a query or fragment is rejected outright, because
   `<base>profile/card` composed on a fragment-carrying base dereferences —
   fragment stripped on the wire — to a DIFFERENT resource than the
   owner-only-writable profile card (a card-confusion attack on step 3).
3. BACKWARD acknowledgment: `<pod>profile/card` (owner-only-writable) must
   assert the SAME triple. The forward claim is attacker-authored (anyone can
   put any IRI in their own profile) and an origin allowlist cannot separate
   users on a shared pod host — only the victim pod's refusal to name the
   attacker stops cross-pod substitution.

## TRUST ASSUMPTION — an OPERATOR requirement

The backward acknowledgment is meaningful **only because `<pod>profile/card`
is OWNER-ONLY-WRITABLE**. That is a requirement on every pod host you put in
`allowedPodOrigins`, and this code cannot verify it from outside. If an
allowlisted host lets non-owners (or anonymous callers) write the profile
card, the binding's load-bearing control is void. Operators MUST confirm this
property before allowlisting a pod origin.

## L3 subject binding — a CONSUMER obligation

This package binds the caller to a pod. It does **not** inspect the
credentials your handler reads out of that pod. Your handler MUST enforce
`credentialSubject == caller.webid` on every consumed credential — a fully
valid credential about someone else must never influence a decision for this
caller. This deliberately stays the consumer's job (the guard has no knowledge
of your credential shapes).

## Configuration

`configFromEnv("MYAPP")` reads (comma-separated lists):

- `MYAPP_TRUSTED_OIDC_ISSUERS` — unset ⇒ every guarded route is 503.
- `MYAPP_POD_ALLOWED_ORIGINS` — SSRF allowlist; unset ⇒ 503.
- `MYAPP_DEV_ALLOW_LOOPBACK=1` — dev/e2e ONLY: permits loopback http and swaps
  the DNS-pinned profile fetch for a plain redirect-refusing one. It never
  relaxes any verification gate.
- `MYAPP_TRUST_FORWARDED_HEADERS=1` (auto-on under `VERCEL=1`) — REQUIRED
  behind a TLS-terminating proxy so the DPoP `htu` binding reconstructs the
  public URL; anywhere else forwarded headers are attacker-controlled, leave
  it off.

Next.js `basePath` note: the framework strips the basePath from
`request.url`, but callers mint DPoP proofs against the full public URL — pass
`publicRequestUrl` in `PodGuardOptions` to re-add it.

## Service identity (L4)

`createServicePodFetch({ issuer, clientId, clientSecret })` returns a fetch
that authenticates as the app's OWN WebID via `client_credentials`: DPoP-bound
RFC 9068 token (cached until near expiry), fresh single-use RFC 9449 proof per
request, https-only, every hop refuses redirects, the secret is never echoed
into errors. Server-only — the secret lives in server env. Authorization stays
at the POD (WAC grants naming the service WebID), never in app code.

## Testing

The suites in `test/` run the REAL path — an in-memory sparq Solid server
(vendored `@jeswr/solid-server`, dev-only) plus real loopback Solid-OIDC dev
issuers; verification and binding decisions are never mocked. Extend them the
same way: transport seams (`ownerSeams.profileFetch`, the service `fetch`
seam) may observe or route traffic, but a test that stubs the verify/binding
decision itself is vacuous and will be rejected.
