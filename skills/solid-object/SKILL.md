---
name: solid-object
description: Use when reading WebID profiles, storage roots, LDP containers, WAC or ACP resources, or converting access-control documents through the external @solid/object typed wrapper package.
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-5 -->

**Read Solid RDF with `@solid/object`**

`@solid/object` is currently an external dependency, not a package directory in this workspace. Use its existing typed wrappers before creating a local wrapper; move this skill beside the package if it is imported.

### Common wrappers

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

### Rules for untrusted RDF

- A WebID may advertise multiple storage roots or issuers. Require an explicit selection where ambiguity matters.
- Typed getters can throw on a foreign term of the wrong kind or datatype. Guard each fallback predicate independently so one malformed preferred value does not hide a valid fallback.
- For interoperable dates, read the lexical string and parse leniently when foreign producers may not use the exact expected datatype.
- Multi-valued typed accessors can be all-or-nothing. For hostile RDF, iterate matching objects and filter valid term types individually.
- Use one `DataFactory` consistently.
- These wrappers are primarily readers. Implement writes in explicit `TermWrapper` subclasses, serialize the complete dataset, and persist conditionally.
- Never hand-parse `.acl` or `.acr` documents when the typed models cover the operation.

### Agent persona

When this work is delegated to a sub-agent, spawn the `solid-data-modeler` persona from
[`.claude/agents/solid-data-modeler.md`](../../.claude/agents/solid-data-modeler.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @solid/object — typed wrappers for Solid data

Pre-built `@rdfjs/wrapper` classes for the Solid data you read most (companion guide:
[`AGENTS.md`](../../AGENTS.md)). **Check here before writing your own wrapper** — profile and
container reading already exist.

```sh
npm install @solid/object n3     # n3 is required at runtime but NOT a dependency — install it
```

Pure ESM, Node ≥ 24. `@rdfjs/wrapper` comes transitively. Root import re-exports everything;
subpaths `./webid`, `./solid`, `./acp` also exist.

## What ships (v0.6.0)

| Class | Entry pattern | Key members |
|---|---|---|
| `WebIdDataset` (DatasetWrapper) | `new WebIdDataset(dataset, DataFactory).mainSubject` | `mainSubject: Agent \| undefined` — the subject carrying `solid:oidcIssuer` |
| `Agent` (TermWrapper) | `new Agent(webIdIri, dataset, DataFactory)` | `name` (vcard:fn → foaf:name → IRI tail), `vcardFn`, `foafName`, `email`, `phone`, `website`, `photoUrl`, `organization`, `role`, `title`, `pimStorage` / `solidStorage` / `storageUrls: Set<string>`, `oidcIssuer: Set<string>`, `knows: Set<string>`, `hasEmail`, `hasTelephone` |
| `ContainerDataset` | `new ContainerDataset(dataset, DataFactory).container` | `container: Container \| undefined` |
| `Container` / `Resource` | via `ContainerDataset` | `contains: Set<Resource>`; per resource: `id`, `name`, `isContainer`, `title`, `label`, `modified`, `size`, `type`, `mimeType` |
| `Email` / `Telephone` (+ datasets) | | the only classes **with setters** (`emailAddress = …`) |
| WAC: `AclResource`, `Authorization`, `Group` | | typed `.acl` access |
| ACP: `AccessControlResource`, `Policy`, `Matcher` | | typed `.acr` access |
| Converters | `wacToAcp(source: AclResource, target: DatasetCore)` / `acpToWac(source, target)` | translate between the two languages; throw `WacToAcpError` / `AcpToWacError` (extend `TranslationError`) |

## Reading a profile

```ts
import { fetchRdf } from "@jeswr/fetch-rdf";
import { WebIdDataset } from "@solid/object";
import { DataFactory } from "n3";

const { dataset } = await fetchRdf(webId);
const me = new WebIdDataset(dataset, DataFactory).mainSubject;
console.log(me?.name, [...(me?.storageUrls ?? [])]);
```

**Multiple storages:** `storageUrls` is a `Set` because WebIDs may advertise several
`pim:storage` values. When the app needs one, **present the list and let the user choose —
never silently take the first.**

## Rendering a profile — `ProfileAgent` reference class

`Agent.name` covers `vcard:fn → foaf:name` only. For UI rendering you want the full fallback
chains (name, avatar, bio, nickname, homepage). That class does not exist upstream yet, so this
skill bundles a compile-verified reference implementation —
[`profile-agent.ts`](references/profile-agent.ts.md) — extending `Agent`. Copy it into `src/lib/` and adapt;
it is a candidate for upstreaming into `@solid/object`, at which point prefer the upstream
version. Pattern: each getter tries predicates in a documented preference order and survives
wrong term types (a literal where an IRI is expected skips to the next candidate, never throws).

## Writing

All the classes above (except `Email`/`Telephone`) are **read-only getters**. The write path is
always your own `TermWrapper` subclass with `…As` setters over the same dataset, then serialise
+ conditional `PUT` — `AGENTS.md` §Writing data. Do not look for a `save()` here.

## Gotchas

| Gotcha | Detail |
|---|---|
| `mainSubject` is `undefined` when the profile carries no `solid:oidcIssuer` | Surface a clear error: the WebID is not usable for Solid login |
| Fresh CSS pod profiles are bare | Only `foaf:Person` + `solid:oidcIssuer` — `name` is `undefined` and `storageUrls` is empty until the profile is seeded (AGENTS.md §Servers) |
| `organization` / `role` / `title` expect **NamedNode** objects | A literal value in the data throws `TermTypeError` — wrap reads of untrusted profiles (see `first()` in `profile-agent.ts`) |
| `LiteralAs.date` is STRICT — it throws on a foreign serialiser's date | `LiteralAs.date` calls `ensureDatatype(term, xsd:date, xsd:dateTime)`, so it **throws `LiteralDatatypeError`** on a date-only string typed `xsd:string`, an untyped/plain literal (N3 types these `xsd:string`), or any value another app serialised loosely. When parsing RDF a **different app** wrote (interop), read the lexical value with `LiteralAs.string` (no datatype check) and parse leniently yourself — `const d = new Date(value); return Number.isNaN(d.getTime()) ? undefined : d;` — never `LiteralAs.date`, or one malformed/foreign literal throws and breaks the whole document's parse. (Verified against `@rdfjs/wrapper` 0.34.0 `LiteralAs`; learned reading SolidOS `cal:dtstart` — a date-only `"2016-06-23"` literal — in the Pod Manager `/schedule` interop, jeswr/solid-pod-manager `src/lib/schedule.ts`.) |
| Multi-valued reads (`SetFrom`/`rdf:type`) are **all-or-nothing** | `SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, …)` throws if **any one** object fails its mapping — so a subject typed `a <ValidType>, "garbage-literal"` loses its **entire** type set, and a valid note/profile then fails its `types.has(...)` check and is silently dropped. For a multi-valued predicate from untrusted RDF, read it **per object** off the dataset and filter, never via the throwing set accessor: `const types = new Set<string>(); for (const q of dataset.match(s, namedNode(RDF_TYPE), null)) if (q.object.termType === "NamedNode") types.add(q.object.value);` (Verified `@rdfjs/wrapper` 0.34.0; learned reconciling foreign `rdf:type` triples in jeswr/solid-chat-interop.) |
| Fallback-chain reads mask each other — guard **per predicate** | A typed getter that prefers one predicate and falls back to another — `LiteralAs.date(DCT_CREATED) ?? LiteralAs.date(AS_PUBLISHED)` — **skips the valid fallback** when the *preferred* literal is malformed, because the strict read throws before `??` is evaluated (caught higher up, the fallback is never tried → the value is wrongly dropped). Wrap **each** predicate read individually so a bad preferred value falls through: `tryRead(() => …pref) ?? tryRead(() => …fallback)` where `tryRead = (f) => { try { return f(); } catch { return undefined; } }`. (Learned in jeswr/solid-chat-interop reconciling AS2.0 ↔ SolidOS LongChat.) |
| `LiteralAs.string` is **lenient** (the safe read for untrusted literals) | Unlike `LiteralAs.date`, `LiteralAs.string` does **not** datatype-check — it returns the lexical value of whatever literal is present (e.g. an `xsd:integer` `42` reads as `"42"`), so it never throws on a foreign serialiser's loose typing. This is why the interop pattern reads with `LiteralAs.string` and parses leniently. (`NamedNodeAs.string` is the strict one for that kind — a literal where an IRI is expected throws `TermTypeError`; guard it like the date case.) (Verified `@rdfjs/wrapper` 0.34.0 in jeswr/solid-chat-interop.) |
| `n3` must be installed explicitly | It is a devDependency upstream, not a runtime dependency |
| One `DataFactory` everywhere | Mixing factories breaks term equality |
| Access control | Never hand-parse `.acl`/`.acr` — these typed classes + the converters are the only sanctioned path (`AGENTS.md` §Access control) |
