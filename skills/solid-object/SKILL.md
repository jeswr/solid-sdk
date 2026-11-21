---
name: solid-object
description: Use when reading WebID profiles, storage roots, LDP containers, WAC or ACP resources, or converting access-control documents through the external @solid/object typed wrapper package, including from a no-build browser page that loads N3.js and the wrappers through an import map.
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

**Read Solid RDF with `@solid/object`**

`@solid/object` is currently an external dependency, not a package directory in this workspace. Use its existing typed wrappers before creating a local wrapper; move this skill beside the package if it is imported.

### Common wrappers

- `Agent` for a profile whose WebID you know (names, photos, issuer values, contacts, storage roots). `WebIdDataset.mainSubject` only when you do not know the WebID.
- `ContainerDataset`, `Container`, and `Resource` for LDP listings.
- `AclResource`, `Authorization`, and `Group` for WAC.
- `AccessControlResource`, `Policy`, and `Matcher` for ACP.
- `wacToAcp` and `acpToWac` for explicit conversion.

```ts
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";

const { dataset } = await fetchRdf(webId, { fetch });
const agent = new Agent(webId, dataset, DataFactory); // the WebID you asked for, not a guess
const storages = [...agent.storageUrls];
```

### Rules for untrusted RDF

- When you know the WebID, read it with `new Agent(webId, dataset, DataFactory)`. `WebIdDataset.mainSubject` returns the first subject that has any `solid:oidcIssuer`, which can be someone else in a document that describes several people.
- Never show `Agent.name` or `Agent.photoUrl` as they are: `name` falls back to the last path segment (`"card"` for `/profile/card#me`) and `photoUrl` returns a plain string literal as if it were a link. Use [`ProfileAgent`](references/profile-agent.ts.md) for display, which guards both.
- A WebID may advertise multiple storage roots or issuers. Require an explicit selection where ambiguity matters.
- Typed getters can throw on a foreign term of the wrong kind or datatype. Guard each fallback predicate independently so one malformed preferred value does not hide a valid fallback.
- For interoperable dates, read the lexical string and parse leniently when foreign producers may not use the exact expected datatype.
- Multi-valued typed accessors can be all-or-nothing. For hostile RDF, iterate matching objects and filter valid term types individually.
- Use one `DataFactory` consistently.
- These wrappers are primarily readers. Implement writes in explicit `TermWrapper` subclasses, serialize the complete dataset, and persist conditionally.
- Never hand-parse `.acl` or `.acr` documents when the typed models cover the operation.
- A page with no build step still parses with a library and reads through these wrappers: see [No-build browser page](#no-build-browser-page).

### Agent persona

When this work is delegated to a sub-agent, spawn the `solid-data-modeler` persona from
[`.claude/agents/solid-data-modeler.md`](../../.claude/agents/solid-data-modeler.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @solid/object — typed wrappers for Solid data

Pre-built `@rdfjs/wrapper` classes for the Solid data you read most (companion guide:
[`docs/guide`](../../docs/guide/README.md)). **Check here before writing your own wrapper** —
profile and container reading already exist.

```sh
npm install @solid/object n3     # n3 is required at runtime but NOT a dependency — install it
```

Pure ESM, Node ≥ 24. `@rdfjs/wrapper` (`^0.34.0`) comes transitively and is its only
dependency. Root import re-exports the classes; subpaths `./webid`, `./solid`, `./acp` also
exist, and `./vocabulary` (new in 0.8.0, not re-exported from the root) exports the IRI
constants `ACL`, `ACP`, `DC`, `FOAF`, `LDP`, `PIM`, `POSIX`, `RDF`, `RDFS`, `SOLID` and `VCARD`.

## What ships (v0.8.0, checked against the npm tarball on 2026-11-18)

| Class | Entry pattern | Key members |
|---|---|---|
| `Agent` (TermWrapper) | `new Agent(webIdIri, dataset, DataFactory)` | `name` (vcard:fn → foaf:name → IRI path tail), `vcardFn`, `foafName`, `email`, `phone`, `website` (vcard:hasUrl → foaf:homepage), `photoUrl` (vcard:hasPhoto, read as a string), `organization`, `role`, `title`, `pimStorage` / `solidStorage` / `storageUrls: Set<string>`, `oidcIssuer: Set<string>`, `knows: Set<string>`, `hasEmail`, `hasTelephone` |
| `WebIdDataset` (DatasetWrapper) | `new WebIdDataset(dataset, DataFactory).mainSubject` | `mainSubject: Agent \| undefined` — the **first** subject carrying any `solid:oidcIssuer`; only for when the WebID is unknown |
| `ContainerDataset` | `new ContainerDataset(dataset, DataFactory).container` | `container: Container \| undefined` |
| `Container` / `Resource` | via `ContainerDataset` | `contains: Set<Resource>`; per resource: `id`, `name`, `isContainer`, `title`, `label`, `modified`, `size`, `type`, `mimeType` |
| `Email` / `Telephone` (+ datasets) | | the only classes **with setters** (`emailAddress = …`) |
| WAC: `AclResource`, `Authorization`, `Group` | | typed `.acl` access |
| ACP: `AcrDataset`, `AccessControlResource`, `Policy`, `Matcher` | | typed `.acr` access |
| Converters | `wacToAcp(source: AclResource, target: DatasetCore)` / `acpToWac(source, target)` | translate between the two languages; throw `WacToAcpError` / `AcpToWacError` (extend `TranslationError`) |

## Reading a profile

```ts
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";

const { dataset } = await fetchRdf(webId);
const me = new Agent(webId, dataset, DataFactory);
console.log(me.foafName ?? me.vcardFn, [...me.storageUrls]);
```

**Read the WebID you know.** A profile document can describe several people (a friend with
their own `solid:oidcIssuer`, a group, an organisation). `WebIdDataset.mainSubject` returns the
first subject with an issuer, so in such a document it can return the other person: a test
with a friend listed before the owner returned the friend. Use `mainSubject` only when you
truly do not know the WebID, and then check that its `value` is the IRI you expected.

**Multiple storages:** `storageUrls` is a `Set` because WebIDs may advertise several
`pim:storage` values. When the app needs one, **present the list and let the user choose —
never silently take the first.** Do not guess the storage from the shape of the WebID (for
example `webId.startsWith(podRoot)`): the profile's `pim:storage` says which storage it uses.

## Rendering a profile — `ProfileAgent` reference class

`Agent.name` and `Agent.photoUrl` are **not safe to display**:

- `name` falls back to the last path segment of the IRI, so `https://alice.example/profile/card#me`
  with no name triples shows as `"card"`.
- `photoUrl` reads `vcard:hasPhoto` as a plain string, so a literal such as
  `"javascript:alert(1)"` comes back as if it were a link, and no scheme is checked.

For UI rendering use the bundled reference implementation,
[`profile-agent.ts`](references/profile-agent.ts.md), which extends `Agent` with full fallback
chains (name, avatar, bio, nickname, homepage). Each getter tries predicates in a documented
order, skips a value of the wrong term type instead of throwing, falls back to the full WebID
(never a path segment) for the name, and returns only `http:`/`https:` links. It was run in
Node 22 against `@solid/object` 0.8.0 and `@rdfjs/wrapper` 0.34.0, and in Chromium on a
no-build page. Copy it into `src/lib/` and adapt; it is a candidate for upstreaming into
`@solid/object`, at which point prefer the upstream version.

## No-build browser page

A static page or server template with no bundler still follows the RDF rule: parse with N3.js
and read through these wrappers, never a regular expression over Turtle or a walk over JSON-LD
as plain JSON. All three libraries are plain ES modules, so an import map is enough:

- `n3` ships a single browser ES module, `browser/n3.esm.min.js` (about 62 KB gzipped), with
  its Node polyfills built in.
- `@rdfjs/wrapper` has no dependencies, and `@solid/object` depends only on it. Both ship
  unbundled ES modules in `dist/` whose only bare import is `@rdfjs/wrapper`, so the import map
  must map that specifier once and both packages share the one copy.
- `@rdfjs/wrapper` touches Node's `Buffer` only to read hex and base64 literals; profile
  reading never reaches it.

```html
<script type="importmap">
{ "imports": {
  "n3": "https://cdn.jsdelivr.net/npm/n3@2.13.12/browser/n3.esm.min.js",
  "@rdfjs/wrapper": "https://cdn.jsdelivr.net/npm/@rdfjs/wrapper@0.34.0/dist/mod.js",
  "@solid/object": "https://cdn.jsdelivr.net/npm/@solid/object@0.8.0/dist/mod.js"
} }
</script>
<script type="module">
  import { Parser, Store, DataFactory } from "n3";
  import { Agent } from "@solid/object";

  const res = await fetch(webId, { headers: { accept: "text/turtle" } }); // every Solid server serves Turtle
  const store = new Store(new Parser({ baseIRI: res.url, format: "text/turtle" }).parse(await res.text()));
  const me = new Agent(webId, store, DataFactory);
</script>
```

- **Ask for `text/turtle` only.** Every Solid server must serve it, so no JSON-LD code is
  needed, and a server that stores Turtle does not convert on every view.
- **Parse against `res.url`**, the address the document was served from after redirects, not
  the WebID, so relative IRIs resolve correctly.
- **Bound the fetch.** A profile can live on any host: add a timeout (`AbortSignal.timeout`)
  and a size cap before parsing, and never let a page wait on one profile before it becomes
  usable. In a build-step app, `@jeswr/fetch-rdf` does this for you.
- **Load it only where needed.** Put the RDF code in its own module and `import()` it on first
  use, so pages that show no profile load no RDF library.
- **Costs.** The raw `dist/` files above are about 75 requests per page; esm.sh
  (`https://esm.sh/@solid/object@0.8.0`) serves pre-built modules in fewer. Pin exact versions.
- **Production.** Third-party script runs with the page's privileges. On pages with password
  or account forms, serve the same files from your own origin before launch, ideally one
  bundled file per library built once in the image (the import map keeps the same specifiers).

The raw-file import map was run in Chromium against a local static server serving the npm
tarballs of exactly these versions (2026-11-18). Import maps work in every current browser;
Firefox and Safari were not tested.

## Writing

All the classes above (except `Email`/`Telephone`) are **read-only getters**. The write path is
always your own `TermWrapper` subclass with `…As` setters over the same dataset, then serialise
+ conditional `PUT` — [guide chapter 4, Edit a resource](../../docs/guide/04-reading-and-writing.md#edit-a-resource).
Do not look for a `save()` here.

## Gotchas

| Gotcha | Detail |
|---|---|
| `mainSubject` returns the first subject with an issuer, which may not be the WebID | Read the known WebID with `new Agent(webId, …)`. `mainSubject` is also `undefined` when the profile carries no `solid:oidcIssuer`; surface a clear error then: the WebID is not usable for Solid login |
| `Agent.name` and `Agent.photoUrl` are unsafe to display | See [Rendering a profile](#rendering-a-profile--profileagent-reference-class): `"card"` as a name, a string literal as a picture link. `website` likewise reads `foaf:homepage` as a string |
| Fresh CSS pod profiles are bare | Only `foaf:Person` + `solid:oidcIssuer` — `name` is the path tail and `storageUrls` is empty until the profile is seeded (see the [`solid-test-infrastructure`](../solid-test-infrastructure/SKILL.md) skill) |
| `organization` / `role` expect **NamedNode** objects | A literal value in the data throws `TermTypeError` — wrap reads of untrusted profiles (see `first()` in `profile-agent.ts`). In 0.8.0 `title` reads a literal |
| `LiteralAs.date` is STRICT — it throws on a foreign serialiser's date | `LiteralAs.date` calls `ensureDatatype(term, xsd:date, xsd:dateTime)`, so it **throws `LiteralDatatypeError`** on a date-only string typed `xsd:string`, an untyped/plain literal (N3 types these `xsd:string`), or any value another app serialised loosely. When parsing RDF a **different app** wrote (interop), read the lexical value with `LiteralAs.string` (no datatype check) and parse leniently yourself — `const d = new Date(value); return Number.isNaN(d.getTime()) ? undefined : d;` — never `LiteralAs.date`, or one malformed/foreign literal throws and breaks the whole document's parse. (Verified against `@rdfjs/wrapper` 0.34.0 `LiteralAs`; learned reading SolidOS `cal:dtstart` — a date-only `"2016-06-23"` literal — in the Pod Manager `/schedule` interop, jeswr/solid-pod-manager `src/lib/schedule.ts`.) |
| Multi-valued reads (`SetFrom`/`rdf:type`) are **all-or-nothing** | `SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, …)` throws if **any one** object fails its mapping — so a subject typed `a <ValidType>, "garbage-literal"` loses its **entire** type set, and a valid note/profile then fails its `types.has(...)` check and is silently dropped. For a multi-valued predicate from untrusted RDF, read it **per object** off the dataset and filter, never via the throwing set accessor: `const types = new Set<string>(); for (const q of dataset.match(s, namedNode(RDF_TYPE), null)) if (q.object.termType === "NamedNode") types.add(q.object.value);` (Verified `@rdfjs/wrapper` 0.34.0; learned reconciling foreign `rdf:type` triples in jeswr/solid-chat-interop.) |
| Fallback-chain reads mask each other — guard **per predicate** | A typed getter that prefers one predicate and falls back to another — `LiteralAs.date(DCT_CREATED) ?? LiteralAs.date(AS_PUBLISHED)` — **skips the valid fallback** when the *preferred* literal is malformed, because the strict read throws before `??` is evaluated (caught higher up, the fallback is never tried → the value is wrongly dropped). Wrap **each** predicate read individually so a bad preferred value falls through: `tryRead(() => …pref) ?? tryRead(() => …fallback)` where `tryRead = (f) => { try { return f(); } catch { return undefined; } }`. (Learned in jeswr/solid-chat-interop reconciling AS2.0 ↔ SolidOS LongChat.) |
| `LiteralAs.string` is **lenient** (the safe read for untrusted literals) | Unlike `LiteralAs.date`, `LiteralAs.string` does **not** datatype-check — it returns the lexical value of whatever literal is present (e.g. an `xsd:integer` `42` reads as `"42"`), so it never throws on a foreign serialiser's loose typing. This is why the interop pattern reads with `LiteralAs.string` and parses leniently. (`NamedNodeAs.string` is the strict one for that kind — a literal where an IRI is expected throws `TermTypeError`; guard it like the date case.) (Verified `@rdfjs/wrapper` 0.34.0 in jeswr/solid-chat-interop.) |
| `n3` must be installed explicitly | It is a devDependency upstream, not a runtime dependency |
| One `DataFactory` everywhere | Mixing factories breaks term equality |
| Access control | Never hand-parse `.acl`/`.acr` — these typed classes + the converters are the only sanctioned path ([guide chapter 7](../../docs/guide/07-sharing.md)) |
