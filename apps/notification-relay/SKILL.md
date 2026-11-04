---
name: notification-relay
description: Maintain the Node LWS webhook-to-SSE relay, its registration trust, signed delivery verification, and replay buffers.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Read the repository charter and SDK core ADR-005 before changing protocol behavior.
The app has no runtime pod-package dependencies. `jose` verifies ID tokens; the Node
`guarded-fetch` entry pins DNS and bounds unauthenticated description/JWKS retrieval.
Never use the session's storage access token to authenticate relay registration.

`createRelay` takes a verified-ID-token function and guarded fetch for embedding/tests.
Production composition in `config.ts` supplies both. Trust issuers/JWKS endpoints and
client audiences explicitly; never discover keys from an untrusted token issuer.
Do not log bearer tokens, stream URLs, raw notifications, or verifier errors.

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
