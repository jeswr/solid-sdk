---
name: pod-access
description: Use when working on @jeswr/pod-access, the pod sharing and permissions across access-control models package in the Solid SDK workspace, for neutral WAC/ACP policies, effective access, conservative translation, readers/writers and never-widen proofs across CSS, ESS and NSS.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

Read [README.md](README.md) for the public API and
[DESIGN §3–6](../../apps/pod-migrator/docs/DESIGN.md#3-neutral-model) for the access contract.
Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.
ADR-003 §9 governs packaging; this extraction implements the policy
utilities, not the future storage-backed `share`/`grants` client or LWS services.

- Import the root entry for neutral types, `effectivePolicy`/`effectiveMembers`, scope/union
  helpers, `assertNotWider`/`policiesEqual`, WAC/ACP readers/writers, `isPolicyTooComplex`,
  `translatePolicy` and `reportItem`. `./testing` provides empty and owner-only policy fixtures.
  Keep RDF, URL and transport helpers in the calling app; no pod I/O belongs here.
- Never widen: translate effective policies, report unsupported constructs, then prove the
  result with `assertNotWider`. Complexity refuses safely. The optional target-owner proof
  exemption requires the caller to establish ownership independently.
- Read sources with the strictest plausible semantics; pass the independently established
  implementation to `effectivePolicy` only for sources. ESS explicit policies suppress ancestor
  grants, while ancestor denials remain. Read targets with `target: true`, use additive
  composition, and retain the widest plausible permissions or refuse the document.
- ESS target allowlist is closed: exclusive ACR root, simple agent/public/authenticated
  `allOf`/`noneOf`, known `acp:*` modes, Read+Write ACR access. No client/issuer/VC, role
  matchers, `anyOf`, foreign modes, detached nodes or extra triples. Never infer dialect from RDF.
- Parse with `@jeswr/fetch-rdf`, use `@solid/object`/`@rdfjs/wrapper`, serialize with `n3.Writer`.
  Keep serialized bytes and report IDs stable during moves. Caller-owned transport discovers
  ACL links and anonymously verifies group snapshots; this package accepts established evidence.

In-process callers are trusted code; JavaScript cannot prevent same-realm code from patching
prototypes or built-ins such as `Set.prototype.has` or `Array.prototype`.
The package therefore does not defend against deliberate prototype patching and keeps internal
mutable state, RDF helpers and helper classes out of its public exports.
Frozen mode lists guard against accidental mutation; returned policies and reports remain caller-owned.

Security critical: retain 100% coverage thresholds and adversarial CSS/ESS/NSS regressions.
The mixed regression suites use the app's test harness only, with no runtime app dependency.
Keep tools aligned with the root; use `workspace:*`, dependency-first builds and Node >=24.
The pinned pnpm 10.4.1 with `ignore-scripts` requires local tool declarations for filtered scripts.
Validate `lint`, `build`, `typecheck`, `test`, both-package Turbo gate and `pnpm run lint:root`.
