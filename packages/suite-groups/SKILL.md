---
name: suite-groups
description: Use when managing suite shareable vCard groups, Family setup, group grants or group notification receipts.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Use GroupDirectory with an existing public StorageClient and the current account's bounded fetch.
Read README.md and pod-access/SKILL.md. WAC only; refuse ACP/LWS/unknown capability states.
Use the existing solid-task-model ContactGroup; do not add hand-written RDF or fields.
Shareable groups are publicly readable in groups/, separate from private Contacts labels.
Never widen access to the whole pod or to private group settings. Show GROUP_PRIVACY in the UI.
Refuse unsafe or private group documents, and never publish a nonempty private groups container.
Check access on raw modes (pod-access readAccessModes), never the role projection, which hides
Append-only and Write-only principals; check the groups folder's member scope too.
Group grants are Viewer/Editor only; never target the root, settings/, groups/ (isGrantableTarget).
Trust a dedicated folder (groups/, settings) only while it is sealed (pod-access sealAccess) and
safe, and its documents only while they inherit its ACL (governedBy). Seal LAST, after the rewrite
and cleanup, so any failure leaves it unsealed and refused; never trust "owner-only now" alone.
Secure only empty unsafe folders; cleanup deletes readable documents first and keeps going past
failures (SECURING_RACE); a surviving readable document withholds the seal (SECURING_BLOCKED).
Collections share references only; use extend(source, resources, { within }) for contents the
owner adds later, passing only that action's own additions, never members others could write.
Share multi-resource items in one call so each member receives at most one notification attempt.
Keep conditional writes, deletion reviews, complete scans and notification claims before delivery.
Run lint, dependency-first build, typecheck, exhaustive tests, root lint and suite demo e2e.
