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
Secure only empty unsafe folders; auto-delete only what appears during this pass's rewrite,
readable documents first, past failures (SECURING_RACE); a survivor withholds the seal
(SECURING_BLOCKED). Never delete documents a safe unsealed folder already holds: refuse with
*_UNVERIFIED and let the owner choose verifyFolder(folder, "keep" | "discard") (unverified()).
Exception: securing an unsafe folder marks it (setGrants securing, isSecuring) in the same rewrite
until the seal; a still-marked folder is planted, never kept (SECURING_INTERRUPTED), and its
contents go on the next pass. Re-check the seal before deleting (another tab may have sealed it).
unverified() previews contents with the readers' parsers and no side effects; offer Keep only when
keepable, after a confirmation showing the contents, and move focus with each step.
Collections share references only; use extend(source, resources, { within }) for contents the
owner adds later, passing only that action's own additions, never members others could write.
Share multi-resource items in one call so each member receives at most one notification attempt.
Keep conditional writes, deletion reviews, complete scans and notification claims before delivery.
Run lint, dependency-first build, typecheck, exhaustive tests, root lint and suite demo e2e.
