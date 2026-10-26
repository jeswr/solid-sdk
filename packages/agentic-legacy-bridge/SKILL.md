---
name: agentic-legacy-bridge
description: Maintain imported channel parsing, BridgeMessage and ChannelAdapter contracts, metadata interpretation, approval-gated replies, webhook verification, and email/Slack/WhatsApp transforms.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Legacy bridge import

Preserve the channel-neutral contracts and the public `.`, `./email`, `./metadata`, and
`./webhook` exports. The existing `PROTOCOL.md` and `docs/DECISIONS.md` describe wire behavior.
Future extraction into agent-channels is a separate task.

Treat inbound messages as hostile. Identity, authority, interpretation, and approval are
separate assessments; missing or unverifiable evidence must not authorize a reply.
Keep transport, fetch, signer, interpreter, approval, and pod storage injectable. Tests use
synthetic messages and in-memory stores; never call a real provider, model, or Solid pod.

The workspace owns pnpm, Biome, TypeScript, Vitest 4, and the lockfile. Build workspace
dependencies first, then run lint, build, typecheck, test, and test:coverage. Coverage measures
all non-test TypeScript under `src/`; do not set `securityCritical` without 100% in all metrics
and enforced thresholds.

Use the suite RDF libraries for parsing, typed access, and serialization. Keep workspace
dependencies as `workspace:*`; fetch-rdf remains a registry dependency until imported.
The tsc build preserves dependency imports, so `mirrorPublish.inlined` is empty and all
workspace dependencies require explicit mirror SHAs. Publishing is separate authorization;
never hand-edit mirrors or commit `dist/` here.
