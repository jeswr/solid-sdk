---
name: personal-agent
description: Maintain the imported personal-agent M1 and September pilot, its Reader/Actor/outbox split, synthetic bindings, credentials seams, dashboard, and triage until extraction into agent-* packages.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Personal-agent import

This package preserves the pilot while later tasks extract its modules. Keep the existing
public exports (`.`, `./reader`, `./actor`, `./outbox`, `./pod`, `./pilot`) and CLI entry points.
Do not combine the Reader, Actor, and credential-holding executor trust boundaries.

Use injected fetch, token providers, clocks, stores, and synthetic calendars in tests.
Never run provisioning or live provider scripts as verification. Send paths stay dry-run by
default. Do not read a real credential store or invoke a model provider.

The workspace owns pnpm, Biome, TypeScript, Vitest 4, and the lockfile. Build dependency
packages first, then run this package's lint, build, typecheck, test, and test:coverage scripts.
Coverage measures all non-test TypeScript under `src/`; `securityCritical` remains unset
unless every coverage metric reaches 100% and thresholds enforce it.

The colocated `LOCAL-HANDOFF.md` and `docs/` describe the imported implementation. Agent design
and extraction sequencing remain with the program design; keep `src/triage/typesafe.ts`
until A-011. Do not run it against a provider.

`mirrorPublish.inlined` is empty because tsc preserves runtime imports and declarations.
Every workspace dependency needs an explicit mirror SHA when publishing is authorized.
Never hand-edit mirrors or commit `dist/` here.
