---
name: solid-lws
description: Use when implementing or debugging Linked Web Storage (LWS) protocol discovery, CID storage descriptions, authentication suites and token exchange, container listings or pagination, or distinguishing an LWS server from a Solid server. Covers HTTP and document contracts for app and server authors; SDK APIs are outside this skill.
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

- Discover storage through `Link` relation `https://www.w3.org/ns/lws#storage` on GET/HEAD responses; dereference its target for the CID storage description. [Core § Discovery and Binding](https://w3c.github.io/lws-protocol/lws10-core/#storage-description-binding).
- Find the root through the description's `StorageRoot` service and `serviceEndpoint`; the storage identifier and root container URL can differ. [Core § Storage Services](https://w3c.github.io/lws-protocol/lws10-core/#storage-description-services).
- On a protected resource's 401, follow `WWW-Authenticate`'s `resource_metadata` discovery, validate the binding, then discover the authorization server's `/.well-known/lws-configuration`. [Core § Authorization Server Discovery](https://w3c.github.io/lws-protocol/lws10-core/#authorization-server-discovery), [§ Discovery Validation](https://w3c.github.io/lws-protocol/lws10-core/#authorization-discovery-validation), [§ Authorization Server Metadata](https://w3c.github.io/lws-protocol/lws10-core/#authorization-server-metadata).
- Exchange an authentication credential for a storage-audience access token; present that access token using the Bearer scheme. [Core § Token Exchange](https://w3c.github.io/lws-protocol/lws10-core/#authorization-token-exchange), [§ Presentation](https://w3c.github.io/lws-protocol/lws10-core/#authorization-token-validation-presentation).
- Read containers as `application/lws+json`; follow opaque pagination `Link` targets. [Core § LWS Media Type](https://w3c.github.io/lws-protocol/lws10-core/#lws-media-type).
- Navigate containment through `up` and `items`, independently of URI paths. [Core § Logical Resource Organization](https://w3c.github.io/lws-protocol/lws10-core/#logical-resource-organization).

## Scope and source baseline

Use this skill for protocol decisions by clients and servers. It deliberately defines no SDK API
(the SDK API skills belong to T-100). Read [authentication suites](references/authentication.md)
when selecting a credential format or implementing credential validation.

Reviewed against the `lws10-*` editor sources in
[`w3c/lws-protocol` revision 181ed0dcdfad0aecc2b226f55e24e0f2e5f7cfe1](https://github.com/w3c/lws-protocol/tree/181ed0dcdfad0aecc2b226f55e24e0f2e5f7cfe1),
on 2026-10-26. Section links below target the editor drafts and can change; recheck the target
server's supported revision before treating a mismatch as a server bug. The core is work in progress,
not a final standard. [Core § Status](https://w3c.github.io/lws-protocol/lws10-core/#sotd).
The comparison uses Solid Protocol 0.11.0 (2024-05-12) and Solid-OIDC 0.1.0 (2022-03-28).

Uppercase requirement words below summarize the linked normative sections. Guidance explicitly
labelled as implementation advice is local advice, not an additional LWS conformance requirement.

## Detect the protocol and discover services

1. Start with a supplied resource URL and GET or HEAD it. An LWS server MUST include a storage
   link on all such storage-resource responses. Resolve the advertised target and request
   `Accept: application/lws+cid`; do not synthesize a storage URL by trimming path segments.
   [Core § Discovery and Binding](https://w3c.github.io/lws-protocol/lws10-core/#storage-description-binding).
2. Validate the description as a Controlled Identifier (CID) document specialized for LWS:
   `id` MUST be the canonical storage URI, `type` MUST equal or include `Storage`, and `service`
   MUST include a `StorageRoot` service. Every service has a required URI `serviceEndpoint`.
   [Core § Storage Description Data Model](https://w3c.github.io/lws-protocol/lws10-core/#storage-description-data-model).
3. For `application/lws+cid`, `@context` MUST be an array beginning, in order, with
   `https://www.w3.org/ns/cid/v1` and `https://www.w3.org/ns/lws/v1`. Other negotiated
   representations are permitted. Follow `StorageRoot.serviceEndpoint` for the container
   hierarchy; it is distinct in role from the description's `id`.
   [Core § Storage Description Representation](https://w3c.github.io/lws-protocol/lws10-core/#storage-description-representation),
   [§ Storage Services](https://w3c.github.io/lws-protocol/lws10-core/#storage-description-services).
4. For authentication, inspect the protected-resource response and use the validation and
   exchange procedure below. A Bearer challenge by itself does not identify LWS: the useful
   evidence is the combination of the storage link, valid description, protected-resource
   metadata, and LWS authorization-server configuration.
   [Core § Authorization Server Discovery](https://w3c.github.io/lws-protocol/lws10-core/#authorization-server-discovery),
   [§ Authorization Server Metadata](https://w3c.github.io/lws-protocol/lws10-core/#authorization-server-metadata).
5. Branch on advertised services and capabilities. A storage MAY offer notifications or type
   discovery; their service entries identify the available endpoints. Movement requires a
   `MoveResource` capability; clients MUST NOT assume `up` is writable without it.
   [Core § Notification Discovery](https://w3c.github.io/lws-protocol/lws10-core/#notification-discovery),
   [Index § Discovery](https://w3c.github.io/lws-protocol/lws10-index/#discovery),
   [Core § Storage Capabilities](https://w3c.github.io/lws-protocol/lws10-core/#storage-description-capabilities).

Implementation advice: record evidence per endpoint rather than identifying a product by hostname,
`Server` header, or the presence of JSON-LD. Solid evidence includes its storage-description relation
and LDP container representation (see table). Missing or unreadable discovery metadata means
**unknown or incomplete discovery**, not proof of the other protocol. A server can expose both;
keep the selected protocol explicit and send credentials only after validating that flow.
This is an inference from the separate discovery contracts, not a standardized LWS detection flag.

## Authentication and authorization are separate steps

The authentication credential describes a subject, issuer, client, and recommended audience
restriction; it MUST be signed. Specific serialization and trust checks depend on the suite.
[Core § Credential Data Model](https://w3c.github.io/lws-protocol/lws10-core/#authentication-data-model),
[§ Credential Validation](https://w3c.github.io/lws-protocol/lws10-core/#authentication-validation).
See the [suite mapping and verification rules](references/authentication.md).

Before token exchange, a client MUST validate all three discovery bindings and MUST NOT use
failed discovery values to request a token:

- The challenge's `resource_metadata` URL has the same scheme and authority as the requested URI.
- The metadata document's `resource` is identical to that requested URI.
- The linked storage description's `StorageRoot.serviceEndpoint` has the same scheme and authority
  as the requested URI.

[Core § Discovery Validation by a Client](https://w3c.github.io/lws-protocol/lws10-core/#authorization-discovery-validation).

The protected-resource metadata MUST conform to RFC 9728 and its `authorization_servers` MUST
contain at least one issuer identifier. Each authorization server MUST publish RFC 8414 metadata
at `/.well-known/lws-configuration`. `subject_token_types_supported` and
`subject_identifier_types_supported` are optional advertisements, so their absence is not an
empty list of supported suites. [Core § Protected Resource Metadata](https://w3c.github.io/lws-protocol/lws10-core/#protected-resource-metadata),
[§ Authorization Server Metadata](https://w3c.github.io/lws-protocol/lws10-core/#authorization-server-metadata).

The token endpoint MUST support `urn:ietf:params:oauth:grant-type:token-exchange`. Send the
credential as `subject_token`, with the suite's `subject_token_type`. The required `resource`
parameter is the **storage URI from the storage link**, not the requested file URI, authorization
server URI, or root container endpoint. The authorization server MUST validate presented tokens
and reject unknown or untrusted storages. [Core § Token Exchange Request](https://w3c.github.io/lws-protocol/lws10-core/#authorization-token-exchange-request).

The resulting access token MUST follow RFC 9068 and include `sub`, `iss`, `client_id`, `aud`,
`exp`, `iat`, and `jti`; its audience includes that storage URI. Present the access token to
storage with `Authorization: Bearer …`. The storage server MUST verify signature, issuer,
storage audience, expiration, optional `nbf`, and that `iat` is not in the future, allowing
clock skew; it MUST reject validation failures with 401 and the discovery challenge. A valid
token still does not bypass authorization policy. [Core § Token Exchange Response](https://w3c.github.io/lws-protocol/lws10-core/#authorization-token-exchange-response),
[§ Presentation](https://w3c.github.io/lws-protocol/lws10-core/#authorization-token-validation-presentation),
[§ Validation](https://w3c.github.io/lws-protocol/lws10-core/#authorization-token-validation-verification).

Implementation advice: apply client trust policy to the discovered authorization server before
sending a subject credential. For server-side retrieval, use SSRF safeguards for discovered URLs;
prefer audience-limited credentials, short-lived access tokens, and safe credential storage.
These are security recommendations, not evidence that every LWS deployment requires DPoP.
[Core § Resource Discovery Security](https://w3c.github.io/lws-protocol/lws10-core/#security-resource-discovery),
[§ Token Security](https://w3c.github.io/lws-protocol/lws10-core/#security-token-security).

## Containers and pagination

Containers MUST support `application/lws+json`. Its required properties are `id`,
`type: "Container"`, `totalItems`, and `items`. Each member MUST have `id` and a `type` equal to
`DataResource` or `Container`, or an array including one of them; `format` is required for data
resources, while `size` and `modified` are recommended. `totalItems` is required but MAY be
approximate, so it is not a reliable loop termination condition.
[Core § Containers](https://w3c.github.io/lws-protocol/lws10-core/#containers),
[§ LWS Media Type](https://w3c.github.io/lws-protocol/lws10-core/#lws-media-type).

A non-root resource's GET/HEAD response MUST link to its parent with `rel="up"`.
Containment follows those links and container `items`, not URL layout. The server maintains
membership; creation, deletion, and supported moves change it atomically. Read access to a
container does not imply read access to its members, or vice versa.
[Core § Logical Resource Organization](https://w3c.github.io/lws-protocol/lws10-core/#logical-resource-organization).

For a paginated listing, the response MUST use 200. `items` covers the current page while `id`,
`type`, and `totalItems` describe the whole collection. `Link rel="first"` MUST be present,
`next` MUST be present when more pages exist and absent on the last page; `last` and `prev`
are optional, with `prev` absent on the first page. Clients SHOULD follow the opaque supplied
URIs rather than constructing or changing page parameters.
[Core § LWS Media Type — Pagination](https://w3c.github.io/lws-protocol/lws10-core/#lws-media-type).

Implementation advice: fetch each supplied `next` URI until no next link remains, with cycle
and resource limits for malformed servers. Preserve the selected representation and apply the
same credential destination policy to each request. Do not treat an empty `items` page or an
approximate count as the end while `next` is present. RDF container representations negotiated
with the LWS profile MUST be isomorphic to the same JSON-LD state and page; Turtle alone does
not make a response a Solid LDP container.
[Core § LWS Media Type — Content Negotiation and Pagination](https://w3c.github.io/lws-protocol/lws10-core/#lws-media-type).

## Resource operations and metadata

Create with POST to an existing container and use the returned `Location` from the required
201 response. Creating a container requires a `Link rel="type"` targeting
`https://www.w3.org/ns/lws#Container`. PUT/PATCH update existing resource content; they do not
provide Solid's implicit intermediate-container creation contract.
[Core § Create Resource](https://w3c.github.io/lws-protocol/lws10-core/#create-resource),
[§ Update Resource](https://w3c.github.io/lws-protocol/lws10-core/#update-resource).

Discover metadata via `Link rel="linkset"`; the linkset MUST be available as
`application/linkset+json`. Check `Allow` and `Accept-Patch` before selecting an update:
JSON Patch is required, but linkset PUT is optional and advertised. Clients SHOULD use
conditional requests for linkset updates; failed preconditions MUST return 412. Preserve
server-managed links. A resource-content update does not update links by default; combined
content/link updates using `Prefer: set-linkset` are optional.
[Core § Resource Metadata](https://w3c.github.io/lws-protocol/lws10-core/#metadata),
[§ Update Resource](https://w3c.github.io/lws-protocol/lws10-core/#update-resource).

## Solid versus LWS

These are protocol contracts, not claims about every deployed server or compatibility guarantees.
Each cell links to the section defining the behavior.

| Area | Solid baseline | LWS draft baseline |
|---|---|---|
| Storage discovery | `solid:storageDescription` link; storage itself is a root container. [Solid § Storage Resource](https://solidproject.org/TR/2024/protocol-20240512#storage-resource) | `lws:storage` link to CID description; `StorageRoot` service locates the root. [Core § Discovery](https://w3c.github.io/lws-protocol/lws10-core/#discovery) |
| Containment | LDP Basic Container and URI path hierarchy correspond. [Solid § Resource Containment](https://solidproject.org/TR/2024/protocol-20240512#resource-containment) | `up` and `items`; resource identifiers independent of hierarchy. [Core § Logical Resource Organization](https://w3c.github.io/lws-protocol/lws10-core/#logical-resource-organization) |
| Identity trust | WebID profile's `solid:oidcIssuer`. [Solid-OIDC § Issuer Discovery](https://solidproject.org/TR/2022/oidc-20220328#oidc-issuer-discovery) | Suite-specific: CID `OpenIdProvider` service, SAML trust, or CID verification method. [OpenID § Validation](https://w3c.github.io/lws-protocol/lws10-authn-openid/#validation), [SAML § Validation](https://w3c.github.io/lws-protocol/lws10-authn-saml/#validation), [SSI-CID § Validation](https://w3c.github.io/lws-protocol/lws10-authn-ssi-cid/#validation) |
| Authorization discovery | Challenge `as_uri`, unless the scheme defines another mechanism. [Solid-OIDC § Authorization Server Discovery](https://solidproject.org/TR/2022/oidc-20220328#authorization-server-discovery) | Challenge `resource_metadata`, protected-resource metadata, then LWS configuration. [Core § Authorization Protocol Flow](https://w3c.github.io/lws-protocol/lws10-core/#authorization-protocol-flow) |
| Token flow | DPoP-bound ID Token validation before access-token issuance. [Solid-OIDC § DPoP Validation](https://solidproject.org/TR/2022/oidc-20220328#dpop-validation) | Token exchange and Bearer baseline; additional mechanisms permitted. [Core § Authorization](https://w3c.github.io/lws-protocol/lws10-core/#authorization) |
| Create resources | POST; PUT/PATCH create intermediate containers. [Solid § Writing Resources](https://solidproject.org/TR/2024/protocol-20240512#writing-resources) | POST to an existing container, server assigns the identifier. [Core § Create Resource](https://w3c.github.io/lws-protocol/lws10-core/#create-resource) |
| Listing pages | LDP container representation. [Solid § Resource Containment](https://solidproject.org/TR/2024/protocol-20240512#resource-containment) | LWS JSON-LD container; opaque HTTP pagination links. [Core § LWS Media Type](https://w3c.github.io/lws-protocol/lws10-core/#lws-media-type) |

## Optional services and pitfalls

- Type discovery is server-managed: discover `TypeIndexService` / `TypeSearchService` before use.
  Type Index uses GET; Type Search uses QUERY with `application/lws-query+json`. These are not
  Solid TypeRegistration documents. Authorization-filtered responses and counts MUST NOT expose
  unreadable entries, including after revocation; derivation may be eventually consistent.
  [Index § Discovery](https://w3c.github.io/lws-protocol/lws10-index/#discovery),
  [§ Type Index GET](https://w3c.github.io/lws-protocol/lws10-index/#type-index-get),
  [§ Type Search QUERY](https://w3c.github.io/lws-protocol/lws10-index/#type-search-query),
  [§ Security and Authorization](https://w3c.github.io/lws-protocol/lws10-index/#security-authorization).
- For notifications, follow `NotificationService.subscriptionType`; do not infer Solid WebSocket
  support. The webhook suite uses `WebhookSubscription` and an `inbox` URI. Signing is a SHOULD;
  a receiver of a signed delivery MUST verify its signature. Subscription and delivery authorization
  protect the underlying resources. [Core § Notification Discovery](https://w3c.github.io/lws-protocol/lws10-core/#notification-discovery),
  [§ Subscription Authorization](https://w3c.github.io/lws-protocol/lws10-core/#subscription-authorization),
  [Webhook § Subscription](https://w3c.github.io/lws-protocol/lws10-notifications-webhook/#webhook-subscription),
  [§ Authentication](https://w3c.github.io/lws-protocol/lws10-notifications-webhook/#webhook-authentication).
- Access-grant records are not access tokens. Where advertised, `AccessRequestService` and
  `AccessGrantService` use supported access profiles; the server adjusts its underlying policy
  when grants change. Do not infer WAC or ACP from those services.
  [Core § Access Requests and Grants](https://w3c.github.io/lws-protocol/lws10-core/#access-requests-and-grants),
  [§ Access Discovery](https://w3c.github.io/lws-protocol/lws10-core/#access-discovery).
