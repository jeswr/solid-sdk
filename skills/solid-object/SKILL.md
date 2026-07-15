---
name: solid-object
description: Use when reading WebID profiles, storage roots, LDP containers, WAC or ACP resources, or converting access-control documents through the external @solid/object typed wrapper package.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Read Solid RDF with `@solid/object`

`@solid/object` is currently an external dependency, not a package directory in this workspace. Use its existing typed wrappers before creating a local wrapper; move this skill beside the package if it is imported.

## Common wrappers

- `WebIdDataset` and `Agent` for profiles, names, photos, issuer values, contacts, and storage roots.
- `ContainerDataset`, `Container`, and `Resource` for LDP listings.
- `AclResource`, `Authorization`, and `Group` for WAC.
- `AccessControlResource`, `Policy`, and `Matcher` for ACP.
- `wacToAcp` and `acpToWac` for explicit conversion.

```ts
import { fetchRdf } from "@jeswr/fetch-rdf";
import { WebIdDataset } from "@solid/object";
import { DataFactory } from "n3";

const { dataset } = await fetchRdf(webId, { fetch });
const agent = new WebIdDataset(dataset, DataFactory).mainSubject;
const storages = [...(agent?.storageUrls ?? [])];
```

## Rules for untrusted RDF

- A WebID may advertise multiple storage roots or issuers. Require an explicit selection where ambiguity matters.
- Typed getters can throw on a foreign term of the wrong kind or datatype. Guard each fallback predicate independently so one malformed preferred value does not hide a valid fallback.
- For interoperable dates, read the lexical string and parse leniently when foreign producers may not use the exact expected datatype.
- Multi-valued typed accessors can be all-or-nothing. For hostile RDF, iterate matching objects and filter valid term types individually.
- Use one `DataFactory` consistently.
- These wrappers are primarily readers. Implement writes in explicit `TermWrapper` subclasses, serialize the complete dataset, and persist conditionally.
- Never hand-parse `.acl` or `.acr` documents when the typed models cover the operation.

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-data-modeler` persona from
[`.claude/agents/solid-data-modeler.md`](../../.claude/agents/solid-data-modeler.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
