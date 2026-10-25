<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# T-003 dependency-policy clarification (sst-8xm.29)

1. Which storage-client manifest dependency policy should `scripts/check-sdk-layers.mjs`
   enforce? T-003 says storage-client may depend **only** on storage-capabilities,
   fetch-rdf, rdf-serialize, guarded-fetch, @solid/object, @rdfjs/wrapper, and n3.
   ADR-001 §D1 instead also shows `pod-auth (type-only: AuthFetch)` and
   `(+ rdf-engine, lazily)` in the dependency diagram; ADR-004 §D1 repeats the
   storage-client type-only auth edge. ADR-003 §1 defines `AuthFetch = typeof fetch`
   locally, which permits implementing auth injection without a pod-auth dependency.
   A package.json dependency entry does not establish whether imports are type-only
   or lazy.

   - **Option A:** Enforce T-003's exact seven-package allowlist in `dependencies`.
     Reject pod-auth and rdf-engine there; the diagram's additional edges do not
     authorize exceptions to this manifest guard.
   - **Option B:** Permit the additional ADR-001 §D1 edges in the manifest guard,
     with a specified dependency field for the type-only pod-auth edge and source
     lint responsible for enforcing type-only/lazy usage. This changes the task's
     explicit allowlist and requires an architect decision.

Resolved on 2026-10-25 by ADR-001's amendment, "storage-client dependencies":
**Option A** is normative. The amendment explicitly excludes pod-auth and rdf-engine,
keeps AuthFetch local, and defers sparq integration to a later adapter package.
Implementation follows the exact seven-package allowlist in `dependencies`.
No open questions remain for T-003.
