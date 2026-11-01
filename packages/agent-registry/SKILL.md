---
name: agent-registry
description: Use when working on the account and binding inventory surface in @jeswr/agent-registry.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-registry

Read agent DESIGN §2.4 and the README before changing the importer or account settings.
The root export is daemon-side; `./settings` is browser-safe; `./testing` contains offline fakes.

- Never read a real registry during development. Use the synthetic YAML fixture (28 accounts,
  plus one added Telegram bot). No raw handle may appear in emitted RDF or settings.
- Hash handles with HMAC-SHA-256 using the injected persistent daemon salt. Never generate
  a fallback salt or publish raw ids/notes/labels. Do not fold Gmail aliases.
- Credential references are `op://vault/item/field` or explicit `profile:name`, never values.
  Do not resolve references, run `op`, or read daemon credentials. Reject references with handles.
- Setup and historic evidence cannot prove a live connection. Restrictions default false;
  inventory import never grants access, enables sends, or satisfies a mandate.
- `ports.ts` is the minimal temporary SDK storage seam. Persist owner-only ACLs before
  content, use ETags/conditional creates, and reject transport errors. Do not assume absent
  content when access was denied. Re-import replaces stable hashed URLs, never appends.
- Emit and validate accounts through `@jeswr/agent-model`'s RDF mappings. Registry fields
  belong to inventory; preserve validated owner restrictions, label and binding state on
  re-import, and skip semantically unchanged accounts. New accounts remain default-deny.
  Extend the shared vocabulary and mappings when inventory needs new fields. Do not build
  triples or Turtle by hand.
- Keep settings assessments offline and default-deny. Browser settings must not import file
  or crypto modules. The executor owns provider/mandate enforcement, not this settings model.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Never use live providers, pods or credentials in tests. Only the model
gateway may import OpenAI/Anthropic SDKs; send subpaths belong to the executor.
