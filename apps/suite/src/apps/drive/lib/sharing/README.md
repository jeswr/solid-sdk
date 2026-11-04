<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Drive sharing core

`readSharing({ access, comments? })` projects already resolved RDF/JS documents with
`@solid/object` typed wrappers. It never discovers documents, fetches, mutates inputs,
serializes RDF or imports React. Each resource context supplies its URL and documents:
`{ model: "wac" | "acp", dataset, source, governingResource, inherited }`.
Supply one nearest effective ACL for WAC, or the own ACR plus ancestor ACRs for ACP.
An empty explicit document can serve as a destination for new grants. Inputs must use
the default graph; resource identity is exact, including trailing slashes.

People are sorted and deduplicated; modes from split authorizations are combined per
principal. Each row and `general` report `inherited`, `explicit`, and sorted `sources`.
Both flags may be true for ACP grants composed from own and ancestor policies.

- Viewer: resource Read.
- Commenter: resource Read and Append on the separate comments resource supplied by the caller.
- Editor: resource Read+Write (an explicit redundant Append is retained).
- Owner: editor plus WAC Control, or Read+Write on the own ACR itself for ACP.
  This is a permission summary, not proof of legal ownership; existing owner rows are immutable.
  ACP management modes may combine own policies and ancestor member policies targeting
  that own ACR. Access to an ancestor's ACR does not confer management of the item.

ACP permissions on the ACR are supported only as part of a named owner's full
Read+Write access to both the resource and its ACR. Management-only principals,
partial ACR permissions and all anonymous ACR permissions throw `SharingError` in
both projection and diff planning. Empty ACR grants confer no permissions.

Anonymous comments permissions cannot be expressed by the sharing shape and throw
`SharingError` in both projection and diff planning, including inherited grants.
Empty anonymous comments grants confer no permissions and are ignored.

`link` represents anonymous access, not a secret bearer capability. Its Read also appears
as `public: "viewer"`; link Editor is still publicly readable. To restrict anonymous access,
set both fields to `"none"`. Requesting public Viewer without link access produces the same
Read grant and will project back as link Viewer/public Viewer. No RDF vocabulary distinguishes
these two presentations (02-suite-shell §6).

`diffSharing(input, selection)` returns deterministic semantic authorization changes, with
`source`, `resource`, `principal`, and only the modes to `add`/`remove`. Unchanged rows emit
nothing. Commenter transitions can produce two resource changes. ACP owner creation also
produces a change on the ACR URL. This is a plan for the future SDK adapter, not an RDF patch
or a whole-document replacement. The adapter must split shared nodes, preserve unrelated
principals, scopes, container defaults and metadata, and persist with preconditions. This
library never instructs it to replace an ancestor document or change container inheritance.

Inherited rows cannot be changed or removed. New grants require an explicit destination.
Unsupported data throws `SharingError` instead of returning a misleading partial list:
groups, authenticated-agent classes, WAC origins, ACP deny/noneOf and conditional/unknown
matcher attributes, special owner/creator agents, unknown modes, and resource permissions
that cannot be represented by these roles. Supported ACP positive `allOf`/`anyOf` matcher
sets use intersection/union; public is a wildcard. No-match policies grant nothing.
The core targets the ACP authorization graph exposed by `@solid/object` 0.6.0.

Tests use fictional `example.org` identities and typed writers. The app's normal Vitest
command enforces 100% statements, branches, functions and lines for every `.ts` file here,
including the barrel and type declarations in the coverage include glob.

<!-- AUTHORED-BY Claude Opus 5.5 -->

## Drive share dialog adapter (SDK role layer)

`readSharing`/`diffSharing` above remain the offline WAC projection used by the shell
`WacSharingAdapter`. Drive's share dialog and its access labels (Details, the upload dialogs
and the copy-link toast) no longer use them: `adapter.ts` routes every read and write through
`@jeswr/pod-access/roles`.

`loadSharing(session, resource)` calls `readGrants` with the session's fetch and
`root: storageUrl`, and maps the SDK grants to the dialog's `SharingState`
(`manager` is shown as Owner; public Viewer/Editor is link access). Groups, apps,
authenticated-agent grants and anonymous Commenter/Manager fail closed. The SDK owns
discovery, scope and redirect refusal, WAC/ACP parsing, the inherited-ACL copy
(materialized with provenance), the owner-lockout guard and the conditional PUT.

`readGrants` silently drops principals whose modes map to no role (public Read+Append, Write
without Read, Control without Write) and reads a folder's own rules without its member rules.
`verify.ts` therefore records the access documents the SDK fetched (`recordAccess` wraps the
fetch; each GET is attributed to the HEAD before it) and re-reads them with the SDK's neutral
`readWac`/`readAcp`. `loadSharing` fails closed (`UNMAPPED`) unless every principal with
effective access appears at the role its raw modes map to and nobody else does; denials,
conditional rules, misattributed documents and reader failures fail the same way. For a
folder, `contentsDiffer` reports member access that differs from the folder's own; the
dialog notes it (`CONTENTS_DIFFER`) and `accessSummary` labels such a folder "Access unknown".

`applySharing(session, snapshot, selection)` translates the full selection into SDK grants:
unchanged principals keep their SDK rows verbatim, changed rows become explicit grants, and
`setGrants` runs with `expected: snapshot.grants`, so a stale snapshot never overwrites newer
access. App guards the SDK lacks stay here: owner-only saves, safe WebIDs, no duplicates,
other owners and inherited rows are immutable. The caller's own owner row is left to the
SDK's owner-lockout guard. Unchanged selections send no request.

SDK gap: `setGrants` seeds a WAC ACL's rows copied from an inherited default
(`materializedFrom`) before the caller's grants, so omitting such a principal never removes it.
After the conditional `setGrants`, each removed person (and anonymous access, when restricted)
also goes through `removeGrant`, which is a no-op once the principal is gone. The access is
then reloaded and compared with the selection: a mismatch is `SharingIncompleteError` with the
reloaded snapshot and the principals that did not change, and the dialog never announces
"Sharing saved" unless the reloaded access matches.

Errors: an SDK `conflict` (stale token, changed source or 412) becomes
`SharingConflictError` with a freshly loaded snapshot, or none with a reload prompt when the
re-read fails. Other `RoleError` codes map to fixed copy in `saveError`/`loadError`. An
unclassified failure or a refused (redirected) response after the PUT began is
`SharingRefreshError` with `committed: false`; a failed reload after an accepted write is
`SharingRefreshError` with `committed: true`, announced as "Sharing not confirmed".

Folders are read-only in the dialog for now: the SDK edits `acl:accessTo` /
`acp:accessControl` only, so a folder grant would not reach its contents and a removal
would leave descendant access in place. For an owner, every edit control is disabled and
`FOLDER_READ_ONLY` explains why and points to sharing each file directly; `applySharing`
refuses folder snapshots without a request. Commenter stays disabled until Drive has a
separate comments resource.

The ACP dialect is the SDK default (CSS: managers hold resource Control); no
`implementation` is passed, so Inrupt ESS pods are not recognised as owned. They fail
closed without writes, with `UNSUPPORTED_SYSTEM` copy: the SDK refuses ESS's query-string ACR
URL (`?ext=acr`) for every implementation, and rejects acp:* modes under the CSS dialect. Passing `"ess"` needs both
that SDK work and a trusted implementation signal, which the session does not provide;
see the comment above `options` in `adapter.ts`.
