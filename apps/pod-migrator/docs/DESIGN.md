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
| WAC `agentGroup` | same | no equivalent | `group-unsupported`: **skip** (drop the grant) / **expand** to the group's current members, read anonymously at plan time only when publicly readable, shown as a list, with a warning that later membership changes won't follow / **abort** |
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

### Implementation closure matrix

A source grant is usable only when its source implementation can satisfy its conditions.
CSS supplies no owner, creator or VC context: those positive grant clauses are dropped with
`condition-unsupported`, provenance RDF and skip/abort. Other active clauses survive. Established
CSS exclusions on absent attributes are ineffective and removed; unknown-source exclusions
remain restrictive. ESS client-only grants are inactive. The reader accepts the conservative
ESS subset in which each required matcher includes an agent attribute. Source denials use
the broadest plausible positive matching and narrowest plausible exclusions, so a missing
agent cannot weaken a denial. The ESS writer adds `PublicAgent` to client/issuer/VC matchers,
which activates the condition without broadening it. It preserves conjunctions as separate
matchers, including repeated attributes.

Group evidence uses `PodSide.publicHttp`, a separate fenced transport over auth-core's pristine
`publicFetch`. There is no owner-token fallback, including for unknown implementations. CSS's
`AgentGroupAccessChecker` dereferences vCard documents without user credentials; privately
readable membership proves no access. Missing public transport, foreign groups, failed public
reads and redirects offer only skip/abort. The executor repeats the anonymous membership read
before its first write and stops on changed membership or lost readability. WAC output can
retain the original group IRI.

Each cell below records **S** (source enforcement), **T** (target enforcement), and **M**
(migration behavior). “Absent” means no representation in that implementation's access language;
it contributes no grant. “Refuse” means report and skip/abort, with owner-only allowed only when
the complete phase proof permits it. Unknown implementations use conservative source readings;
ACP targets require independently established CSS/ESS semantics.

CSS evidence is the installed **7.2.0** `WebAclReader`, its configured checker chain,
`AcpReader.createContext`, `AcpUtil`, `@solid/access-control-policy` evaluator and
`AuthAuxiliaryReader`. ESS/NSS are explicit offline fixture contracts; no live PodSpaces or NSS
validation is claimed. In particular NSS origin enforcement is uncertain and never trusted on
a target. The ESS source reader may narrow variants outside its established matcher subset.

Every row label is a case in [`dialect-matrix.test.ts`](../test/engine/dialect-matrix.test.ts).
Each runs all 16 source × target pairs. CSS checks use the installed server readers/evaluator;
ESS/NSS use independent fake evaluation. The oracle never uses the engine's reader or prover.
Matching, nonmatching and anonymous contexts vary WebID, client, issuer, VC and origin. Checks
after every target PUT cover placeholders, locks, content, parent grants, existing descendants
and a future child. Basic faithful grants must survive as well as satisfy the subset property.
Absent source-language constructs are tested as inert; refused documents must leave their
skipped subtree unwritten. Focused tests cover unknown sources, reporting and nested ESS folders.

| Construct / test row | CSS 7.2 WAC | CSS 7.2 ACP | ESS | NSS |
|---|---|---|---|---|
| `agent` | S/T WebID equality; M retain | S/T WebID equality; M retain | S/T agent matcher; M retain | S/T WebID equality; M retain |
| `public` | S/T `foaf:Agent`; M retain | S/T `PublicAgent`; M retain | S/T `PublicAgent`; M retain | S/T `foaf:Agent`; M retain |
| `authenticated` | S/T authenticated WebID; M retain | S/T `AuthenticatedAgent`; M retain | S/T `AuthenticatedAgent`; M retain | S/T authenticated WebID; M retain |
| `group-public` | S/T public vCard membership; M retain IRI or expand snapshot | S/T absent; M accept proven expanded agents | S/T absent; M accept proven expanded agents | S public evidence; T vCard membership; M retain IRI or expand snapshot |
| `group-private` | S no membership; T no private match; M no expansion | S/T absent; M drop | S/T absent; M drop | S private resolution uncertain; T not relied on; M no expansion |
| `owner` | S/T absent; M owner-only substitution | S no context; T not enforced; M drop inactive clause | S/T owner context; M map grant only to target owner | S/T absent; M owner-only substitution |
| `creator` | S/T absent; M owner-only substitution | S no context; T not enforced; M drop inactive clause | S/T creator context; M map grant to target owner, omit creator exclusions and narrow denials | S/T absent; M owner-only substitution |
| `client-only` | S/T absent; M drop clause | S/T can match without agent; M retain to ACP | S inactive without agent; T writer supplies `PublicAgent`; M drop inactive source grant | S/T absent; M drop clause |
| `client-agent` | S/T absent; M drop clause | S/T AND attributes, OR values; M retain | S/T agent AND client; M retain all conditions | S/T absent; M drop clause |
| `issuer` | S/T absent; M drop clause | S/T exact issuer equality; M retain | S/T agent AND issuer; M retain all conditions | S/T absent; M drop clause |
| `vc` | S/T absent; M drop clause | S no VC context; T unenforced; M drop inactive/unsupported clause | S/T agent AND VC; M retain only to ESS | S/T absent; M drop clause |
| `origin` | S ignored; T unenforced; M omit clause | S/T absent; M omit clause | S/T absent; M omit clause | S may restrict; T unestablished; M omit clause |
| `allOf` | S/T no arbitrary conjunction; M narrow or omit | S/T every matcher must match; M retain | S/T every required matcher with agent; M retain supported subset | S/T no arbitrary conjunction; M narrow or omit |
| `anyOf` | S/T union of principals; M retain representable clauses | S/T at least one matcher; M retain disjunction | S/T at least one active matcher; M drop inactive alternatives | S/T union of principals; M retain representable clauses |
| `deny` | S/T absent; M subtract exact or drop overlaps | S/T deny overrides allow; M retain | S/T deny overrides allow; M retain conservatively | S/T absent; M subtract or drop overlaps |
| `noneOf` | S/T absent; M omit excluded grant | S/T no excluded matcher may match; M retain | S/T exclusions; M retain conservative exclusion | S/T absent; M omit excluded grant |
| `deny-vc` | S/T absent; M narrow overlaps | S inactive; T unenforced; M drop inactive denial or affected ESS grants | S/T VC-conditioned denial; M retain only with enforcement | S/T absent; M narrow overlaps |
| `noneOf-vc` | S/T absent; M omit grant | S exclusion inactive; T unenforced; M remove inactive exclusion or omit ESS grant | S/T VC exclusion; M retain | S/T absent; M omit grant |
| `deny-except-vc` | S/T absent; M drop overlaps | S exclusion inactive; T untrusted; M broaden denial | S/T VC exclusion; M retain to ESS, remove exclusion to CSS | S/T absent; M drop overlaps |
| `noneOf-client-only` | S/T absent; M omit grant | S/T client-only exclusion; M retain | S uncertain exclusion variant; T writer adds agent; M conservatively retain | S/T absent; M omit grant |
| `deny-client-only` | S/T absent; M drop overlaps | S/T client-only denial; M retain | S inactive in established subset; T writer adds agent; M conservatively retain possible denial | S/T absent; M drop overlaps |
| `resource-scope` | S/T `accessTo` only; M preserve | S/T own `accessControl`; M preserve | S/T own `accessControl`; M preserve | S/T `accessTo` only; M preserve |
| `member-scope` | S/T nearest `default`, child replaces; M materialize per resource to ACP | S/T additive descendant controls; M preserve union | S/T additive descendant controls; M preserve union | S/T nearest defaults; M materialize per resource to ACP |
| `control` | S/T resource `acl:Control`; M preserve | S/T resource `acl:Control`, auxiliary derives access; M preserve | S/T ACR Read+Write via `access`/`memberAccess`; M preserve both scopes | S/T resource `acl:Control`; M preserve |
| `append` | S/T Append alone; M preserve | S/T Append alone; M preserve | S/T Append alone; M preserve | S/T Append alone; M preserve |
| `write` | S/T Write implies Append; M normalize | S/T implication after denials; M normalize | S/T Write implies Append; M normalize | S/T Write implies Append; M normalize |
| `deny-append` | S/T absent; M subtract conservatively | S before implication; T writer denies both modes; M broaden denial | S mode denied; T both modes denied; M broaden denial | S/T absent; M subtract conservatively |
| `deny-write` | S/T absent; M subtract conservatively | S before implication; T writer denies both modes; M broaden denial | S mode denied; T both modes denied; M broaden denial | S/T absent; M subtract conservatively |
| `defaultForNew` | S ignored; T not emitted; M refuse | S/T absent; M no grant | S/T absent; M no grant | S legacy inheritance; T modern `default`; M normalize only established NSS |
| `acp-modes` | S/T absent; M no grant | S ignored; T emits `acl:*`; M refuse mixed source | S/T `acp:Read/Write/Append`; M normalize vocabulary | S/T absent; M no grant |
| `typed-acr` | S/T absent; M no grant | S ignores missing `resource`; T requires binding; M refuse | S typed root fallback; T explicit exclusive binding; M normalize | S/T absent; M no grant |
| `acr-self` | S/T absent; M no grant | S no protected Control; T not emitted; M refuse grant | S ACR-self Read+Write gives Control; T scoped access; M normalize | S/T absent; M no grant |
| `access` | S/T absent; M no grant | S ignored; T not emitted; M refuse grant | S/T resource ACR Read+Write gives Control; M preserve resource scope | S/T absent; M no grant |
| `memberAccess` | S/T absent; M no grant | S ignored; T not emitted; M refuse grant | S/T descendant ACR Read+Write gives Control; M preserve member scope | S/T absent; M no grant |
| `resource-control-mode` | S/T absent in ACP form; M no grant | S/T resource `acl:Control`; M normalize | S resource Control mode inactive; T not emitted; M drop with report | S/T absent in ACP form; M no grant |

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

ESS serializes resource Control through `acp:access` and descendant Control through
`acp:memberAccess`, using the same matcher conditions and Read+Write policy for each. Both
scopes round-trip independently, so owner-only folder locks also authorize nested creation.
Resource `acp:Control` is inactive and is never emitted.

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
