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

The push API accepts Solid-OIDC access tokens as `Authorization: DPoP <token>` with
request-bound `DPoP: <proof>`. Issuer discovery, audience `solid`, WebID issuer endorsement,
proof signature/method/public URL/time/token hash/key binding and shared replay protection
are enforced. `RELAY_MOBILE_CLIENT_ID` must equal the token's `client_id`.
The generic resource verifier is `createResourceTokenVerifier` from
[`@jeswr/solid-api-auth`](../../packages/solid-api-auth/README.md); this app retains its
mobile-client and stored-sender route policies. Discovery, JWKS and WebID profiles cache for
ten minutes, with 1,000 entries and 1,000 in-flight loads per cache. Loads share work per URL
and abort after five seconds, including body reads; timeouts release their slots even if a
transport ignores abort. Unknown-key rejection retries the newest cached JWKS before applying
the one-minute forced-refresh cooldown. Concurrent refreshes share one fetch. Failed refreshes
retain the previous value and its original expiry. Cooldowns are bounded, expire before oldest
eviction, and preserve evicted live deadlines through a conservative overflow deadline;
URL churn cannot reset a live cooldown. Under saturation this can temporarily suppress new
forced refreshes. Replay storage remains the relay's shared atomic store.

- `POST /push/installations`: JSON `{ platform: "android" | "ios", pushToken,
  devicePublicKey, authSecret, deviceSigningKey }`, P2 token + device proof →
  `201 { installationId, activated: false, challengeSent }`.
- `PATCH /push/installations/:id`: a nonempty subset of the four token/key fields,
  P2 + proof by the **current** signing key → `200 { installationId, activated,
  challengeSent? }`. Changed tokens or keys increment `tokenVersion` and invalidate activation.
  An unchanged PATCH while inactive retries the challenge; at most three attempts/hour,
  including creation and changes. A failed sink send returns `challengeSent: false`.
- `POST /push/installations/:id/activate`: JSON `{ nonce }`, P2 + device proof → 204.
  Only the latest challenge nonce activates; successful activation consumes it.
- `PUT /push/registrations/:id`: JSON `{ installationId, webId, protocol: "solid" | "lws",
  storage, topics: [{ index, kind: "inbox" | "chat", topic, channel, sender?, expiresAt }] }`.
  Requires P2 for that exact `webId`, plus the destination installation's device proof on
  creation or a move. Refresh/change on the same installation needs P2 for its stored owner.
  Returns `201 { registrationId, inbox }` on creation, `200 { registrationId }` on refresh.
- `POST /push/registrations/:id/rotate-inbox`: P2 for the stored owner → `200 { inbox }`.
- `DELETE /push/registrations/:id`: P2 for its owner **or** the installation's device proof → 204.
- `DELETE /push/installations/:id`: device proof alone → 204; removes all its registrations.

Bodies are JSON only, strict UTF-8, at most 64 KiB; unknown fields are rejected. Cleanup
and rotation accept an empty body or `{}`. IDs are 1–128 ASCII letters/digits/underscore/hyphen;
installation IDs are generated as 128-bit hex. Push tokens are nonempty strings up to 4096
characters. The decryption key is a canonical base64url uncompressed P-256 point (65 bytes),
`authSecret` is canonical base64url (16 bytes), and `deviceSigningKey` is a public P-256 JWK
with exactly `kty`, `crv`, `x`, `y`. URL fields pass `safeUrl`; topic indices are distinct
nonnegative safe integers; expiry timestamps are positive integer Unix **milliseconds**.
At most four registrations attach to an installation and sixteen topics to a registration.
Registration expiry is thirty days from the last PUT. A minute sweep and request-time checks
expire registrations; removal of the last registration deletes its installation atomically.

`Installation-Proof` is a compact JWS with protected header
`{ "alg": "ES256", "typ": "installation-proof+jwt" }` and payload
`{ "htm": "POST", "htu": "https://relay.example/push/installations", "iat": 1790000000,
"body_sha256": "<base64url SHA-256 of exact request bytes>", "jti": "<unique id>" }`.
These are the only permitted header/payload fields. `iat` is integer Unix seconds within
±60 seconds; `jti` is nonempty and at most 128 characters. Empty bodies hash zero bytes.
The URL is the configured public origin plus pathname; forwarded headers are ignored and
push query strings/fragments are refused. The signing key comes from the create body,
then from stored state. Device replay reservations are shared for 120 seconds plus 1 ms
(to cover the inclusive time boundary); reusing a proof is refused across relay instances.
A device proof authorizes attachment and cleanup; every creation, refresh or change also
requires P2. The two DELETE routes work after offline sign-out without a token.

Inject `pushSink: { send(installation, payload) }` into `createRelay` or
`configuredRelay(env, { outboundFetch, store, pushSink })`. Installation creation and challenge
retries return 503 without a sink. This part sends only plaintext challenge payloads
`{ v: 1, id, kind: "challenge", nonce, sentAt }` to that interface. Nonces are random 128-bit
values and only their hashes are stored. No other push is sent to an inactive installation.
**P2b adds RFC 8291 encryption before transport and real FCM/APNs sinks.** The secret inbox
POST/P6 webhook binding and delivery are also P2b; they are not implemented here. Inbox URLs
use random 256-bit secrets, returned only at creation or rotation, with only SHA-256 hashes
stored and a constant-time hash comparison helper for P6. Keep inbox URLs out of access logs.

The exported `webhookSenderPolicy` checks the verified WebID against a stored sender without
the mobile-client rule; P6 connects it to webhook deliveries. The shared async `RelayStore`
holds replay reservations and transactional push state. Transactions are synchronous, pure
callbacks on isolated snapshots; exceptions roll back. A Redis backend can WATCH a versioned
snapshot and use MULTI/EXEC with conflict retries, or use equivalent Lua operations; replay
reservations require SET NX PX. `InMemoryRelayStore` can be shared by relay objects, but separate
processes need that shared backend. Existing SSE state stays local.
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
