---
name: solid-scale-and-sharding
description: Use when choosing Solid pod document layout, deciding when to split a collection, designing date or hash shards, handling large LDP containers, or deciding whether client-side SPARQL is appropriate.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Design Solid document layout

A Solid pod is a document store, not a server-side query engine. Start with one document while data shares one audience.

Split in this order:

1. Permission boundary: resources with different readers/writers need different documents.
2. Interoperability: follow an existing ecosystem model and its deployed layout.
3. Measured size/performance: shard only after whole-document transfer or container listing is a real bottleneck.

## Sharding choices

- By permission for public/shared/private data.
- By date for append-heavy time series such as chat or logs.
- By hash for stable random access without a time dimension.

Keep containers to hundreds rather than thousands of direct members when practical. Container URLs end in `/`; create intermediate containers explicitly.

## Discovery and queries

- Reuse established vocabularies and shapes for chat, bookmarks, contacts, calendars, and tasks.
- Register interoperable data through the Type Index with `solid:instance` or `solid:instanceContainer`.
- Add a small rebuildable summary resource only when the UI needs ordered/filterable metadata the Type Index cannot express.
- Do not expect LDP listings to provide filtering, ordering, limit, or offset.
- Keep Comunica/client-side SPARQL off render-blocking paths; it traverses and evaluates on the client.
- Prefer conditional whole-document `PUT` through typed RDF models until a sanctioned patch builder is available.

Before introducing a shard, document which permission, interop, or measured performance constraint requires it and how callers discover every shard.

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-app-builder` persona from
[`.claude/agents/solid-app-builder.md`](../../.claude/agents/solid-app-builder.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
