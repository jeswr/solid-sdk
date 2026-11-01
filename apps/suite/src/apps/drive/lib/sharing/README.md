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

<!-- AUTHORED-BY Codex -->

## Drive persistence adapter

`apply.ts` adds `loadSharing(session, resource)` and `applySharing(session, snapshot,
selection)`. The session supplies authenticated fetch, the selected storage root and
signed-in WebID. Reads use advertised endpoints and stay inside that storage. WAC
resolves the nearest ACL (including legacy `defaultForNew`); ACP loads the own ACR
and ancestors. Unsupported graphs still fail closed through `readSharing`.

Before creating an own WAC ACL, the adapter copies every effective inherited grant,
including Control, and retains child defaults when the resource is a folder.
Changes preserve other principals, targets, defaults and metadata. Ancestors are
never written. Sources and discovery are revalidated, and PUT uses the captured
strong ETag or `If-None-Match: *`. A 412 produces `SharingConflictError` with a fresh
snapshot and the message “Sharing changed elsewhere, review and try again”. Existing
owners and inherited rows remain immutable; a non-owner cannot save changes.

The Drive dialog uses Viewer and Editor. Commenter stays disabled until Drive has a
separate comments resource; it never substitutes Append on the file for commenting.
