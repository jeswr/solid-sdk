---
name: solid-wac
description: Use when implementing or auditing Solid server WAC authorization, ACL creation and inheritance, auxiliary-resource escalation, method-to-mode mapping, 401 versus 403 challenges, WAC-Allow, or defensive typed ACL parsing with @solid/object and @rdfjs/wrapper.
---

## Quick reference

Resolve the own ACL first, otherwise the nearest ancestor ACL; no ACL means deny all.
Gate every ACL creation/modification path on Control, including POST minting and PATCH create.
Write implies Append; Control does not grant resource-body access. Preserve fail-closed parsing, inheritance, and store errors.
Return 401 for unauthenticated denial and 403 for authenticated denial; WAC-Allow advertises modes only on successful GET/HEAD.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Implementation paths, ADR numbers, server-specific defaults, and commands below refer to
the original `prod-solid-server` implementation, outside this SDK checkout. They document
that server's patterns, rather than files or dependencies to install in this workspace.

# Solid WAC (Web Access Control)

Authorization for a Solid/LDP server. Grounded in `src/authz/{types,mode,wac,acl,wacAllow,public}.ts`
and ADR-0004. WAC is **fail-closed** and **RDF-driven**: `.acl` documents are user-controlled RDF parsed
through **`@solid/object`** typed wrappers. 🔒 = security-critical.

## When to use

Implementing/auditing WAC authorization; parsing or authoring `.acl` documents; reasoning about ACL
inheritance and resource→ACL resolution; 401 vs 403; building the `WAC-Allow` header.

## The four modes — one mapper is the authority

`read` (GET/HEAD/OPTIONS), `write` (PUT/PATCH/DELETE), `append` (POST to a container), `control` (any op
on a `.acl`). `modeForOperation(method, target)` is the **single** place that derives a mode from a
method — never infer a mode from an HTTP verb anywhere else.

```ts
if (isAclResource(target)) return "control";
switch (method) {
  case "GET": case "HEAD": case "OPTIONS": return "read";
  case "POST": return isContainer(target) ? "append" : "write";
  default: return "write";            // PUT, PATCH, DELETE
}
```

**Mode implication is exactly two rules:** `write` subsumes `append`; **`control` does NOT grant
read/write of the resource *body*** (only of its `.acl`). Assume nothing else.

## 🔒 `.acl` creation must be Control-gated on EVERY write verb (auxiliary-mint escalation)

"`control` for an `.acl`" must be enforced wherever a request can **create or modify** an `.acl`, not
just where the request *target* is an `.acl`. The classic bypass (found live in two independent Solid
servers, 2026-06; CTH + two code-review passes missed it): a verb that authorizes only container
`acl:Append`/`acl:Write` and then **mints/writes a child whose name is `<x>.acl`** lets an Append-only
agent install the own-ACL of a private sibling `<x>` and grant itself `control` — full read + ACL
ownership. Two concrete vectors:

- **POST + `Slug: secret.acl`** — POST authorizes `append` on the *container*, but the slug sanitiser
  keeps `.`, so the minted child is `<c>/secret.acl`. Guard the **child-name chokepoint**: reject (409)
  a POST whose minted name resolves to an `.acl` (case-insensitive, trailing-slash-tolerant — a strict
  superset of the resolver's exact-lowercase `aclFor`). Covers `Slug` AND any auto-generated name.
- **PATCH-create / PATCH-modify of an `.acl`** — if `patch()` derives its mode from the patch *content*
  (`append` for an insert-only patch) instead of going through `modeForOperation`, an Append-only agent
  can `PATCH /c/secret.acl` with an INSERT-only body granting itself control. Route an `.acl` target to
  `control` in the PATCH path for BOTH the create branch and the modify branch (don't over-gate ordinary
  resources — `control` only when `isAclResource(target)`, else the patch-derived mode).

Rule of thumb: enumerate **every** path that writes/creates a resource (PUT create+overwrite, POST mint,
PATCH create+modify, DELETE, any container/ancestor auto-create) and confirm each routes an `.acl` target
to `control`. Mode-mapper centrality (above) only helps if every verb actually consults it on create —
PATCH-create and POST-mint are the two that historically don't. `.meta`/other auxiliaries: gate uniformly
across all verbs ONLY if they are access-load-bearing (consulted by the resolver); a non-load-bearing
suffix needs no guard (guarding it only in POST is an inconsistency, not a fix).

## 🔒 ACL resolution walk (own → ancestor → fail-closed)

1. **Own ACL** (`/x.acl`): if present, only its `acl:accessTo` rules for `x` apply — ancestors are **not**
   consulted.
2. **Else** walk ancestors **child→root**, stop at the **first** with an ACL; its `acl:default` rules
   apply. Inheritance is **monolithic, not a union** — the nearest ACL fully governs; a distant one is
   ignored.
3. **No ACL anywhere up to and including the storage root → deny all.** A missing ACL means "unmanaged
   by WAC", not "no rules" — fail-closed.

For a `.acl` resource itself, resolve the ACL of the **protected resource it governs** (strip `.acl`).
Treat the legacy `acl:defaultForNew` exactly like `acl:default`.

## 🔒 Rule matching + agentGroup fail-closed

A rule matches when: `acl:agent` lists the exact WebID IRI (case-sensitive); or `acl:agentClass
foaf:Agent` (public, includes anonymous); or `acl:agentClass acl:AuthenticatedAgent` (any *authenticated*
WebID). **`acl:agentGroup` never matches in v1** (group resolution is a follow-up) — a present group rule
grants no one. Do **not** add a "log and allow" fallback; fail-closed means a misconfigured group rule is
inert, never an attack vector. A rule can list **multiple** `acl:accessTo`/`acl:default` targets —
iterate **every** object, not just the wrapper's first.

## 🔒 House rule: parse/author ACL via typed wrappers, defensively

Parse `.acl` through `@solid/object`'s `AclResource`/`Authorization` wrappers (over `@rdfjs/wrapper`) —
**never** hand-iterate raw quads or string-match Turtle, and never hand-build triples to author one (the
[solid-rdf](../solid-rdf/SKILL.md) discipline). When reading `acl:mode`, **match quads directly and skip any non-`NamedNode`
object** — malformed user literals must be ignored, not crash authorization with a 500.

```ts
for (const q of rule.dataset.match(subject, factory.namedNode(ACL_MODE))) {
  if (q.object.termType !== "NamedNode") continue;       // defensive: skip malformed
  const mode = MODE_FROM_IRI[q.object.value]; if (mode) granted.add(mode);
}
```

## 🔒 Reading ACLs fail-closed on transient errors

`Store.getData(acl)` throwing `NotFoundError` = ACL missing → continue inheritance (OK). **Any other
error** (transient store failure, parse error) must **propagate and fail authorization** — never treat it
as "no ACL", which would fail-open.

## 401 vs 403 + WWW-Authenticate

Unauthenticated (`credentials.webId === undefined`) and denied → **401** with a `WWW-Authenticate`
challenge (`Bearer scope="webid", DPoP scope="webid"`) — "authenticate and retry". Authenticated but
lacking the mode → **403** — "a valid token won't help here". The distinction is semantic; reversing it
breaks client auth flows.

## WAC-Allow header

On a successful **GET/HEAD only** (never on mutations or errors), advertise effective modes:
`user="…",public="…"` — what the authenticated requester vs an anonymous requester may do, both from the
same effective ACL. Canonical order `read write append control`; emit empty groups too (`user="",public=""`).

## Gotchas

- [ ] `modeForOperation()` is the **only** method→mode inference in the codebase.
- [ ] No ACL anywhere → deny all (fail-closed); missing ACL ≠ "no rules".
- [ ] Nearest ACL fully governs (monolithic); ancestors walked child→root, stop at first.
- [ ] `acl:agentGroup` never matches in v1 — no silent allow.
- [ ] `appliesToResource` iterates **all** `acl:accessTo`/`acl:default` objects.
- [ ] `write` subsumes `append`; `control` ≠ read/write of the body.
- [ ] Parse `.acl` via `@solid/object`; skip non-`NamedNode` `acl:mode` objects (don't 500).
- [ ] `NotFoundError` → inherit; any other store error → fail authorization.
- [ ] 401 (unauthenticated) vs 403 (insufficient) — check `credentials.webId` explicitly.
- [ ] `WAC-Allow` only on GET/HEAD; it advertises, never grants.

## See also

- Code: `src/authz/{mode,wac,acl,wacAllow}.ts`, `test/unit/authz/wac.test.ts`; ADR-0004.
  Related: [solid-rdf](../solid-rdf/SKILL.md) (ACL parsing/serialisation), [solid-auth](../solid-auth/SKILL.md) (the `credentials` it consumes),
  [solid-conformance](../solid-conformance/SKILL.md) (the WAC test suite).
- Specs / libs (Context7): `@solid/object`, `@rdfjs/wrapper`, W3C Web Access Control, Solid Protocol
  (WAC + `WAC-Allow`), W3C LDP.
