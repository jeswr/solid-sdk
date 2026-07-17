<!-- AUTHORED-BY Claude Fable 5 -->

# @jeswr/solid-pod-guard

The **authenticated-caller boundary** for server-side Solid pod routes.
Node-only, `securityCritical`. A behavior-preserving extraction of a reviewed
reference implementation into a reusable package.

- `createPodRouteGuard(options)` — a fixed fail-closed route pipeline:
  authenticate (DPoP-bound Solid-OIDC; anonymous ⇒ 401) → reject `pod`/`webid`
  overrides (400) → validate the JSON body (400) → bind the ONE authorized pod
  from the token WebID → your handler.
- `resolveAuthorizedPod(webid, config)` — the bidirectional `pim:storage`
  binding: forward profile claim + operator origin allowlist (exactly one
  survivor, never pick-first) + the pod's owner-only-writable backward
  acknowledgment.
- `createServicePodFetch(options)` — a DPoP-bound `client_credentials` service
  identity for WAC-protected pod IO (cached token, fresh single-use proof per
  request, redirect-refusing, secret never echoed).
- `configFromEnv(envPrefix)` — `${PREFIX}_TRUSTED_OIDC_ISSUERS`,
  `${PREFIX}_POD_ALLOWED_ORIGINS`, `${PREFIX}_DEV_ALLOW_LOOPBACK`,
  `${PREFIX}_TRUST_FORWARDED_HEADERS`.

```ts
import { configFromEnv, createPodRouteGuard } from "@jeswr/solid-pod-guard";

const guard = createPodRouteGuard({ config: configFromEnv("MYAPP") });

export async function GET(request: Request) {
  return guard.handle(request, async (caller) => {
    // caller.webid — verified token WebID; caller.podBase — its ONE bound pod
    return Response.json({ pod: caller.podBase });
  });
}
```

**Read [`SKILL.md`](./SKILL.md) before deploying** — it documents the
operator trust assumption (owner-only-writable `<pod>profile/card` on every
allowlisted host) and the L3 consumer obligation
(`credentialSubject == caller.webid` in your handlers).

MIT © Jesse Wright
