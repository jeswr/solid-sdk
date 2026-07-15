---
name: solid-client-id
description: Use when publishing or debugging a Solid-OIDC Client Identifier Document, choosing static client identity over dynamic registration, fixing redirect_uri mismatches, or configuring a deployed app's stable client name and metadata.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Publish a Solid Client Identifier Document

A Client Identifier Document is a dereferenceable JSON-LD document whose URL is the OAuth `client_id`. Prefer it for deployed public clients so the identity provider sees one stable app identity.

## Required shape

```json
{
  "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
  "client_id": "https://app.example/clientid.jsonld",
  "client_name": "Example App",
  "redirect_uris": ["https://app.example/callback"],
  "scope": "openid webid offline_access",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "client_uri": "https://app.example/"
}
```

## Rules

- Make `client_id` equal the served document URL byte-for-byte, including scheme, host, port, path, and trailing slash.
- Serve production documents over HTTPS with `application/ld+json`.
- List every permitted callback as an absolute URL in `redirect_uris`.
- Include `openid webid`; request `offline_access` when the app supports refresh-based restore.
- Use `token_endpoint_auth_method: "none"` for a browser/public client. Do not publish a client secret.
- Keep the document reachable during login and use a short cache lifetime while changing metadata.
- Derive environment-specific URLs from one trusted origin input; do not let `.env` precedence produce a localhost client ID in a production build.
- Register both popup and full-page callback URLs when supporting both flows.

Static localhost identity works only when the local identity provider can dereference it and permits loopback HTTP. A remote identity provider cannot fetch the developer's localhost; use dynamic registration or a public HTTPS deployment for that combination.

Debug exact URL equality first for “client_id must match” errors and the published `redirect_uris` for redirect mismatch errors.

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-frontend-dev` persona from
[`.claude/agents/solid-frontend-dev.md`](../../.claude/agents/solid-frontend-dev.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
