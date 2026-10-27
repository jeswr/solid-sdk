<!-- AUTHORED-BY Claude Opus 5.5 -->

# Pod Migrator design

Pod Migrator copies everything a user holds in one Solid pod into another pod, in either
direction, and carries the access controls across. The first-class pair is Inrupt PodSpaces
(ESS, Access Control Policies) and solidcommunity.net (Web Access Control). Same-model
migrations (WAC to WAC, ACP to ACP) use the same pipeline.

The one rule that overrides every other consideration: **a migration never makes any resource
more accessible than it was in the source, at any moment, including partway through.** When a
rule cannot be expressed faithfully, the migrator either drops it, substitutes something
strictly narrower, or stops. It never substitutes something broader.

## 1. Two sessions, two fences

The app holds two independent `createSolidAuth()` instances from `@jeswr/solid-auth-core`,
`source` and `target`. Each has its own `dbName`, `rememberedAccountsKey`, `recentAccountsKey`,
`redirectFlowKey`, `redirectSentinelKey` and `redirectUri` (`/callback/source`,
`/callback/target`), and `patchGlobalFetch: false`, so neither touches the global fetch and the
two credentials can never be confused.

Each instance is armed with `includeIssuerOrigin: false`. After login the app reads the
authenticated WebID profile, takes `pim:storage` (asking the user to choose when there are
several), and calls `reArmAllowedOrigins([storageOrigin])`.

The migration engine never sees `authenticatedFetch` directly. It gets a `PodHttp` per side
(`src/engine/pod-http.ts`), which:

- accepts only a string URL (never a `Request`, never a `URL` subclass), parses it, and requires
  it to be inside that side's storage root by path, not just by origin (`assertWithinPodScope`
  from `@jeswr/guarded-fetch`). PodSpaces serves every user's pod from the same origin, so
  origin alone is not a fence;
- builds the request from that checked string only (this sidesteps the shadowed-`Request`
  credential leak tracked as sst-m040, which needs the caller to hand a crafted `Request` to the
  token provider);
- sends `redirect: "manual"` and treats any 3xx as an error;
- refuses caller-supplied `Authorization` and `DPoP` headers;
- validates any `Location` it acts on against the same root.

Data crosses from source to target only as bytes plus a content type. No header, URL or
`Request` object from one side is ever passed to the other side's `PodHttp`.

## 2. Pipeline

1. **Crawl** (read only). Walk the source root breadth first through `ldp:contains`, read with
   `@jeswr/fetch-rdf` and `@solid/object`'s `Container`. Skip auxiliary resources (`.acl`,
   `.acr`, `.meta`, anything advertised as `rel="acl"` or `rel="describedby"`). For every
   resource record URL, kind, content type, size, and its ACL/ACR URL from the `Link` header.
2. **Read access** (read only). Detect the access-control system per side (see section 4) and
   read every ACL or ACR into the neutral model (section 3). Unreadable rules (403 / 404 on an
   advertised ACL) become report items.
3. **Plan** (pure). Compute each source resource's effective permissions, translate them to the
   target's system, and collect every place the translation is not faithful as a `ReportItem`.
   Also check the target: existing resources at the same path, the target's own root ACL and
   WebID profile document.
4. **Review** (UI). Show the plan: resource counts, bytes, and every report item with its
   options. Nothing has been written yet. The user resolves each item or aborts. Resolutions can
   be applied in bulk per item kind.
5. **Execute** (writes, target only). Three phases, in order:
   - *Lock.* Create each target container top down. Immediately after creating one, write an
     owner-only ACL/ACR on it (owner gets Read, Write, Control on the container and its members;
     nothing else). Before writing any resource directly into a target container that already
     existed before the migration, first create it empty, lock it owner-only, then write its
     content.
   - *Copy.* PUT each resource's bytes with its content type and `If-None-Match: *` (never
     overwrite unless the user chose "overwrite" for that path). RDF documents may optionally have
     source-pod IRIs rewritten to target-pod IRIs (parse with `@jeswr/fetch-rdf`, rewrite terms,
     serialise with `n3.Writer`); off by default the bytes are copied verbatim.
   - *Grant.* Write the final ACLs/ACRs **bottom up** (deepest first, containers after their
     members). Every intermediate state is a subset of the final state, which is a subset of the
     source.
6. **Verify.** Re-read each written ACL/ACR, re-parse it, and compare it with the planned rules.
   Read back each copied resource's size or hash. Produce a final report (downloadable JSON).

Cancel is available at every step. A cancel during execute stops after the in-flight request;
everything already copied stays owner-only or at its final, never-wider state, and the report
lists what was and wasn't done. The run log is kept in `sessionStorage` so a reload can show it.

## 3. Neutral model

```ts
type Mode = "read" | "append" | "write" | "control";
type Subject =
  | { kind: "agent"; webId: string }
  | { kind: "public" }                 // foaf:Agent / acp:PublicAgent
  | { kind: "authenticated" }          // acl:AuthenticatedAgent / acp:AuthenticatedAgent
  | { kind: "group"; group: string }   // WAC acl:agentGroup (vcard:Group IRI)
  | { kind: "creator" } | { kind: "owner" } // ACP only
  | { kind: "client"; clientId: string }   // ACP acp:client
  | { kind: "issuer"; issuer: string }     // ACP acp:issuer
  | { kind: "vc"; vcType: string }         // ACP acp:vc
  | { kind: "origin"; origin: string };    // WAC acl:origin
interface Grant {
  modes: Set<Mode>;
  /** Disjunction of conjunctions: the grant applies when every subject in ANY clause matches. */
  who: Subject[][];
  /** Subjects that must NOT match (ACP noneOf). */
  except: Subject[];
  appliesTo: "resource" | "members" | "both";
  source: { url: string; node: string }; // provenance for the report
}
interface Denial { modes: Set<Mode>; who: Subject[][]; except: Subject[]; appliesTo: ...; source: ... }
interface EffectivePolicy { grants: Grant[]; denials: Denial[] } // per resource, after inheritance
```

`write` implies `append` in both systems; normalise on read.

### Reading WAC

Per the WAC spec: an authorization with `acl:accessTo` applies to the resource, `acl:default`
to the container's members. Subjects are the union of `acl:agent`, `acl:agentClass`
(`foaf:Agent` = public, `acl:AuthenticatedAgent`), and `acl:agentGroup`. `acl:origin` is an
extra condition ANDed with the subject (one clause per subject, each with the origin added).
Effective policy of a resource: its own ACL's `accessTo` authorizations when it has an ACL;
otherwise the `default` authorizations of the nearest ancestor ACL. A child ACL replaces, never
merges with, the inherited defaults.

### Reading ACP

Per the ACP spec: an ACR's `acp:accessControl` applies to the resource, `acp:memberAccessControl`
to all descendants and is **additive**: a descendant cannot remove an ancestor's member
controls. Each access control applies policies; a policy has `acp:allow` / `acp:deny` modes and
`acp:allOf` (all matchers must match), `acp:anyOf` (at least one), `acp:noneOf` (none). A
matcher matches when any of its `acp:agent` / `acp:client` / `acp:issuer` / `acp:vc` values
match; `acp:agent` may be `acp:PublicAgent`, `acp:AuthenticatedAgent`, `acp:CreatorAgent`,
`acp:OwnerAgent`. A mode is granted when an applicable policy allows it and no applicable
policy denies it. Control is access to the ACR itself (`acp:access` / control mode as the
server implements it; verify against both the spec copy and CSS's ACP implementation).
Translate `allOf`/`anyOf`/`noneOf` into the `who`/`except` normal form; a policy whose
expansion exceeds 64 clauses is a report item (`too-complex`) rather than silently truncated.

## 4. Detecting the system

Follow `Link: <…>; rel="acl"` from the root. If that resource is advertised as
`acp:AccessControlResource` (Link `type`) or parses to triples using the ACP namespace, the side
is ACP; if it uses `acl:Authorization`, WAC. If the root has no ACL link, or the two signals
conflict, the side is `unknown` and the plan refuses to translate permissions (the user can
still copy data with everything owner-only).

## 5. Translation rules

Translation works on effective policies, never on raw documents. The target owner (the WebID
signed in on the target) always gets `read`, `write`, `control` on everything written, so the
migration can never lock the user out; this is not a widening because the owner already
controls the target pod.

| Source construct | To WAC | To ACP | If not faithful |
|---|---|---|---|
| agent, public, authenticated | same | same | — |
| WAC `agentGroup` | same | no equivalent | `group-unsupported`: **skip** (drop the grant) / **expand** to the group's current members, read at plan time, shown as a list, with a warning that later membership changes won't follow / **abort** |
| WAC `acl:origin` | same | no equivalent (`acp:client` is a client id, not an origin) | `origin-unsupported`: **skip** / **abort**. Dropping the origin condition would widen, so it is never offered |
| ACP `client`, `issuer`, `vc` in a clause | no equivalent | same | `condition-unsupported`: **skip the clause** / **abort**. Never drop just the condition |
| ACP `noneOf` exclusions | no equivalent | same | `exclusion-unsupported`: **skip the grant** / **abort** |
| ACP `deny` | subtract it when the denial's subjects exactly cover a grant's clause; otherwise | same | `deny-unsupported`: **drop every grant the denial overlaps** (narrowest) / **abort** |
| ACP `creator` / `owner` | target owner WebID | same | info item `owner-mapped` |
| Grant to the source owner's WebID | kept verbatim (it is the same person, and they may still use that WebID) | same | info item |
| WAC child ACL narrower than an inherited default | write the child ACL | ACP inheritance is additive, so the parent's member rules would reach the child | `inheritance-narrowed`: **per-resource** (no member controls on that parent; every existing descendant gets its own explicit controls; new files added later inherit nothing) / **abort** |
| ACP member controls + own controls | child ACL = union of own and inherited | same | — |
| Unreadable ACL/ACR | — | — | `acl-unreadable`: **owner-only** / **skip the resource** / **abort** |
| Unknown access-control system on either side | — | — | `acl-system-unknown`: **owner-only for everything** / **abort** |
| Target path already exists | — | — | `target-exists`: **skip** / **overwrite content, keep target permissions** / **abort** |
| Target WebID profile document, target root ACL/ACR | never overwritten | never overwritten | `protected-target`: **skip** / **merge grants** (root only: add the translated root grants to the existing root ACL, keeping its owner Control) / **abort** |
| Source `.meta` / description resources | not copied | not copied | info item |

Each report item records the source URL, the source rule text (the triples involved, as Turtle),
what each option would write, and a short plain-English explanation. Every "nearest safe" option
is checked mechanically: `assertNotWider(sourceEffective, plannedTargetEffective)` runs over
every resource before execute, and execute refuses to start if it fails.

## 6. Writing ACLs and ACRs

Serialise with `n3.Writer` only, never by string concatenation. WAC: one `acl:Authorization`
per (subject set, modes, scope). ACP: one policy + matcher per grant clause, attached with
`acp:accessControl` and, where planned, `acp:memberAccessControl`. ACR writes go to the ACR URL
from the resource's `Link rel="acl"`; ESS and CSS both accept PUT of Turtle there. Never write an
ACL/ACR that lacks the owner's Control.

## 7. Testing

- Unit (Vitest, pure): WAC and ACP readers, effective-policy computation, every translation row
  above, `assertNotWider` (property tests over random policies: translated output is never wider),
  plan ordering (lock top down, grant bottom up), `PodHttp` fences (path scope on a shared origin,
  redirects, header stripping, `Request` objects refused, `@` / backslash / percent-encoding
  tricks).
- Integration (`pnpm test:css`, not in the default gate): two local Community Solid Server
  instances, one WAC (`@css:config/file.json`-style) and one ACP
  (`ldp/authorization/acp.json`), seeded with resources and permissions, then migrate WAC→ACP and
  ACP→WAC with client-credential DPoP tokens, and assert data and effective permissions through
  anonymous and second-account requests.
- UI: Playwright screenshots at 375 / 768 / 1280 px, light and dark.

PodSpaces itself can only be tested with a real account; ESS specifics (ACR URL form, any extra
policies it requires) are isolated in `src/engine/systems/acp.ts` so they can be adjusted after
a live run.
