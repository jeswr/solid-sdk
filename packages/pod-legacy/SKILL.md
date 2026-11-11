---
name: pod-legacy
description: Use when recording private digital legacy plans, regenerating the LegacyPlan model, previewing grants or evaluating inactivity without enforcement.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Read README.md and the repository AGENTS.md. This package is security-critical. Generate the
model from legacy.ttl, legacy.shacl.ttl and codegen.config.json; never edit src/generated.
After deliberate input changes run codegen --update-lock and the byte-for-byte drift test.

Use evaluatePlan and proposedGrants for advisory UI. Never call pod-access share/addGrant from
this package or a consumer on the basis of a due state. No grant enforcement exists in this
slice. Malformed plans must never be due. Preserve calendar months, future-clock behavior,
required fields, exact WebIDs, scope boundaries, read-only mode and the 24-hour activity throttle.

Persist through createLegacyStore with the authenticated, account-fenced fetch and public storage
client. Keep every write conditional. The WAC-only privacy proof checks all modes through
pod-access; readGrants role rows alone cannot prove privacy because partial rights may be absent
from their projection. Never silently accept ACP, LWS, unreadable/unknown access, a foreign owner,
or a changed ETag. Never write plan content to an unverified placeholder or alter access controls.
Read README's non-atomic ACL-check limitation before modifying storage.

Add adversarial tests for every new branch. Keep 100% coverage thresholds. Run lint, dependency-first
build, typecheck, test, root guards, and consumer browser flow. This slice needs no external service.
