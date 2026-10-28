<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

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
`redirectFlowKey`, `redirectSentinelKey` and `redirectUri` (`<base>callback/source`,
`<base>callback/target`, with `APP_BASE_PATH` defaulting to `/`), and `patchGlobalFetch: false`, so neither touches the global fetch and the
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
   Also inventory the existing target tree and the target's own root ACL and
   WebID profile document, including paths outside the migration. ACL/ACR URLs shared by
   resources, or documents binding another resource, are unsafe: offer skip/abort. An unreadable
   target inventory stops planning because exclusivity cannot be established.
4. **Review** (UI). Show the plan: resource counts, bytes, and every report item with its
   options. Nothing has been written yet. The user resolves each item or aborts. Resolutions can
   be applied in bulk per item kind.
5. **Execute** (writes, target only). Three phases, in order:
   - *Lock.* Create each target container top down. Immediately after creating one, write an
     owner-only ACL/ACR on it (owner gets Read, Write, Control on the container and its members;
     nothing else). Before writing any resource directly into a target container that already
     existed before the migration, first create it empty, lock it owner-only, then write its
     content.
   - *Copy.* Create each new resource's empty placeholder with its content type and
     `If-None-Match: *`, lock it, then PUT its bytes with the placeholder's ETag in `If-Match` (never
     overwrite unless the user chose "overwrite" for that path). RDF documents may optionally have
     source-pod IRIs rewritten to target-pod IRIs (parse with `@jeswr/fetch-rdf`, rewrite terms,
     serialise with `n3.Writer`); off by default the bytes are copied verbatim.
   - *Grant.* Write the final ACLs/ACRs **bottom up** (deepest first, containers after their
     members). Every intermediate state is a subset of the final state, which is a subset of the
     source.
6. **Verify.** Re-read each written ACL/ACR, re-parse it, and compare it with the planned rules.
   Read back each copied resource with its copied media type in `Accept`; compare its bytes and
   media type. Produce a final report (downloadable JSON).

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
matcher ORs the values within each of `acp:agent`, `acp:client`, `acp:issuer`, and `acp:vc`,
and ANDs the different attributes that are present (as CSS's reference evaluator does).
`acp:agent` may be `acp:PublicAgent`, `acp:AuthenticatedAgent`, `acp:CreatorAgent`,
`acp:OwnerAgent`. A mode is granted when an applicable policy allows it and no applicable
policy denies it. Control is access to the ACR itself (`acp:access` / control mode as the
server implements it; verify against both the spec copy and CSS's ACP implementation).
Translate `allOf`/`anyOf`/`noneOf` into the `who`/`except` normal form; a policy whose
expansion exceeds 64 clauses is a report item (`too-complex`) rather than silently truncated.

CSS evaluates every `acp:resource` statement in each ancestor ACR. For each statement it
selects `accessControl` when that IRI equals the requested target and `memberAccessControl`
otherwise. Filtering the document down to the current resource's node is unsafe. The source
reader retains foreign-node denials conservatively for both resource and member scope, even
where placement is uncertain. Foreign grants that cannot be placed faithfully, detached
constructs, unknown ACP predicates, and ambiguous resource bindings make the document unknown
(owner-only/skip/abort). ACR-self policies map to Control only for an independently established
ESS source. CSS derives ACR access from Control on the protected resource through
`AuthAuxiliaryReader`; ineffective ACR-self or `acp:access` grants must never become destination
Control. `acp:PublicClient` matches
any client context. Target documents must have exclusive resource/ACR-self scopes on read and
verification: conservative denials cannot mask a broader server-effective grant. Typed ESS
ACR roots without `acp:resource` are supported only for an established ESS source and without
competing resource bindings. ESS mode IRIs must likewise never identify the server dialect:
CSS ignores `acp:Read`/`Write`/`Append` modes. Uncertain denials remain restrictive.

## 4. Detecting the system

Follow `Link: <…>; rel="acl"` from the root. If that resource is advertised as
`acp:AccessControlResource` (Link `type`) or parses to triples using the ACP namespace, the side
is ACP; if it uses `acl:Authorization`, WAC. If the root has no ACL link, or the two signals
conflict, the side is `unknown` and the plan refuses to translate permissions. An unknown
source may be copied owner-only into an established target system; an unknown target must abort.

Access-control language and server implementation are separate discoveries. On each storage
selection, the browser establishes `PodSide.implementation` from non-RDF evidence: an HTTPS
storage hostname under `*.inrupt.com` (default port) establishes ESS. An OIDC issuer, including
the live session's `https://login.inrupt.com/`, identifies the login provider and cannot
establish where the pod is hosted or its implementation. Otherwise a
successful root HEAD response's exposed `X-Powered-By: Community Solid Server` (optionally
with `/version`) establishes CSS, and `solid-server/version` establishes NSS. If HEAD supplies
no usable header (or is unsupported), try a root GET. Redirects, failures, unavailable CORS
headers, RDF claims and page/user input cannot establish the implementation. Otherwise it
remains unknown. Each connection card shows the result; unknown ACP targets explain why they
are blocked and how to reconnect after the provider exposes its header or choose another pod.
Detection is repeated for each session/storage selection, with stale results discarded.

## 5. Translation rules

**Read SOURCE conservatively, write only established TARGET semantics, and prove the documents
that will actually exist.** Whenever server implementations disagree (ESS/CSS/NSS dialects,
legacy predicates, ACR-self policies, `acp:access`, `acp:Read`-style modes, typed ACRs without
`acp:resource`), an uncertain grant counts as not granted and produces a report item offering
skip/abort. An uncertain denial or exclusion counts as applying. A document whose grants cannot
be interpreted safely is reported as `acl-unreadable`, with owner-only/skip/abort; its descendants
also fail closed. `acl:defaultForNew` requires an independently established NSS source. Without
that evidence it cannot be promoted to an inherited grant, because CSS 7.2 reads only `acl:default`.

`PodSide.implementation` is an optional, trusted caller assertion (`css`, `ess`, `nss`), established
independently of editable access RDF. An unknown source uses conservative readings; ACP target
writes require established CSS or ESS semantics and otherwise offer only abort. Never infer ESS
from an `acp:*` mode IRI. Source ESS variants are isolated in `systems/acp.ts`; live PodSpaces
validation still requires a real account. Existing target restrictions that cannot be proven
effective are refused, so an ignored denial cannot mask a broader target grant.

Never rely on a condition the target might not enforce. In particular CSS 7.2's configured WAC
checker chain ignores `acl:origin`: origin-restricted grants are unsupported on **every WAC and
ACP target**, with skip/abort. Preserving the condition's RDF text is not a safe translation.
CSS ACP output uses resource `acl:Control`; it does not emit ineffective ACR-self or `acp:access`
controls. Only established CSS 7.2 enforcement or the explicitly selected ESS behavior documented
in `systems/acp.ts` may be written.

The target proof replays empty creation, owner-only locking, content copying and bottom-up
granting in executor order. It recomputes effective permissions from the access documents left
after **each** mutation, for every affected resource. Replacing a document removes its old grants,
denials and exclusions from all descendant proofs. Repeat this proof against freshly read target
documents before the first write; semantically equal initial permissions can conceal changed
ancestor policies behind a denial that will be replaced. Existing paths kept by skip/overwrite and
root merges retain their actual documents. No proof may rely on an orphan ACR denial after locking
has replaced that ACR. Every partial execution state must remain safe.

CSS applies Write→Append implication after ACP denial subtraction. To keep this representable,
translated denials of either mode deny both; existing target denials of just one mode are refused.
CSS supplies no owner/creator/VC matcher context: uncertain exclusions cannot weaken a source
denial and cannot be relied on as target restrictions.

Translation works on effective policies, never on raw documents. The target owner (the WebID
signed in on the target) always gets `read`, `write`, `control` on everything written, so the
migration can never lock the user out; this is not a widening because the owner already
controls the target pod.

| Source construct | To WAC | To ACP | If not faithful |
|---|---|---|---|
| agent, public, authenticated | same | same | — |
| WAC `agentGroup` | same | no equivalent | `group-unsupported`: **skip** (drop the grant) / **expand** to the group's current members, read at plan time, shown as a list, with a warning that later membership changes won't follow / **abort** |
| WAC `acl:origin` | enforcement unestablished (CSS ignores it) | no equivalent (`acp:client` is a client id, not an origin) | `origin-unsupported`: **skip** / **abort**. Drop the affected grant clause; never retain or remove only the condition |
| ACP `client`, `issuer`, `vc` in a clause | no equivalent | same | `condition-unsupported`: **skip the clause** / **abort**. Never drop just the condition |
| ACP `noneOf` exclusions | no equivalent | same | `exclusion-unsupported`: **skip the grant** / **abort** |
| ACP `deny` | subtract it when the denial's subjects exactly cover a grant's clause; otherwise | same | `deny-unsupported`: **drop every grant the denial overlaps** (narrowest) / **abort** |
| ACP `creator` / `owner` | target owner WebID | same | info item `owner-mapped` |
| Grant to the source owner's WebID | kept verbatim (it is the same person, and they may still use that WebID) | same | info item |
| WAC child ACL narrower than an inherited default | write the child ACL | ACP inheritance is additive, so the parent's member rules would reach the child | `inheritance-narrowed`: **per-resource** (no member controls on that parent; every existing descendant gets its own explicit controls; new files added later inherit nothing) / **abort** |
| ACP member controls + own controls | child ACL = union of own and inherited | same | — |
| Unreadable source ACL/ACR | — | — | `acl-unreadable`: **owner-only** / **skip the resource** / **abort** |
| Unreadable, ambiguous or shared target ACL/ACR | — | — | `acl-unreadable`: **skip the resource** / **abort**. Owner-only cannot remove unproven existing restrictions or additive ancestor grants |
| Unknown source access-control system | — | — | `acl-system-unknown`: **owner-only for everything** / **abort** |
| Unknown target access-control system or unestablished ACP implementation | — | — | `acl-system-unknown`: **abort** |
| Target path already exists | — | — | `target-exists`: **skip** / **overwrite content, keep target permissions** / **abort** |
| Target WebID profile document, target root ACL/ACR | never overwritten | never overwritten | `protected-target`: **skip** / **merge grants** (root only, when the existing controls are readable, exclusive and proven safe: add translated root grants while keeping owner Control) / **abort** |
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
ACL/ACR that lacks the owner's Control. Never write an access URL advertised for another
resource, including a skipped root, profile or existing sibling. Recheck the advertisement
and the current document's resource bindings immediately before each access PUT; apply the
same guard when an empty placeholder first reveals its ACL URL. A safe refusal may leave an
empty placeholder with its already-proven safe inherited permissions, but never copies content
through an unsafe access URL. Verification checks target document scopes and the owner's root
permissions, including Control, before claiming success. A root read/parse failure preserves
its actual cause; only a readable policy without the required owner permissions produces the
owner-Control-loss diagnostic. Unsupported mixed-dialect documents still fail closed.

CSS 7.2's `PutOperationHandler` returns 201/205 without an ETag for content and access
documents. An empty placeholder's ETag may be recovered by HEAD only when its content length
is zero. Before replacing an already written access document, recover a missing response ETag
from the fresh negotiated read only if both its resource and member policies still equal the
previously written policy. Missing validators, changed policies, and deleted access documents
stop execution; never retry a failed condition unconditionally. A pre-existing specific access
document, including a server-created default, is replaced using its read ETag. Access reads
parse the returned media type and normalize to Turtle for later scope checks and merges.

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

## 8. Static hosting

`APP_ORIGIN` is an origin without a path; deployable builds (`APP_ORIGIN` set or CI) require
HTTPS. `APP_BASE_PATH` defaults to `/` and is an absolute path ending in `/`. Vite assets,
icons, the Client Identifier Document, both registered redirect URIs and callback detection
share this base. `build:pages` builds for `https://jeswr.github.io/solid-sdk/pod-migrator/`.
The client document's URL equals its `client_id`. Emit `404.html` and static callback entry
pages as copies of the built index, keeping absolute base-prefixed assets. Callback directory
trailing slashes are accepted without changing the redirect URI persisted for token exchange.
