<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Notification relay

> **Experimental — AI-agent-generated.** Node 24 LWS webhooks → browser SSE (T-043).

Run a single instance on the AWS host behind TLS, or use the included Vercel Node function
entry (`api/index.ts`, rewrite configuration included). No runtime pod-package dependency.

```sh
pnpm --filter @jeswr/app-notification-relay... build
NODE_ENV=production \
RELAY_PUBLIC_URL=https://relay.example \
RELAY_MOBILE_CLIENT_ID=https://mobile.example/clientid.jsonld \
RELAY_ID_TOKEN_AUDIENCE=https://app.example/clientid.jsonld \
RELAY_TRUSTED_ISSUERS='[{"issuer":"https://issuer.example","jwksUri":"https://issuer.example/jwks"}]' \
RELAY_ALLOWED_ORIGINS=https://app.example \
pnpm --filter @jeswr/app-notification-relay start
```

`HOST`/`PORT` default to `127.0.0.1:3000`. Preserve the public Host header at the TLS proxy.
The configured origin determines the signed scheme/authority; forwarded headers are ignored.
Vercel uses Node 24 from `engines.node` and the included build command builds workspace
dependencies before the function; configure the same environment variables in the
project. Git deployments are disabled by repository convention; this lane deploys nothing.
The audience is the client audience of the existing session ID token, as explicitly trusted
by the relay operator. ID-token issuers and JWKS endpoints must be HTTPS. ID tokens require
valid asymmetric signatures, issuer, subject, audience, expiry and issued-at claims;
multiple audiences additionally require an accepted `azp`. Access tokens are rejected.

- `POST /register`, JSON `{ "storage": "https://storage.example/description" }`,
  `Authorization: Bearer <session ID token>` → `201 { id, inbox, streamToken }`.
  IDs are 128 random bits; stream capability tokens are 256 random bits. Registration
  expires with the ID token or after 24 hours, whichever comes first.
- `POST /inbox/:id` accepts signed LWS Notification envelopes only for the registered storage.
  Successful delivery/repeated delivery returns 202; invalid authentication returns 401.
- `GET /stream/:id?token=…` returns SSE. `Last-Event-ID` replays newer retained events;
  the first connection replays the current buffer, covering delivery before stream setup.
  Heartbeats run every 20 seconds. Streams end when their registration expires.

The verifier implements a strict single-signature profile of
[RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html) and sha-256
[Content-Digest](https://www.rfc-editor.org/rfc/rfc9530.html). It requires all six LWS covered
components, any order: `@method`, `@scheme`, `@authority`, `@path`, `content-type`,
`content-digest`. `created` is accepted inclusively within ±300 seconds; optional `expires`
is enforced. `keyid` must have a fragment and identify the registered storage document,
whose `id` and matching full/fragment `verificationMethod.id` are checked.
Descriptions cache for one hour. Public JWK verification methods support `ed25519`,
`ecdsa-p256-sha256`, `ecdsa-p384-sha384`, `rsa-pss-sha512`, and `rsa-v1_5-sha256`;
RSA keys require at least 2048 bits. Without `alg`, JWK algorithm metadata is used when present; otherwise key type selects
Ed25519, ECDSA or RSA-PSS. Conflicting algorithm metadata is rejected.
Other key representations, multiple signatures, extra covered components and digest
algorithms are rejected. JSON-LD contexts are never fetched.

Outbound requests use DNS-pinned public HTTPS, at most three revalidated redirects,
a 5-second deadline including body reads and a 256 KiB limit. The legacy storage
description verifier still refuses redirects. Bodies are limited to 1 MiB. Stream URLs are bearer credentials:
keep them out of access logs and analytics (including reverse-proxy/Vercel logs).
Browser origins require an explicit allowlist (`RELAY_ALLOWED_ORIGINS`, comma-separated).

The push API now has authentication and route skeletons. Send a Solid-OIDC access token
as `Authorization: DPoP <token>` and its request-bound proof as `DPoP: <proof>`.
The relay discovers the issuer's metadata and JWKS, requires audience `solid`, and
checks that the claimed WebID's RDF profile lists that issuer. It verifies the proof's
signature, method, public URL (without query or fragment), timestamp within 60 seconds,
access-token hash and key thumbprint. Discovery, JWKS and profile caches last ten minutes.
Profile reads carry no credentials and remote JSON-LD contexts are refused.

`RELAY_MOBILE_CLIENT_ID` must exactly match the token's `client_id`. Without it,
push routes refuse access. The installation create/update/delete and activation routes,
registration PUT/DELETE, and inbox rotation route in MOB-P2 §4 return 501 after successful
authentication; auth failures return 401 with `WWW-Authenticate: DPoP`.
Device proofs, device-only cleanup, registration state and push delivery come in later parts.
The exported `webhookSenderPolicy` checks the verified WebID against a stored sender,
without the mobile-client rule; P6 will connect it to webhook deliveries.

`configuredRelay(env, { outboundFetch, store })` supports embedding and tests.
The async `RelayStore` currently holds atomic five-minute DPoP replay reservations;
`InMemoryRelayStore` can be shared by several relay objects. Separate processes will need
a shared backend such as Redis with SET NX PX. Existing SSE state stays local.
`createRelayOutboundFetch({ allowLoopbackForTests: true })` is only for test harnesses.
Both deployment entries require `NODE_ENV=production` and reject transport overrides;
they always build the production guard themselves. No environment setting enables loopback.
Keep tokens, WebIDs, URLs and payloads out of logs.

Replay buffers retain events for 15 minutes, up to 1000 events/4 MiB per registration;
slow SSE clients are disconnected after 4 MiB of queued data. There are at most 1000
registrations and four streams per registration. Signature fingerprints are retained until
their acceptance window ends; exhaustion at 10,000 live fingerprints returns 429. Replay
buffer eviction/restart can lose hints, so SDK consumers must reconcile on `resync`.

**Deployment constraint:** all state is in memory. Use one AWS process, or route every
request for a registration to the same warm Vercel instance. Ordinary multi-instance
Vercel routing/cold starts do not preserve registrations; function duration limits also
end SSE connections. The adapter is deployable, but durable multi-instance operation needs
a shared store (not included). The SDK rediscover/register/subscribe path recovers from
terminal stream failures; native EventSource retries retain Last-Event-ID while the same
registration survives.

Validate with `pnpm --filter @jeswr/app-notification-relay test` (100% coverage) and the
repository gate. The integration test drives a memory LWS change through a signed webhook,
a local HTTP listener and Node's native EventSource into a normalized ChangeEvent.
