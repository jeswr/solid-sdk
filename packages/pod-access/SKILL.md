---
name: pod-access
description: Use when working on @jeswr/pod-access, the pod sharing and permissions across access-control models package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

This package owns the offline WAC/ACP translation core extracted from `apps/pod-migrator`:
readers/writers, neutral policy/report types, conservative translation, inheritance composition,
and bounded access proofs. The `./requests-solid` entry adds Solid request listing and conditional
WAC decisions ported from Access Manager. See `README.md` for exports. The broader sharing client
from SDK core ADR-003 §9 is still unimplemented; the `./testing` entry point remains reserved.

Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial
tests with the implementation. Retain the migrator's conservative source readings, widest target
readings, target ACP allowlist, bounded complexity, report IDs/options, and dialect behavior.
Server implementation is a trusted caller assertion, never derived from editable access RDF.

In-process callers are trusted code. Keep internal mode lists private and frozen and helper
classes out of public exports; no export may let one caller alter another caller's proof.
The public mode list is a frozen copy; returned policies and reports are caller-owned.
Patching shared JavaScript built-ins or dependencies directly is outside this trust boundary.

The migrator owns HTTP, public group snapshots, review decisions, effective target phase proofs,
scope checks, conditional persistence, and execution. Run its tests when changing this core;
serializing a translated policy alone does not establish safe migration.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

For `./requests-solid`, preserve resolve-once target pinning before the Approving CAS, deterministic
grant IDs, create-only records/receipts, ACL writes after the CAS, and forward-only snapshot recovery.
On 412 re-read and observe the winner. Require strong ETags for request and existing ACL updates;
materialise missing own ACLs create-only. Reject off-storage targets and credentialed discovery links.
Keep parsing lenient, byte/member work bounded, and requester metadata notification-local.
Keep one internal `applyGrant` seam for SDK-APP-04. Reject ACP/unknown materialisation with the typed
error. WAC expiry is receipt metadata only: document `expiryEnforced: false` and never imply revocation.
Delivery through unauthenticated `publicFetch` is best effort and cannot roll back committed decisions;
it never falls back to global fetch, and requester URLs must be public HTTPS. Each approved data type
grants only its own requested modes (`modesByType`).
Request/record documents must be owner-write-only; retries are explicit user-confirmed recovery.
Internal RDF wrappers remain private; the request subpath exports only its typed error classes.

Validate changes with this package's `lint`, dependency-first `build`, `typecheck`, and `test` scripts,
plus the migrator's regression suite and the repository gate.
