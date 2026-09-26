---
title: Protocol support
---

# Protocol support

Sources read on 2026-09-26: [Solid-OIDC](https://solidproject.org/TR/oidc) 0.1.0 (2022-03-28),
[Solid Protocol](https://solidproject.org/TR/protocol) 0.11.0, and the LWS drafts at
[w3c/lws-protocol@268fd25](https://github.com/w3c/lws-protocol/tree/268fd25be04dd609f8b3a9b324e99c0073c67f0f)
(2026-09-25): `lws10-core/Authentication.html`, `Authorization.html`, `Discovery.html`,
`Security-Considerations.html` (the included sections, which rendered pages can omit) and the four
`lws10-authn-*` suites. LWS documents are editor's drafts ("unofficial proposal"); support tracks that commit
and may need changes as they evolve. Nothing here claims conformance certification.

## Matrix

| Protocol / suite | Credential acquisition | Exchange / access token | Presentation | Module | Test evidence |
| --- | --- | --- | --- | --- | --- |
| Solid-OIDC | Authorization code + PKCE (S256), `state`, `nonce`, silent `prompt=none` then interactive (`prompt=consent` for `offline_access`) | Access token from the OP; refresh (rotating) grants | `Authorization: DPoP` + fresh proof (`htm`, `htu`, `ath`, `jti`, RS nonce) | `DPoPTokenProvider`, `OidcSession`, `authorizationCodeGrant` | `test/solid-oidc.test.js`, `test/persistence.test.js`, browser `page`, `sw`, `popup` |
| Solid-OIDC §9 with UMA 2.0 | ID token via the Solid-OIDC session (DPoP-bound, `cnf`) | UMA grant `urn:ietf:params:oauth:grant-type:uma-ticket` with `ticket`, `claim_token` = ID token, `claim_token_format` = `http://openid.net/specs/openid-connect-core-1_0.html#IDToken`, DPoP proof with the ID token's key; metadata at `as_uri` + `/.well-known/uma2-configuration` with that profile in `uma_profiles_supported` | RPT as `DPoP` (+ proof) or `Bearer` per `token_type` | `SolidUmaTokenProvider` | `test/uma.test.js` (mock AS verifies ID token signature with jose, `webid`, `aud` `solid`, `cnf.jkt` = proof key, single-use tickets) |
| OAuth client credentials (CSS style) | Client ID/secret | Client credentials grant, DPoP-bound | `Authorization: DPoP` | `ClientCredentialsTokenProvider` | `test/components.test.js` |
| LWS core authorization | — | RFC 8693 token exchange at `as_uri` from `/.well-known/lws-configuration`, `resource` = `realm` | `Authorization: Bearer` (RFC 6750) | `LwsTokenProvider`, `lws/tokenExchange` | `test/lws.test.js` |
| LWS OpenID Connect suite | ID token via authorization code flow (URI `sub`, `azp` required) | subject token type `urn:ietf:params:oauth:token-type:id_token` | via LWS core | `OidcIdTokenSource` | `test/lws.test.js` (mock AS verifies signature against the OP's JWKS) |
| LWS SAML 2.0 suite | Signed assertion from the application's SAML stack (adapter) | `urn:ietf:params:oauth:token-type:saml2`, base64url assertion | via LWS core | `SamlAssertionSource` | `test/lws.test.js` (mock AS verifies the XML signature with xml-crypto; tampering and wrong audience rejected) |
| LWS self-signed, controlled identifiers | Self-issued JWT: `sub` = `iss` = `client_id`, `aud` = [AS], `iat`, `exp`, `jti`, `kid` = verification method | `urn:ietf:params:oauth:token-type:jwt` | via LWS core | `SelfIssuedJwtSource`, `createControlledIdentifierDocument` | `test/lws.test.js` (verifier dereferences the CID, selects `kid` in `authentication`) |
| LWS self-signed, did:key (discontinued draft) | As above with `sub` = `did:key` of the signing key (Ed25519 or P-256) | `urn:ietf:params:oauth:token-type:jwt` | via LWS core | `DidKeySource`, `didKeyFromPublicKey` | `test/lws.test.js` (independent decoder with multiformats + @noble/curves; spec vectors) |
| Any other protocol | Implement `TokenProvider` (and optionally `CredentialSource` for other RFC 8693 token types) | — | — | `examples/custom-protocol.js` | `test/lws.test.js` "extension" |

**Who validates what.** The client validates what it receives from its own identity provider (oauth4webapi:
state, `iss`, nonce, ID token claims, token responses). It never validates SAML assertions or self-issued
JWTs it sends — the authorization server does (signature, trust in the issuer, audience, validity). The test
authorization server in `test/helpers/lws.js` performs those checks with jose, xml-crypto (reading claims only
from the signed reference) and multiformats/@noble/curves, independently of the library.

## Discovery and trust

- **Challenges.** `WWW-Authenticate` is parsed per RFC 9110; challenges with duplicated parameters are dropped
  and parsing stops at malformed input. oauth4webapi has an equivalent parser but does not export it.
- **LWS.** A `Bearer` challenge with `as_uri` and `realm` selects `LwsTokenProvider` (UMA challenges go to `SolidUmaTokenProvider`). Both values come from the same
  401, so trust is anchored in the requested resource: by default the AS and the realm must be on the
  resource's origin; other bindings need `trustAuthorizationServers` (same-origin realm) or `trustBindings`
  (explicit AS/realm pairs). Only then is containment checked: by path, or under a `StorageRoot` of the
  realm's description that itself links back to that storage.
- **Solid.** Issuers come from the application (picker, hint, fixed) or the WebID (`solid:oidcIssuer`, the
  RDF body is canonical). With `verifyWebId`, the reported WebID must list the issuer (exact identifier
  comparison; only origin-only issuers are treated as equal with and without a trailing slash).
- **Storage context** (`resolveStorageContext`): LWS `Link rel="https://www.w3.org/ns/lws#storage"` and Solid
  `Link rel="http://www.w3.org/ns/solid/terms#storageDescription"` are both supported, never assumed
  interchangeable. Evidence counts only if the response is for the resource itself (no redirect, `anchor`
  respected), the description is same-origin, and the root confirms the binding with its own Link headers
  (LWS: same storage; Solid: `rel="type"` `pim:Storage` and the same description). Otherwise the exact URL is
  the context. Discovery never widens the credential boundary.
- **Solid-OIDC token audience.** Solid-OIDC access tokens are not storage-bound (the ID token audience
  includes `solid`). Sessions are nevertheless keyed per verified storage, so a storage only receives tokens
  obtained for it; the credential boundary decides which URLs may receive any token.

## Draft limitations and ambiguities

1. **ID token type spelling.** lws10-core's metadata example lists `urn:ietf:params:oauth:token-type:id-token`;
   the OpenID suite and request example use the registered `…:id_token`. We send `id_token` and accept either
   in `subject_token_types_supported`.
2. **Metadata location for issuers with paths.** The draft only names the path `/.well-known/lws-configuration`;
   for issuers with a path we insert it before the path (RFC 8414 §3.1). `issuer` must equal `as_uri`.
3. **`kid` form (CID suite).** CID 1.0 §3.3 retrieves verification methods by URL; the suite's example uses a
   bare `kid`. We emit the verification method's absolute URL.
4. **SAML token shape.** The suite example shows a `samlp:Response`; RFC 8693's `saml2` type is an assertion.
   We send the signed `saml:Assertion`. Obtaining it (SP-initiated SSO, bindings) is outside this library.
5. **Client identifier in token exchange.** The draft does not say how the client authenticates at the token
   endpoint. We send `client_id` (the credential's client identifier) with no client authentication.
6. **Access token type.** The draft presents access tokens as Bearer; responses with another `token_type` are
   rejected. No DPoP binding is defined for LWS access tokens.
7. **"Logically contained within the realm".** Undefined beyond examples; we use path containment or a
   confirmed `StorageRoot` of the realm's description.
8. **Audience of ID tokens.** The OpenID suite says `aud` SHOULD include the AS; many OPs cannot. The default
   sends ID tokens to trusted AS bindings regardless; `requireAudience` refuses otherwise.
9. **did:key suite status.** Discontinued in favour of the CID suite (which accepts DIDs); kept because the
   brief asks for all current drafts, and because the encoding is the same.
10. **UMA claims gathering and token format.** Interactive claims gathering (`need_info` + `redirect_user`,
    `request_submitted`) is not automated; `UmaAuthorizationError` exposes the hint and the new ticket. The ID
    token is pushed unencoded (it is already a compact JWT); PCTs and RPT upgrades are not used. The UMA
    metadata `issuer` must equal `as_uri` (origin-only issuers compare with or without a trailing slash).
    The trust policy runs before the OP is resolved or any login happens; RPTs are cached per UMA server,
    resource context and session configuration (OP, redirect URI, account, scopes).
11. **Solid storage roots behind authentication.** If a server does not expose Link headers on an
    unauthenticated `HEAD` of a private root, storage grouping falls back to exact URLs (more silent logins).

## Retained compatibility exceptions

Validation is strict by default except for three workarounds kept from upstream for specific deployments.
They apply automatically **only** to these exact issuer origins, and `serverQuirks: false` (on
`OidcSession`/`DPoPTokenProvider`/`SolidUmaTokenProvider`/`ClientCredentialsTokenProvider` options) disables them:

| Issuer origin | Exception | Standard behaviour otherwise |
| --- | --- | --- |
| `https://login.inrupt.com` | `client_secret_basic` without URL-encoding the ID and secret | RFC 6749 §2.3.1 encoding |
| `https://login.inrupt.com` | `interaction_required` without the RFC 9207 `iss` parameter still triggers the interactive attempt | the response is rejected |
| `https://datapod.igrant.io`, `https://solidweb.org` | ID tokens without `nonce` accepted | `nonce` must match |

`test/quirks.test.js` checks that look-alike issuers get standard behaviour and that the switch works;
PKCE, state and nonce checks for all other issuers are exercised by `test/solid-oidc.test.js`.
