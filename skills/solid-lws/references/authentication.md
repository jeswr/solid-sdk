<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# LWS authentication suites

Read this when choosing a subject credential for token exchange or implementing its verifier.
These are the suite editor drafts at the revision recorded in [the skill](../SKILL.md#scope-and-source-baseline).
The authentication credential is the exchange input; the storage receives the resulting access
token. [Core § Token Exchange](https://w3c.github.io/lws-protocol/lws10-core/#authorization-token-exchange).

## Credential mappings

| Suite | Required subject / issuer / client mapping | `subject_token_type` |
|---|---|---|
| OpenID Connect | Signed ID Token: `sub` / `iss` / `azp`; `alg: none` forbidden. [OpenID § Serialization](https://w3c.github.io/lws-protocol/lws10-authn-openid/#serialization) | `urn:ietf:params:oauth:token-type:id_token`. [OpenID § Token Type](https://w3c.github.io/lws-protocol/lws10-authn-openid/#token-type) |
| SAML 2.0 | Signed SAML token: `saml:NameID` / `saml:Issuer` / `saml:SubjectConfirmationData@Recipient`. [SAML § Serialization](https://w3c.github.io/lws-protocol/lws10-authn-saml/#serialization) | `urn:ietf:params:oauth:token-type:saml2`. [SAML § Token Type](https://w3c.github.io/lws-protocol/lws10-authn-saml/#token-type) |
| Self-signed CID | Signed JWT: `sub` / `iss` / `client_id` MUST be the same URI; `alg: none` forbidden; `exp` and `iat` required. [SSI-CID § Serialization](https://w3c.github.io/lws-protocol/lws10-authn-ssi-cid/#serialization) | `urn:ietf:params:oauth:token-type:jwt`. [SSI-CID § Token Type](https://w3c.github.io/lws-protocol/lws10-authn-ssi-cid/#token-type) |

The core model requires URI subject and issuer identifiers, recommends a URI client identifier,
and recommends an audience restriction including an authorization server. The supported suites
and identifier types are deployment capabilities; an LWS deployment does not promise support
for every identity provider or suite. [Core § Credential Data Model](https://w3c.github.io/lws-protocol/lws10-core/#authentication-data-model),
[§ Introduction](https://w3c.github.io/lws-protocol/lws10-core/#introduction),
[§ Authorization Server Metadata](https://w3c.github.io/lws-protocol/lws10-core/#authorization-server-metadata).

## OpenID Connect verifier

In the absence of a pre-existing trust relationship, the validator MUST dereference the token's
`sub` and obtain a valid CID document whose `id` equals that subject. It MUST locate a service
with `type` equal to `https://www.w3.org/ns/lws#OpenIdProvider` and `serviceEndpoint` equal to
`iss`, use OpenID Connect Discovery for the signing key, and validate the JWT per OIDC Core
§3.1.3.7. This CID issuer binding differs from Solid's `solid:oidcIssuer` profile statements.
[OpenID § Validation](https://w3c.github.io/lws-protocol/lws10-authn-openid/#validation),
[Solid-OIDC § Issuer Discovery](https://solidproject.org/TR/2022/oidc-20220328#oidc-issuer-discovery).

Any audience restriction uses `aud`, which SHOULD include the client identifier and additional
targets such as the authorization server. The LWS client mapping is `azp`, not `client_id` in
this subject credential. [OpenID § Serialization](https://w3c.github.io/lws-protocol/lws10-authn-openid/#serialization).

## SAML verifier

Trust in the issuing identity provider is established out of band; the suite does not define
subject-URI dereferencing as its trust mechanism. Using that trust relationship, the verifier
MUST validate the signature per SAML Core §5. [SAML § Validation](https://w3c.github.io/lws-protocol/lws10-authn-saml/#validation).

Any audience restriction uses `saml:Audience`, which SHOULD include the client identifier and
additional targets such as the authorization server. Preserve the `Recipient` client mapping
from the table; do not substitute a JWT claim mapping.
[SAML § Serialization](https://w3c.github.io/lws-protocol/lws10-authn-saml/#serialization).

## Self-signed CID verifier

In the absence of a pre-existing trust relationship, the verifier MUST dereference `sub` and
obtain a valid CID document with matching `id`. It MUST reject `alg: none`, validate all claims
in the credential data model, use JWT-header `kid` to select a verification method from the
subject's CID document, verify the JWS signature, and check expiration (small clock-skew leeway
is permitted). [SSI-CID § Validation](https://w3c.github.io/lws-protocol/lws10-authn-ssi-cid/#validation).

The `aud` claim MUST include the target authorization server. HTTPS and DID subject identifiers
are within the suite's scope; compatibility still depends on the target deployment's supported
identifier types. [SSI-CID § Serialization](https://w3c.github.io/lws-protocol/lws10-authn-ssi-cid/#serialization),
[§ Introduction](https://w3c.github.io/lws-protocol/lws10-authn-ssi-cid/#introduction),
[Core § Authorization Server Metadata](https://w3c.github.io/lws-protocol/lws10-core/#authorization-server-metadata).

The older `lws10-authn-ssi-did-key` draft is discontinued in favor of SSI-CID. Use SSI-CID for
current work; treat the old document only as historical material, not a fourth active suite.
[Discontinued did:key § Status](https://w3c.github.io/lws-protocol/lws10-authn-ssi-did-key/#sotd).
