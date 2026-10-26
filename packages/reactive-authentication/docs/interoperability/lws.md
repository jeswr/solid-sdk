# External Linked Web Storage (LWS) deployments

Targets in `interop/targets/lws.json`, run by `interop/adapters/lws.js` with the library's LWS support
(`LwsTokenProvider` and one `CredentialSource` per authentication suite), following the LWS editor's drafts at
[w3c/lws-protocol@268fd25](https://github.com/w3c/lws-protocol/tree/268fd25be04dd609f8b3a9b324e99c0073c67f0f).

**No public LWS deployment is known (2026-09-27).** These targets are UNTESTED until you configure a
deployment you may test. The mock LWS authorization server in `test/helpers/lws.js` is used only to self-test
the adapter's mechanics offline (`test/interop-live-config.test.js`); that is not interoperability evidence.

## Suites and targets

| Target | Suite | Credential | Needs |
| --- | --- | --- | --- |
| `lws-openid` | OpenID Connect | ID token from a real browser login (`OidcIdTokenSource`; URI `sub`, `azp`) | an OpenID provider trusted by the deployment; registered client or dynamic registration |
| `lws-saml` | SAML 2.0 | signed assertion (`SamlAssertionSource`) | the deployment's SAML service provider exposing an assertion endpoint |
| `lws-cid` | self-signed, controlled identifier | self-issued JWT (`SelfIssuedJwtSource`) | an HTTPS CID document publishing the key under `authentication` |
| `lws-did-key` | self-signed, did:key | self-issued JWT (`DidKeySource`) | the key's did:key granted access in the storage |

The storage answers 401 with `WWW-Authenticate: Bearer as_uri="…", realm="…"`; the library checks the binding
against its trust policy (same origin as the storage by default, or `RA_INTEROP_<P>_AUTHORIZATION_SERVER`),
checks realm containment, exchanges the credential (RFC 8693, `resource` = realm) and replays with `Bearer`.

## Scenarios

- `lws.login-read`: the first request is unauthenticated and challenged with Bearer; exactly one successful
  token exchange, only at a trusted authorization server; the replay uses Bearer without DPoP; for OpenID, one
  code exchange with S256 PKCE, state and nonce. The agent identifier is a URI and, when
  `RA_INTEROP_<P>_SUBJECT` is set, equals it (compared without echoing). With a scratch container it creates one
  run-owned resource (`PUT` + `If-None-Match: *`) and reads it back; otherwise it reads the private resource.
  The resource is recorded as run-owned **only on `201 Created`**. A `200`/`204` answer to a create-only `PUT`
  does not confirm creation (RFC 9110 uses them for replacing an existing representation), so the scenario
  FAILs with an explanation, nothing is recorded as owned, and `lws.cleanup` deletes nothing.
- `lws.write` (scratch only): the resource is private to anonymous GETs, conditional update with `If-Match`,
  read-back, no new exchange.
- `lws.boundary`: a local decoy that is inside the manager's boundary but whose challenge names no LWS binding
  gets no credentials; a look-alike path and `OTHER_PROTECTED` (read-only GETs) get none either; no exchange
  with the decoy.
- `lws.boundary-automatic` (needs `storageDiscovery`): a fresh client uses `AutomaticCredentialBoundary` with
  `traversal: "headers-only"`, `eligible` = the storage's origin and `approve` = only the configured storage.
  The first unauthenticated 401 must carry `Link: <storage>; rel="https://www.w3.org/ns/lws#storage"`; the
  library fetches that same-origin storage description (`id`, type `Storage`, `StorageRoot` service) and
  confirms the root with an unauthenticated `HEAD` linking back. Checks: the discovered root is the configured
  `STORAGE` (source `lws`) and the only root; the only `HEAD` was that confirmation (no ancestor traversal); one
  token exchange; a look-alike path and `OTHER_PROTECTED` receive no credentials and add no root.
- `lws.logout`: the cached realm-bound token is reused before logout; after `logout()` a new exchange (and for
  OpenID a new authorization) is needed.
- `lws.cleanup` (scratch only): deletes exactly the run-owned resource and checks 404/410.

`storageDiscovery` is `"unverified"` on every LWS target (no deployment observed): the scenario is UNTESTED
unless the run passes `--exercise-unverified`, which runs it and reports what it observes (PASS/FAIL, marked
as exercised rather than proven beforehand). For it, `RA_INTEROP_<P>_STORAGE` must be the `StorageRoot`
endpoint the description advertises, not a sub-container.

`writes` is declared `true` because LWS core defines create/update/delete operations; its Operations section
has no HTTP binding yet at 268fd25, so the adapter uses RFC 9110 conditional `PUT`/`DELETE`. A deployment that
binds creation differently fails `lws.login-read` in scratch mode with the observed status — then configure
read-only mode.

## Environment

Common to each target (`<P>` = `LWS_OPENID`, `LWS_SAML`, `LWS_CID`, `LWS_DID_KEY`):

| Variable | Flag | Meaning |
| --- | --- | --- |
| `RA_INTEROP_<P>_STORAGE` | pii, required | storage (or part of it the test identity may use), ends with `/` |
| `RA_INTEROP_<P>_SCRATCH` | pii, optional | container for run-owned writes inside it |
| `RA_INTEROP_<P>_PRIVATE_RESOURCE` | pii, optional | existing readable private resource (read-only mode) |
| `RA_INTEROP_<P>_OTHER_PROTECTED` | pii, optional | protected resource outside the storage |
| `RA_INTEROP_<P>_AUTHORIZATION_SERVER` | optional | trusted `as_uri` when not on the storage's origin |
| `RA_INTEROP_<P>_SUBJECT` | pii; **required** for `lws-openid` and `lws-did-key`, optional for `lws-cid` (fixed by `…_CID_ID`); leave unset for `lws-saml` | expected agent identifier |
| `RA_INTEROP_<P>_STORAGE_STATE` | pii, optional (`lws-openid`, `lws-saml`) | Playwright storage state of a dedicated test account's IdP/SP session |

Per suite:

- OpenID: `RA_INTEROP_LWS_OPENID_ISSUER` (required); `…_CLIENT_ID`, `…_CLIENT_SECRET` (secret), `…_REDIRECT_URI`
  (default `http://127.0.0.1:39398/callback`), `…_STORAGE_STATE`. The provider must issue ID tokens whose
  `sub` is the agent's URI and which carry `azp` (e.g. Keycloak with a URI-valued subject mapper).
- SAML: `RA_INTEROP_LWS_SAML_LOGIN_URL` (starts sign-in at the SP) and `RA_INTEROP_LWS_SAML_ASSERTION_ENDPOINT`,
  which must return `{"xml", "recipient", "notOnOrAfter"}` for `?audience=<as_uri>` to the signed-in browser
  session (the contract of `examples/lws-saml.js`). A person signs in (headed); the adapter then polls the
  endpoint with that session's cookies for up to 300 s. Every assertion request has a 15 s Playwright
  `timeout`, is abandoned as soon as the scenario's signal aborts (its late response is still disposed), and
  its `APIResponse` body is released with `dispose()`; polling sleeps are cancelled with the signal. The
  assertion is never logged; it is the SP's own signed assertion. Without `--headed` but with
  `…_STORAGE_STATE` (runner session mode) the adapter never opens a sign-in page: if the stored SP session
  yields no assertion, `lws.login-read` fails closed.
- Controlled identifier: `RA_INTEROP_LWS_CID_ID` (document URL), `RA_INTEROP_LWS_CID_KEY_ID` (verification
  method URL, `<id>#…`), `RA_INTEROP_LWS_CID_KEY_FILE` (secret: path to the private JWK).
- did:key: `RA_INTEROP_LWS_DID_KEY_KEY_FILE` (secret: path to the private JWK).

Key files hold a private Ed25519 (`kty: OKP`) or P-256 (`kty: EC`) JWK; they are imported non-extractable and
never printed. Generate one outside the repository, e.g.:

```sh
node --input-type=module -e 'const k=await crypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);console.log(JSON.stringify(await crypto.subtle.exportKey("jwk",k.privateKey)))' > ~/.config/ra-interop/agent.jwk
chmod 600 ~/.config/ra-interop/agent.jwk
```

For `lws-cid`, publish the matching document (`createControlledIdentifierDocument`, see
`examples/lws-controlled-identifier.js`); for `lws-did-key`, grant the key's did:key (`didKeyFromPublicKey`)
access in the storage.

## Unattended runs

- `lws-cid`, `lws-did-key`: no browser; they need only the key file (in CI, materialized from a secret by the
  workflow) and can run unattended.
- `lws-openid`: session mode with `…_STORAGE_STATE` works only if the OpenID provider completes the
  authorization from the stored session without consent, MFA or a login form; otherwise it fails closed.
- `lws-saml`: session mode works only while the stored SP session still yields assertions.

## Commands

```sh
npm run build
node --test test/interop-live-config.test.js      # offline, includes the adapter self-test against the mock
node interop/run.js --suite live --target lws-did-key --require lws-did-key
node interop/run.js --suite live --target lws-openid,lws-saml --headed
node interop/run.js --suite live --target lws-did-key --exercise-unverified   # also runs lws.boundary-automatic
```

## Limits

- Never run against a real deployment: every LWS result so far is from the offline mock (adapter self-test,
  including `lws.boundary-automatic`, the 201-only ownership rule and the SAML cancellation path).
- Automatic discovery accepts only same-origin storage descriptions (library limitation); deployments that
  describe storage on another origin need the explicit boundary (`lws.boundary`).
- LWS drafts are unofficial and moving; the adapter follows the library's pinned commit.
- The SAML suite's client transports assertions only; validation belongs to the authorization server.
