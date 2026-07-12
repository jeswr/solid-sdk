---
name: solid-server-matrix
description: Use when a Solid client works against one server but fails against another, diagnosing CSS, ESS, NSS, WAC versus ACP, DPoP strictness, missing Type Indexes, ETag differences, notifications, or misleading browser CORS errors.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Diagnose Solid server differences

Probe capabilities at runtime. Hostname tables are hints, not a protocol contract.

## High-value differences

| Area | Community Solid Server | Enterprise Solid Server | node-solid-server |
|---|---|---|---|
| Access control | Usually WAC | ACP | WAC |
| Type Index seed | Do not assume; apps often create/link it | Probe | Historically seeded; probe |
| ETags | Normally available | Normally available | May be absent |
| Notifications | Solid Notifications Protocol | Probe advertised services | Legacy `Updates-Via` WebSocket |
| DPoP | Strict enough to expose malformed `iat`/proofs | Different tolerance and UMA behavior | Legacy/non-conformant edges |

## Detection workflow

1. Read the resource's `Link: ...; rel="acl"`, fetch the linked document, and identify WAC (`acl:`) versus ACP (`acp:`) from RDF. Never guess `.acl`/`.acr` paths.
2. Inspect an unauthenticated protected response's `WWW-Authenticate` for the advertised auth scheme and parameters.
3. Discover notifications through resource/storage description links; fall back to `Updates-Via` only for the legacy path.
4. Record whether reads/writes return ETags and branch explicitly when conditional writes are unavailable.
5. Read the WebID/profile for Type Index links; if genuinely absent, create and link them without overwriting an unreadable existing resource.

## Common diagnoses

- CSS rejecting “iat is not recent enough”: ensure DPoP `iat` is epoch seconds and remove duplicate auth layers.
- `500` on legacy PUT: send an explicit content type.
- Empty Type Index on CSS: bootstrap it; the server does not enforce the convention.
- Container redirect or broken relative IRIs: normalize the trailing slash.
- Browser “CORS” message: inspect the underlying 401 and proxy-exposed headers before changing CORS policy.
- Reload loses auth: restore from the DPoP-bound refresh credential rather than relying only on memory or an IdP cookie.

Test at least one WAC and one ACP deployment for access-control work, and retain targeted legacy coverage only where supported interoperability requires it.
