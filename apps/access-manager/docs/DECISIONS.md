<!-- AUTHORED-BY Claude Fable 5 -->

# Design decisions — solid-access-manager

Proceed-and-document record (the suite's "don't block on greenlights" rule).
The contract is `full-solid-ecosystem/docs/design/access-management-proposal.md`
@ `8a069f4`; decisions below are where implementation had to choose within (or
slightly beyond) that contract. Alternatives are noted with why they lost.

## D1 — Single vite package, not the pod-app core+web split

pod-health/pod-drive split a data-layer package (repo root) from a `web/` SPA.
This app is not a reusable data library — the deliverable IS the app — so it is
one vite package with `src/lib` (data layer, node-testable) and `src/ui`
(views, jsdom-testable), one lockfile, one gate. *Alternative*: the two-package
shape; rejected as pure overhead until the proposal's P1
`@jeswr/solid-access-model` extraction happens (Phase 2 follow-up: `src/lib`'s
resolver/acl modules are written import-clean so they can lift out).

## D2 — Login via `<jeswr-login-panel>` + `createReactiveAuthController`

The suite's keystone login surface (solid-elements `/auth` adapter over
reactive-authentication + solid-session-restore) rather than a hand-rolled
SessionProvider (the older pod-health pattern, ~4k lines with tests).
First consumer of the `/auth` subexport outside solid-elements itself.
*Alternative*: copy pod-health's webid-token-provider stack; rejected — it
duplicates security-critical auth code this app doesn't need to own.

## D3 — Where records live: `<storage>access-manager/{grants,receipts}/`

The proposal names no container for the standalone app's grant records /
consent receipts. Chosen: an app-scoped area under the storage root, written
create-only with deterministic names (`grant-<grantId>.ttl`,
`receipt-<grantId>.ttl`) so retries converge on the same IRIs.
*Alternatives*: a SAI `interop:DataRegistry` (heavier; nothing else in the
suite reads SAI registries yet — revisit when the SAI projection lands);
`/settings/` (semantically wrong — these are records, not preferences).

## D4 — Request state lives IN the request resource (accm:status + snapshot)

The §3.5 state machine is anchored on the inbox resource itself: `accm:status`
∈ Pending/Approving/Approved/Denied plus the CAS-persisted snapshot
(`accm:grantId`, `accm:resolvesTo`, `accm:agent`, `accm:mode`,
`accm:schemaVersion`). This is exactly the proposal's design (the server-side
§3.2 does the same); it keeps the CAS single-resource (one `If-Match` guards
one document). *Alternative*: a separate status ledger; rejected — two
resources cannot be CAS'd atomically without a server transaction.

## D5 — WAC only in Phase 1 (no ACP)

The dashboard/edit path reads and writes WAC `.acl` documents. ACP (`.acr`)
pods render a clear "unsupported ACL surface" degrade (`NoAclFoundError` →
flagged node) rather than guessing. `@solid/object` ships `wacToAcp` /
`acpToWac`, so ACP support is a bounded follow-up. *Alternative*: dual-stack
now; rejected for Phase-1 scope + test surface.

## D6 — Mode edits SPLIT shared authorizations

Changing one agent's modes when the authorization also names other agents (or
the public) must not change anyone else's access: the agent is removed from
the shared node and re-granted alone with the new modes (scope carried over).
In-place edits happen only when the agent is the node's sole subject.
Regression-tested (`test/lib/acl.test.ts`). *Alternative*: edit modes in
place always; rejected — silently widens/narrows other agents' access (a
privilege-escalation footgun).

## D7 — Inherited access is edited AT THE SOURCE

Revoking an agent whose access comes from an ancestor's `acl:default` edits
the ANCESTOR's document (where the authorization lives) — it does not mint an
own ACL on the child. This matches user intent ("stop this agent") and avoids
scattering materialised ACLs. Materialise-on-grant (D8) is the opposite case.
*Alternative*: materialise an own ACL minus the agent — rejected: it freezes
the child's inheritance forever as a side effect of a revoke, and (worse) a
copied-then-filtered ACL diverges silently from the parent thereafter.

## D8 — Materialise-on-grant copies inherited entries + owner Control

Granting on a resource with only inherited access creates its own `.acl`
(create-only PUT — the losing racer falls through to the CAS update path),
copying the APPLICABLE inherited entries retargeted at the resource
(containers keep `acl:default` so descendants keep inheriting), and always
ensuring the owner's Control entry exists. This mirrors how CSS-family servers
treat an own ACL as fully replacing inheritance.

## D9 — Resume is user-confirmed; snapshot re-validated (inbox-integrity residual)

An orphaned `Approving` request is completed only from the STORED snapshot
(§3.5 — never re-resolved; the owner approved a specific target set), via an
explicit user action that displays the pinned targets. Before any write the
snapshot is re-validated: targets must be inside the owner's storage and the
grantId must recompute from the stored tuple. **Honest residual**: the grantId
is a hash, not a MAC — an attacker who can REWRITE inbox resources could forge
a self-consistent `Approving` snapshot (confined to in-storage targets). The
mitigation stack: the inbox should be WAC **append-only** for foreign agents
(write ≠ append; a submitter then cannot modify a request after delivery), and
resume is never automatic. A keyed integrity tag (HMAC with an owner-local
secret) is a possible Phase-2 hardening; the proposal's P4 server-native
pipeline eliminates the issue (the server owns request-state integrity).

## D10 — Off-pod targets are unreachable by construction

`resolveTargets` confines the resolved set to the owner's storage root, and
`completeFromSnapshot` re-checks it. Found via a failing test during
development: an arbitrary IRI in `odrl:target` would otherwise have reached
`grantOnResource` and attempted ACL writes against a foreign origin (confused
deputy). Regression-tested.

## D11 — Approval defaults to the requested modes, Read when none named

The proposal says Phase-1 grants are read-only; the request shape still
carries actions. Implementation: the pipeline grants exactly the modes shown
in the preview (derived from the ODRL actions; empty → Read). Write-mode
requests thus CAN be approved but only after the user sees "Write" in the
preview. *Alternative*: hard-cap at Read; rejected as over-restrictive for a
consent screen that already shows modes explicitly — but flagged for
maintainer steer (the proposal's stricter reading is defensible).

## D12 — Type-index-only class resolution in Phase 1 (no SHACL yet)

The §2.3 ladder is SAI DataRegistration → Type Index → SHACL-validate. Phase 1
implements the Type-Index rung (the ubiquitous one; the suite has no SAI
registries in the wild) and pins concrete targets at grant time (§6.2's safe
default). The SHACL backbone (validate candidates against the class shape
before counting them) is the Phase-2 item, reusing the shacl-engine already
inlined in `@jeswr/solid-components`.

## D13 — `accm:` terms

Exactly the proposal §2.2's three labels (`DataClass`/`dataClass`/`resolvesTo`)
plus the §3.5 lifecycle terms (`status` + 4 states, `grantId`, `grantRef`,
`requestRef`, `schemaVersion`, `mode`, `agent`, `revokedAt`) under
`https://w3id.org/jeswr/accm#`. All state/glue, no enforcement weight. The
w3id redirect for `accm:` is a standing needs:user item.

## D14 — DPV receipt shape is minimal-but-real

`dpv:ConsentRecord` with `hasDataSubject`/`hasRecipient`/`hasPurpose`/
`hasConsentStatus`/`hasLegalBasis dpv:Consent` + `dct:created` and the accm
back-refs. The full ISO/IEC TS 27560 profile (dpv-27560 schema) is a Phase-2
upgrade; the fields chosen are a strict subset so records upgrade in place.

## D15 — Grant revocation is EXACT-SHAPE, dashboard revocation is per-line

Two revocation surfaces with deliberately different scopes (out of roborev
round 1's High finding):

- **Revoking a GRANT** (History view / `revokeGrant`) retracts only what the
  approval pipeline materialised: agent-scoped `acl:accessTo` entries in the
  pinned target's OWN ACL whose mode set equals the grant's. Ancestor
  `acl:default` entries, class-bearing (public/authenticated) entries, and
  manual shares with a different mode set are never touched — they are not
  the grant's to revoke. (An identical manual agent-only entry is
  indistinguishable by construction — `addAgentGrant` would have reused it —
  so exact-shape removal is the correct semantic, documented here.)
- **Revoking a dashboard LINE** (`removeAgentFromEntry` on the line's
  specific `authIri`) edits exactly the authorization the user pointed at,
  in the document where it lives (the ancestor's, for an inherited line —
  D7). That is the "stop this agent here" intent and is inherently per-line.

## Upstream findings (for the maintainer / library owners)

- `@solid/object` `Authorization.accessTo` / `.default` are single-valued
  (`OptionalFrom`), but WAC allows several values per authorization; this app
  ships a `ScopedAuthorization` extension with `SetFrom`-mapped `accessToAll`
  / `defaultForAll` (roborev round 5). Multi-valued upstream accessors would
  remove the need.
- `@solid/object` `Authorization.conforms` requires BOTH `accessTo` AND
  `default` to be defined (`Authorization.js`: `if (this.accessTo === undefined
  || this.default === undefined) return false`); WAC requires accessTo OR
  default, so conformant single-scope authorizations report `conforms ===
  false`. This app avoids `conforms`; worth an upstream issue.
- `@jeswr/solid-odrl` has no `append`-like action (WAC Append has no clean
  ODRL mapping here); this app maps read→Read, write/modify/delete→Write and
  ignores unknown actions. An ODRL profile term for append-only could be a
  solid-odrl extension alongside the proposal's `nextPolicy` delegation work.
- vitest 4 removed `environmentMatchGlobs`; the per-file
  `@vitest-environment` docblock is the replacement (affects suite templates).
