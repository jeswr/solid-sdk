---
name: notification-relay
description: Maintain relay ID-token and Solid-OIDC authentication, route policies, guarded outbound reads, signed LWS deliveries, and SSE replay buffers.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

Read the repository charter and SDK core ADR-005 before changing protocol behavior.
The app has no runtime pod-package dependencies. `jose` verifies JWTs; `fetch-rdf`
parses WebID profiles. Pass the guarded transport explicitly to every public read.

`createRelay` takes a verified-ID-token function and guarded fetch for embedding/tests.
Composition in `config.ts` accepts `outboundFetch` and a shared async `RelayStore`.
The existing `/register` route still accepts only ID tokens with configured issuer,
JWKS endpoint and audience trust. Push routes use `createResourceTokenVerifier`:
discover the issuer, require matching metadata, verify a Solid-audience access token,
check its WebID's RDF `solid:oidcIssuer` assertions, then enforce every DPoP binding.
Never bypass the profile assertion or use token claims to choose a route policy.
`mobileClientPolicy` checks the configured Client ID Document; `webhookSenderPolicy`
checks the stored sender without a client rule. P6 wiring is still pending.

Push mutations require DPoP plus `RELAY_MOBILE_CLIENT_ID`; installation mutations and
registration attachment also require `Installation-Proof` (ES256 compact JWS, strict
`installation-proof+jwt` header, method/public URL/integer iat/raw-body hash/jti payload).
See README for the exact wire schema. Creation uses the body's signing key; later proofs
use the stored key. Recheck stored key/version and registration ownership inside the write
transaction after async verification. Only DELETE registrations (owner P2 OR device proof)
and DELETE installations (device proof alone) support tokenless offline cleanup.
Device proofs never authorize a refresh/change by themselves. Auth failures return 401
with `WWW-Authenticate: DPoP`; validation/size failures return 400/413.

`RelayStore.insertIfAbsent` atomically reserves DPoP replay keys for five minutes and device
proofs for 120 seconds plus the inclusive-boundary millisecond. Share one store between
relay instances; Redis replay storage must use SET NX PX. `transaction` callbacks are pure,
synchronous and rerunnable, using isolated snapshots; exceptions roll back. Redis can use
WATCH/version + MULTI/EXEC retry or equivalent Lua. Deletion, moves, expiry and last-registration
installation cleanup are atomic. Limits: four registrations/installation, sixteen topics,
thirty days from last PUT. A minute sweep and request-time pruning handle expiry.

Inject `PushSink` through createRelay/configuredRelay. Only challenge payloads are sent here,
with plaintext nonce passed to the sink; P2b supplies RFC 8291 encryption and FCM/APNs.
Keep installations inactive until the latest 128-bit nonce and both proofs succeed; token/key
changes reset activation. Challenges are capped at three attempts/hour. Secret inbox URLs
have 256 random bits, returned only on create/rotate and stored only as hashes. P6 secret-inbox
POST binding/delivery is deferred. Never route these URLs through legacy SSE inbox handling.
The memory store does not persist across processes/restarts. JSON bodies are strict UTF-8,
bounded to 64 KiB with unknown fields refused; signing JWKs are public P-256 keys only.

`createRelayOutboundFetch` uses the Node guard: DNS-pinned public HTTPS, at most
three revalidated redirects, 256 KiB and five seconds including body reads. Discovery,
JWKS and profile caches last ten minutes and share in-flight loads per URL within a verifier.
Unknown token keys can refresh JWKS once a minute; concurrent refreshes share one fetch.
Settled loads clear their in-flight promise, including failures, which retain the previous
cached value and allow later retries under the existing throttle. Remote JSON-LD contexts are refused.
Only tests enable `allowLoopbackForTests`; never read it from environment configuration.
Both deployment entries call `productionRelay`, which requires NODE_ENV=production,
rejects injected transports, and builds its own guard. Embedding tests may inject a
transport through `configuredRelay`. Do not log tokens, WebIDs, URLs, payloads or errors.

The webhook verifier accepts a strict single-signature RFC 9421 profile with exactly
`@method @scheme @authority @path content-type content-digest`, a fragment-bearing keyid,
created within ±300 seconds, and RFC 9530 sha-256. Components may be reordered.
Storage descriptions bind their top-level id and verificationMethod ids; publicKeyJwk
supports Ed25519, P-256/P-384 ECDSA, RSA-PSS SHA-512 and RSA v1.5 SHA-256.
Canonicalize Structured Fields before constructing the signature base. Reject unsupported
profiles/keys and mismatched bodies with 401. Check storage registration before key I/O.

`nodeHandler` preserves raw bytes, rejects duplicate security headers, and derives signed
scheme/authority from the configured public origin. Forwarded headers are untrusted.
SSE replay and signature replay protection are per registration and bounded. Stream expiry
closes peers. Cancellation must clean up without closing an already-cancelled controller.
The in-memory deployment requires a single instance/sticky routing; Vercel cold starts and
multiple instances lose registrations. See README for deployment constraints.

Run dependency-first build, lint, typecheck, and tests. Retain 100% coverage and adversarial
vectors. The integration test uses Node's native experimental EventSource over loopback HTTP
and the memory LWS target; the test runner enables its Node flag.
