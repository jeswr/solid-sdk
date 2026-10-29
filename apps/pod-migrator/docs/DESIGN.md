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

### Threat model and completeness

The migrator trusts the SOURCE server's representation of its own data: that server also
defines and enforces the source policy. A malicious source server can lie about its ACRs
with or without truncation. Completeness against an adversarial server cannot be proven and
is out of scope, including consistently omitting a denial from both serializations. In scope
are honest-but-buggy servers (including CSS 7.2's character-counted Content-Length bug and
similar framing bugs) and broken transports. Independent evidence below means a different
server conversion path consuming the stored stream, under this trust assumption; graph
agreement alone is not a cryptographic snapshot or proof against a lying server.

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
5. **Execute** (writes, target only). Four phases, in order:
   - *Validate.* Before any destination mutation, recheck source and target access, then
     fetch, validate and retain every selected file body (including any requested IRI rewrite).
     A failure in a nested file therefore leaves no containers, placeholders or ACLs from this
     attempt. The retained bodies consume memory proportional to the selected content; this
     implementation buffers the complete migration rather than re-fetching bodies after validation.
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
     All network RDF reads use one validated reader: file bodies, containers, anonymous groups,
     access-system discovery, ACLs/ACRs, execution rechecks and verification. It consumes bytes,
     checks for bodies shorter than visible Content-Length when no non-identity encoding is
     exposed, and decodes RDF with fatal UTF-8. Fetch decodes compression, and browser CORS can
     hide Content-Encoding while exposing Content-Length. A longer decoded body is therefore
     accepted; its size is not proof of truncation. Exposed compressed lengths are not compared.
     Stream, length, decoding and integrity failures carry the resource URL. Planning failures
     become blocking report items; execution failures appear against the affected destination
     resource in `MigrationResult.failed`, with the source/document URL in the explanation.

     CSS 7.2's memory backend can count string characters after PATCH, so a response can end
     exactly between triples, parse successfully, and match an incorrect Content-Length. HEAD
     repeats that length. For non-JSON RDF with non-ASCII bytes matching a visible length and
     no exposed non-identity encoding, request **one** different serialization: N-Quads, or TriG
     when the original is N-Quads. **ACLs and ACRs require this check even when the first response
     has no Content-Length or exposes compression**: no supported server has independent evidence
     that its original representation always counts bytes. Merely lacking Content-Length is not
     completeness evidence for an access document from CSS or another unestablished server.
     Require the requested returned media type, no Content-Length, strict parsing, and dataset
     isomorphism (including blank nodes and named graphs) with the original bytes. The different
     media type must exercise conversion; an echoed original serialization does not qualify.
     Installed/live CSS 7.2 confirms conversion consumes the full stored stream and omits the
     stored length. This CSS conversion behaviour supplies independent evidence within the
     stated threat model. Matching lengths, ETags or a second length-framed response do not.
     A mismatch or unavailable conversion fails closed. ASCII RDF, opaque resources and
     length-free non-access representations need no second GET.

     **Verbatim copying warns when completeness depends on graph isomorphism.** A dataset
     deduplicates triples, so even an agreeing complete alternate graph cannot establish that
     the original bytes include a trailing duplicate triple, comment or whitespace. Those
     carry no RDF meaning, and refusing would block every non-ASCII Turtle file on servers
     that stream conversions, so the data file is copied from the received bytes with a
     `warn` log entry naming it. Access documents are never copied as bytes; they are
     translated from the proven graph. Explicit IRI rewriting
     parses and reserializes RDF anyway; duplicate lexical triples are not preserved in
     that mode. Byte verification compares against the complete retained body actually written,
     so it can use semantic validation followed by exact byte equality with that body.

     JSON-LD copies validate the complete JSON syntax and UTF-8 without expanding any context.
     JSON's closing delimiters establish the document boundary, so a character-count cut cannot
     discard graph data while leaving a valid complete JSON document. Access reads and IRI
     rewriting additionally parse RDF with remote contexts refused. The migrator never fetches
     remote JSON-LD contexts, even for an otherwise intact document.

     An access document whose byte integrity or completeness cannot be established offers
     **skip / abort**, including for descendants. It cannot be downgraded to an owner-only copy.
     Other unsupported but intact source policy shapes retain the conservative owner-only option.

     Residual limits: these checks operate within the source-server trust assumption above.
     Successful conversion streams are assumed to serialize the stored graph completely;
     a server consistently lying in both responses is out of scope. An arbitrary wrong byte
     length on all-ASCII RDF or opaque bytes cannot be proven complete without a trusted digest
     or server-side snapshot. Separate reads are not an atomic snapshot: a concurrent graph
     change can cause safe refusal. JSON syntax validation is integrity evidence, not JSON-LD
     context expansion or semantic validation. The extra completeness check is bounded to one
     alternate RDF GET and one graph comparison per affected read; other media types incur no
     extra request. Isomorphism uses a bijection of at most 64 blank nodes and a 100,000-step
     search budget; larger or harder proofs, and non-identical quoted-triple graphs, fail closed.
     There is no new remote-context, HEAD-length or unbounded negotiation loop.
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
controls. CSS source and all target proofs use that algorithm. ESS sources use the stricter
intersection of additive and default-only readings described in section 5. Each access control
applies policies; a policy has `acp:allow` / `acp:deny` modes and
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
Control. CSS's `acp:PublicClient` matches any client context. ESS source grants with
any client condition, including `PublicClient`, require an authenticated agent under the
narrower plausible login requirement;
ESS source denials and grant exclusions retain the broader plausible wildcard reading.
Target documents must have exclusive resource/ACR-self scopes on read and
verification: conservative denials cannot mask a broader server-effective grant. Typed ESS
ACR roots without `acp:resource` are supported only for an established ESS source and without
competing resource bindings. ESS mode IRIs must likewise never identify the server dialect:
CSS ignores `acp:Read`/`Write`/`Append` modes. Uncertain source denials remain restrictive;
existing target denials count only when their scope and enforcement are established.

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

For an **ESS source**, establish mode activation before normalizing vocabularies: only known
`acp:*` modes in grants are active. `acl:*` and other unestablished grant modes are omitted and
reported as `condition-unsupported` with skip/abort. Source denials retain the broader reading
of both mode vocabularies. Unestablished issuer/VC conditions in a denial's `noneOf` matcher
remove that entire exemption, including any established conjuncts; the denial then applies
more broadly, independently of the target's ability to enforce that condition. Report this
as `condition-unsupported` with skip/abort. Unknown graph constructs still fail closed.

ESS member-policy documentation conflicts: the
[ACP effective-policy algorithm](https://solidproject.org/TR/acp#effective-policies) is additive,
while [Inrupt's ACR guide](https://docs.inrupt.com/guides/access-control-policies#access-control-resource-acr)
describes ancestor policies as defaults when a child lacks explicit policies. Take the
strictest reading of both for ESS sources: ancestor member **grants** contribute only when
the resource's own ACR has no explicit resource or ACR-access grants; ancestor member
**denials always contribute**. This covers `memberAccessControl` and `memberAccess` alike.
An absent, empty or denial-only own ACR does not suppress ancestor grants. CSS sources retain
the additive algorithm validated against installed/live CSS. Existing targets always use
the widest, additive reading, including ESS targets. When writing ACP, materialize ESS source
permissions per existing resource and omit shared member grants, with `inheritance-narrowed`
per-resource/abort, so target additivity cannot undo the stricter source reading. Future
children receive owner access only.

**Read existing TARGET access documents with the WIDEST plausible reading.** This applies to
the resource's ACL/ACR and every ancestor document that can apply, during planning, the fresh
pre-write phase proof and verification. A grant with a condition or shape we cannot fully
evaluate counts as granting to everyone, or the path is refused with `acl-unreadable` and
skip/abort. It is never silently narrowed or dropped. This implementation refuses unsupported
target shapes. A denial counts only when that implementation
provably enforces it in that scope; unknown denials are not trusted. ESS resource-level
`deny acp:Control` cannot restrict ACR permissions inherited through `memberAccess` and is
ignored in the target proof. Partial ACR Read/Write permissions are refused rather than
conflated with full Control. Existing CreatorAgent and owner-like role matchers require
trusted server creator/owner metadata; otherwise their grants may identify a stranger.
The engine currently has no trusted creator metadata channel and refuses such target
documents. The symbolic prover never equates an unknown creator with the target owner.
The fake pod and independent oracle use server semantics and retained creation metadata,
including collaborator-created resources; they must not repeat source-reader restrictions.

**Closed allowlist for targets without live validation (ESS and any non-CSS ACP).** Before
modelling an existing document, require the complete graph to fit these shapes. Apply this
check to the destination resource and every ancestor whose member controls can apply, during
planning, the fresh pre-write proof and verification. CSS retains its live-validated model.

- One ACR root, exclusively bound by `acp:resource` to this resource, with resource and/or
  member controls. The existing ESS typed-root fixture also permits exactly one typed
  `acp:AccessControlResource` root without `acp:resource`; competing roots are refused.
- `acp:accessControl` / `acp:memberAccessControl` link to controls containing exactly one
  `acp:apply` policy. A policy has only `acp:allOf` matchers, optional `acp:noneOf` matchers,
  and either allow or deny modes from **acp:Read, acp:Write, acp:Append, acp:Control**. At least
  one positive matcher is required. The writer's inert resource policy for a Control-only
  rule may have no modes. Write/Append denials must still satisfy the existing paired-mode rule.
- Each matcher contains exactly one `acp:agent`: an explicit WebID, `acp:PublicAgent`, or
  `acp:AuthenticatedAgent`. Multiple emitted matchers may form a conjunction or exclusions.
- `acp:access` / `acp:memberAccess` link directly to policies with the same matcher shape and
  **exactly acp:Read + acp:Write** in one polarity, matching emitted ACR Control policies.
- Correct role types (`AccessControlResource`, `AccessControl`, `Policy`, `Matcher`) are optional
  except on the unbound typed root. No other types, predicates, detached nodes, named graphs,
  competing node roles, or extra triples are permitted, including on policies and matchers.

This admits the migrator's owner locks and simple grant/denial output. It refuses ACR Append,
partial ACR permissions, all `acl:` mode IRIs in ACRs, `PublicClient`, client/issuer/VC and
owner/creator role matchers, `anyOf`, and unknown constructs in full, without partial modelling.
An unallowlisted document makes the entire destination path an `acl-unreadable` report item
with **skip / abort**; the plan writes nothing beneath it. ESS output omits client/issuer/VC
grant clauses and exclusions and broadens affected denials, with report items, so generated
documents obey the same grammar. The fake independently checks this grammar for target writes
and in the dialect matrix; its hostile-source evaluator remains separate. The typed-root
fixture is an offline contract, not a captured fresh PodSpaces ACR or live ESS validation.

`PodSide.implementation` is an optional, trusted caller assertion (`css`, `ess`, `nss`), established
independently of editable access RDF. An unknown source uses conservative readings; ACP target
writes require established CSS or ESS semantics and otherwise offer only abort. Never infer ESS
from an `acp:*` mode IRI. Source ESS variants are isolated in `systems/acp.ts`; live PodSpaces
validation still requires a real account. Existing target restrictions that cannot be proven
effective are refused, so an ignored denial cannot mask a broader target grant.

Never rely on a condition the target might not enforce. In particular CSS 7.2's configured WAC
checker chain ignores `acl:origin`: origin-restricted grants are unsupported on **every WAC and
ACP target**, with skip/abort. Preserving the condition's RDF text is not a safe translation.
ESS issuer matching has no established enforcement evidence, and the generic `acp:vc` type
equality used by the fake is not evidence of ESS's documented credential-grant processing.
Client-, issuer- or VC-conditioned grants to ESS are omitted with `condition-unsupported` and
skip/abort; grants with those exclusions are omitted with `exclusion-unsupported`. Denials
are applied without those conditions or exclusions, with a `deny-unsupported` report item;
an otherwise empty positive clause becomes public. Other established conjuncts remain.
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
| ACP `client`, `issuer`, `vc` in a clause | no equivalent | CSS client/issuer retained; ESS client/issuer/VC and CSS VC unsupported | `condition-unsupported`: **skip the clause** / **abort**. Never drop just the condition |
| ACP `noneOf` exclusions | no equivalent | same | `exclusion-unsupported`: **skip the grant** / **abort** |
| ACP `deny` | subtract it when the denial's subjects exactly cover a grant's clause; otherwise | same | `deny-unsupported`: **drop every grant the denial overlaps** (narrowest) / **abort** |
| ACP `creator` / `owner` | target owner WebID | same | info item `owner-mapped` |
| Grant to the source owner's WebID | kept verbatim (it is the same person, and they may still use that WebID) | same | info item |
| WAC child ACL narrower than an inherited default | write the child ACL | ACP inheritance is additive, so the parent's member rules would reach the child | `inheritance-narrowed`: **per-resource** (no member controls on that parent; every existing descendant gets its own explicit controls; new files added later inherit nothing) / **abort** |
| ACP member controls + own controls | CSS source: union; ESS source: own grants suppress inherited grants, inherited denials remain | CSS source: union; ESS source: materialize strict effective controls per resource | ESS→ACP: `inheritance-narrowed`: **per-resource** / **abort** |
| Source ACL/ACR with unproven integrity/completeness | — | — | `acl-unreadable`: **skip the resource and subtree** / **abort** |
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
ESS subset in which each required matcher includes an agent attribute and no unestablished
issuer/VC condition. Source denials use the broadest plausible positive matching and narrowest plausible exclusions, so a missing
agent cannot weaken a denial. Unestablished ESS issuer/VC conditions are unrestricted for
positive source denials and grant exclusions; denial exemptions using them are removed entirely. ESS source `PublicClient` grants require login; an
otherwise public clause becomes authenticated. ESS target translation omits client/issuer/VC
grant clauses and broadens affected denials. It preserves allowed agent conjunctions as
separate matchers. Existing ESS documents must pass the closed allowlist above first.

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
validation is claimed. A fake demonstrates test behavior, not implementation enforcement.
In particular ESS issuer/VC and NSS origin enforcement are uncertain and never trusted on
a target. The ESS source reader may narrow variants outside its established matcher subset;
the target reader must refuse those variants rather than reuse that narrowing.

Every row label is a case in [`dialect-matrix.test.ts`](../test/engine/dialect-matrix.test.ts).
Each runs all 16 source × target pairs. CSS checks use the installed server readers/evaluator;
ESS/NSS use independent fake evaluation. The oracle never uses the engine's reader or prover.
Matching, nonmatching and anonymous contexts vary WebID, client, issuer, VC and origin. Checks
after every target PUT cover placeholders, locks, content, parent grants, existing descendants
and a future child. Basic faithful grants must survive as well as satisfy the subset property.
Absent source-language constructs are tested as inert; refused documents must leave their
skipped subtree unwritten. Every row also runs against all four target dialects with existing
resource controls and with retained ancestor member controls, on resources created by a
collaborator. These cases overwrite private source content while retaining target permissions,
or prove refusal/skip before any PUT. A loader guard reproduces strict pnpm transitive-dependency
ownership even on flatter installations. Focused tests cover unknown sources, reporting,
nested ESS folders, ineffective Control denials, and unsupported target shapes.

| Construct / test row | CSS 7.2 WAC | CSS 7.2 ACP | ESS | NSS | Existing target resource + ancestor (collaborator-created) |
|---|---|---|---|---|---|
| `agent` | S/T WebID equality; M retain | S/T WebID equality; M retain | S/T agent matcher; M retain | S/T WebID equality; M retain | Read exact WebID in both scopes; refuse private overwrite if a stranger matches |
| `public` | S/T `foaf:Agent`; M retain | S/T `PublicAgent`; M retain | S/T `PublicAgent`; M retain | S/T `foaf:Agent`; M retain | Count anonymous access in both scopes; refuse private overwrite |
| `authenticated` | S/T authenticated WebID; M retain | S/T `AuthenticatedAgent`; M retain | S/T `AuthenticatedAgent`; M retain | S/T authenticated WebID; M retain | Count any authenticated stranger in both scopes; refuse private overwrite |
| `group-public` | S/T public vCard membership; M retain IRI or expand snapshot | S/T absent; M accept proven expanded agents | S/T absent; M accept proven expanded agents | S public evidence; T vCard membership; M retain IRI or expand snapshot | Treat unproven target membership as a possible stranger; refuse unsafe overwrite |
| `group-private` | S no membership; T no private match; M no expansion | S/T absent; M drop | S/T absent; M drop | S private resolution uncertain; T not relied on; M no expansion | Never infer no target access from missing membership evidence; refuse uncertain overwrite |
| `owner` | S/T absent; M owner-only substitution | S no context; T not enforced; M drop inactive clause | S possible owner role; T existing role refused without trusted metadata; M emit explicit target owner | S/T absent; M owner-only substitution | Refuse role matchers without trusted metadata; no owner exemption for an unknown role |
| `creator` | S/T absent; M owner-only substitution | S no context; T not enforced; M drop inactive clause | S documented creator role; T existing role refused without trusted metadata; M map source grant only to target owner; omit creator exclusions and narrow denials | S/T absent; M owner-only substitution | Collaborator remains creator after overwrite; refuse without trusted metadata |
| `client-only` | S/T absent; M drop clause | S/T can match without agent; M retain to CSS ACP | S inactive without identity/VC requirement; T outside allowlist; M drop clause | S/T absent; M drop clause | CSS reads actual condition; ESS refuses all client matchers |
| `client-agent` | S/T absent; M drop clause | S/T AND attributes, OR values; M retain | S agent AND client; T outside allowlist; M omit target clause | S/T absent; M drop clause | ESS refuses client matchers; CSS retains and proves conjunctions |
| `client-separate` | S/T absent; M drop clause | S/T policy-level conjunction; M retain | S documented agent and separate client requirement; T existing shape refused; M source subset omits with report | S/T absent; M drop clause | ESS refuses separate no-agent client matcher; CSS evaluates conjunction |
| `issuer` | S/T absent; M drop clause | S/T exact issuer equality; M retain | S enforcement unestablished; T enforcement unestablished; M omit source/target grant, broaden denial without issuer | S/T absent; M drop clause | ESS refuses uncertain condition; CSS evaluates exact issuer in both scopes |
| `vc` | S/T absent; M drop clause | S no VC context; T unenforced; M drop inactive/unsupported clause | S generic `acp:vc` equality unestablished; T likewise; M omit source/target grant, broaden denial | S/T absent; M drop clause | Refuse unestablished target VC conditions in either scope |
| `vc-only` | S/T absent; M drop clause | S no VC context; T not used; M drop | S documented VC policies may grant; T generic condition unestablished; M source subset omits, target refuses | S/T absent; M drop clause | ESS oracle permits matching VC context; target reader refuses instead of dropping grant |
| `origin` | S ignored; T unenforced; M omit clause | S/T absent; M omit clause | S/T absent; M omit clause | S may restrict; T unestablished; M omit clause | Ignore uncertain target origin restriction and count the full grant |
| `allOf` | S/T no arbitrary conjunction; M narrow or omit | S/T every matcher must match; M retain | S documented policy-level agent/client conjunction; T supported subset only; M source narrows, target refuses unmodelled forms | S/T no arbitrary conjunction; M narrow or omit | Keep every established conjunct; refuse unmodelled target matcher forms |
| `anyOf` | S/T union of principals; M retain representable clauses | S/T at least one matcher; M retain disjunction | S documented alternatives; T outside allowlist; M split supported source alternatives into emitted policies | S/T union of principals; M retain representable clauses | ESS refuses existing anyOf; CSS keeps every possible alternative |
| `deny` | S/T absent; M subtract exact or drop overlaps | S/T deny overrides allow; M retain | S/T deny overrides allow; M retain conservatively | S/T absent; M subtract or drop overlaps | Count only established, applicable denials; no uncertain denial may hide a grant |
| `noneOf` | S/T absent; M omit excluded grant | S/T no excluded matcher may match; M retain | S/T exclusions; M retain conservative exclusion | S/T absent; M omit excluded grant | Keep only established exclusions; refuse ambiguous target exclusions |
| `deny-vc` | S/T absent; M narrow overlaps | S inactive; T unenforced; M drop inactive denial or affected ESS grants | S possibly credential-conditioned; T generic VC condition unestablished; M broaden denial without VC condition | S/T absent; M narrow overlaps | Refuse unestablished denial condition; never use it to mask a grant |
| `noneOf-vc` | S/T absent; M omit grant | S exclusion inactive; T unenforced; M remove inactive exclusion or omit ESS grant | S possibly restrictive; T unestablished; M omit excluded grant | S/T absent; M omit grant | Refuse unestablished exclusion; never use it to narrow a target grant |
| `deny-except-vc` | S/T absent; M drop overlaps | S exclusion inactive; T untrusted; M broaden denial | S exemption unestablished; T unestablished; M remove entire source exemption before translation | S/T absent; M drop overlaps | Refuse unestablished denial/exclusion combination |
| `noneOf-client-only` | S/T absent; M omit grant | S/T client-only exclusion; M retain | S uncertain exclusion variant; T outside allowlist; M conservatively retain source exclusion, omit target grant | S/T absent; M omit grant | ESS refuses client exclusions; CSS evaluates actual client condition |
| `deny-client-only` | S/T absent; M drop overlaps | S/T client-only denial; M retain | S inactive or uncertain variant; T outside allowlist; M retain possible source denial, broaden target denial | S/T absent; M drop overlaps | ESS refuses client denials; CSS evaluates actual client condition |
| `deny-issuer` | S/T absent; M narrow overlaps | S/T exact issuer-conditioned denial; M retain | S condition may restrict; T unestablished; M broaden denial without issuer | S/T absent; M narrow overlaps | ESS refuses unestablished issuer denial; CSS evaluates actual condition |
| `noneOf-issuer` | S/T absent; M omit grant | S/T exact issuer exclusion; M retain | S exclusion may restrict; T unestablished; M omit grant | S/T absent; M omit grant | ESS refuses unestablished issuer exclusion; CSS evaluates actual condition |
| `deny-except-issuer` | S/T absent; M narrow overlaps | S/T issuer exclusion on denial; M retain | S exemption unestablished; T unestablished; M remove entire source exemption before translation | S/T absent; M narrow overlaps | ESS refuses unestablished issuer exclusion on a denial |
| `resource-scope` | S/T `accessTo` only; M preserve | S/T own `accessControl`; M preserve | S/T own `accessControl`; M preserve | S/T `accessTo` only; M preserve | Evaluate retained resource and ancestor placements with actual scope rules |
| `member-scope` | S/T nearest `default`, child replaces; M materialize per resource to ACP | S/T additive descendant controls; M preserve union | S default-only grants when own ACR attaches no policy of its own (any grant, denial, noneOf-only or inactive policy counts), additive denials; T additive; M materialize to ACP | S/T nearest defaults; M materialize per resource to ACP | WAC nearest defaults replace; CSS sources and all ACP targets stay additive; ESS source grants use defaults only |
| `control` | S/T resource `acl:Control`; M preserve | S/T resource `acl:Control`, auxiliary derives access; M preserve | S/T documented ACR Read+Write via `access`/`memberAccess`; M preserve both scopes; refuse partial target ACR permissions | S/T resource `acl:Control`; M preserve | Read separate ACR scope; refuse partial Read/Write; inherited stranger Control blocks overwrite |
| `append` | S/T Append alone; M preserve | S/T Append alone; M preserve | S/T Append alone; M preserve | S/T Append alone; M preserve | Retain Append in both scopes; private overwrite cannot introduce appenders |
| `write` | S/T Write implies Append; M normalize | S/T implication after denials; M normalize | S/T Write implies Append; M normalize | S/T Write implies Append; M normalize | Include derived Append; count retained Write in both scopes |
| `deny-append` | S/T absent; M subtract conservatively | S before implication; T writer denies both modes; M broaden denial | S mode denied; T both modes denied; M broaden denial | S/T absent; M subtract conservatively | Refuse one-mode ACP target denial; cannot mask derived Append |
| `deny-write` | S/T absent; M subtract conservatively | S before implication; T writer denies both modes; M broaden denial | S mode denied; T both modes denied; M broaden denial | S/T absent; M subtract conservatively | Refuse one-mode ACP target denial; cannot mask Append-only access |
| `defaultForNew` | S ignored; T not emitted; M refuse | S/T absent; M no grant | S/T absent; M no grant | S legacy inheritance; T modern `default`; M normalize only established NSS | NSS reads legacy defaults; other dialects refuse unsupported target shape |
| `acp-modes` | S/T absent; M no grant | S ignored; T emits `acl:*`; M refuse mixed source | S grants only known `acp:*` modes, inactive `acl:*` reported before normalization; S denials read both; T ACP-only allowlist | S/T absent; M no grant | ESS allowlist refuses every `acl:` mode, including denials; CSS refuses ACP modes |
| `typed-acr` | S/T absent; M no grant | S ignores missing `resource`; T requires binding; M refuse | S typed root fallback; T explicit exclusive binding; M normalize | S/T absent; M no grant | ESS fallback only when exclusive; CSS refuses; separate owner binding keeps fixture readable |
| `acr-self` | S/T absent; M no grant | S no protected Control; T not emitted; M refuse grant | S ACR-self Read+Write gives Control; T outside allowlist; M normalize source into scoped access | S/T absent; M no grant | Both target readers refuse this existing form |
| `access` | S/T absent; M no grant | S ignored; T not emitted; M refuse grant | S/T resource ACR Read+Write gives Control; M preserve resource scope | S/T absent; M no grant | ESS reads ACR permissions separately; CSS refuses ineffective target form |
| `memberAccess` | S/T absent; M no grant | S ignored; T not emitted; M refuse grant | S/T descendant ACR Read+Write gives Control; M preserve member scope | S/T absent; M no grant | ESS source ancestor ACR grants use defaults only, denials always apply; target ACR permissions remain additive |
| `resource-control-mode` | S/T absent in ACP form; M no grant | S/T resource `acl:Control`; M normalize | S resource Control mode inactive; T resource grant/denial ignored, cannot restrict inherited ACR access; M do not emit | S/T absent in ACP form; M no grant | Ignore ESS resource Control denial; inherited memberAccess Control remains visible |

The additional `unvalidated-target allowlist matrix` accept/reject rows enumerate owner locks,
the typed-root fixture, agent/public/authenticated grants, all permitted modes, denials and
exclusions, and adversarial changes to every graph role. Independent fake and engine decisions
must agree. Round-8 regressions exercise ACR Append, mixed-vocabulary denials and PublicClient
denials on resources and ancestors, plus source wildcard translation to both target languages.
Round-9 regressions in `round9.test.ts` add the complete 432 atomic matcher × operator ×
grant/denial × scope × CSS-target combinations and 192 cases combining PublicAgent with a
conditional attribute in one matcher. Installed CSS readers/evaluator check every target write
against an independent strict ESS source interpretation. Focused cases cover inactive and mixed
source modes, unestablished denial exemptions, and both ancestor composition readings.

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
