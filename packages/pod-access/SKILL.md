---
name: pod-access
description: Work on @jeswr/pod-access, the pod sharing and permissions across access-control models package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-access

This package owns the offline WAC/ACP translation core extracted from `apps/pod-migrator`:
readers/writers, neutral policy/report types, conservative translation, inheritance composition,
and bounded access proofs. See `README.md` for exports. The broader sharing client from SDK core
ADR-003 §9 is still unimplemented; the `./testing` entry point remains reserved.

Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial
tests with the implementation. Retain the migrator's conservative source readings, widest target
readings, target ACP allowlist, bounded complexity, report IDs/options, and dialect behavior.
Server implementation is a trusted caller assertion, never derived from editable access RDF.

The migrator owns HTTP, public group snapshots, review decisions, effective target phase proofs,
scope checks, conditional persistence, and execution. Run its tests when changing this core;
serializing a translated policy alone does not establish safe migration.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, dependency-first `build`, `typecheck`, and `test` scripts,
plus the migrator's regression suite and the repository gate.
