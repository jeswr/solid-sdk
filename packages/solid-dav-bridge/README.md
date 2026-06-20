<!-- AUTHORED-BY Claude Opus 4.8 -->
# @jeswr/solid-dav-bridge

Import **CalDAV** calendars ([RFC 4791]) and **CardDAV** address books ([RFC 6352])
into a [Solid](https://solidproject.org) pod, by mapping the well-specified
**iCalendar** ([RFC 5545]) / **vCard** ([RFC 6350]) formats to RDF the suite already
speaks. **Read / import-only (phase 1), owner-private.**

This is a *standard-protocol bridge* — it maps a well-specified format to RDF — **not**
an app plugin.

- **iCalendar VEVENT → `schema:Event`** (schema.org), emitted via typed quads +
  `n3.Writer` (never hand-concatenated Turtle). Fields schema.org lacks keep the W3C
  RDF-iCal vocab (`ical:`) — chiefly the raw **`RRULE`** as `ical:rrule` (carried
  verbatim; recurrence is **not** expanded in phase 1). The subject is typed **both**
  `schema:Event` and `ical:Vevent`. No new vocabulary is invented.
- **vCard → `vcard:AddressBook`** via [`@jeswr/solid-task-model`](https://github.com/jeswr/solid-task-model)'s
  `./contacts` `buildPerson` — the SolidOS-readable structured `vcard:hasEmail [
  vcard:value <mailto:…> ]` form, **never** hand-built vcard triples.

```
CalDAV .ics / CardDAV .vcf  ─▶  VEVENT/VCARD  ─▶  schema:Event / vcard:Individual  ─▶  PUT  ─▶  pod
(a user DAV URL, SSRF-guarded)   (in-house RFC      (typed quads / buildPerson,          (owner-private)
 OR already-fetched text          5545/6350 parser)  n3.Writer — no hand-built RDF)
```

## Install

GitHub-installable now (committed, drift-guarded `dist/`; `ignore-scripts=true`-safe):

```sh
npm install github:jeswr/solid-dav-bridge#main
```

The committed `dist/` is self-contained (a minimal in-house RFC 5545/6350 parser, no
inlined third-party parser), so it installs and imports with **no build step** under
`ignore-scripts=true`. npm publish is a deferred suite migration, not a blocker.

## Quick start

```ts
import { importCalendar, importAddressBook } from "@jeswr/solid-dav-bridge";

// You already have the .ics text (e.g. a CalDAV export). No network is touched.
const calReport = await importCalendar({
  icsText,                                                  // raw iCalendar text
  writeFetch: session.fetch,                                // your DPoP/WebID-authed fetch
  container: "https://alice.pod.example/imports/calendar/", // MUST be owner-private
});
console.log(`${calReport.written}/${calReport.total} events imported`);

const cardReport = await importAddressBook({
  vcfText,                                                  // raw vCard text
  writeFetch: session.fetch,
  container: "https://alice.pod.example/contacts/",          // MUST be owner-private
  inAddressBook: "https://alice.pod.example/contacts/book.ttl#this", // optional back-link
});
```

### Fetch directly from a DAV endpoint (optional, SSRF-guarded)

```ts
// Pass a davUrl instead of the text — it is dereferenced ONLY through
// @jeswr/guarded-fetch: https-only, blocks private / loopback / link-local /
// cloud-metadata, DNS-pins, caps body + time, and does NOT follow redirects.
const report = await importCalendar({
  davUrl: "https://dav.example.com/calendars/alice/personal/",
  davAuth: { type: "basic", username: "alice", password: process.env.DAV_PASSWORD! },
  writeFetch: session.fetch,
  container: "https://alice.pod.example/imports/calendar/",
});
```

### The pure mappers (no network, no pod)

```ts
import { parseComponents, findComponents, veventToEvent, vcardToContact } from "@jeswr/solid-dav-bridge";

const roots = parseComponents(icsText);
for (const vevent of findComponents(roots, "VEVENT")) {
  const { quads, uid } = veventToEvent(vevent, { subject: "https://x.pod/e.ttl#it" });
  // quads is a typed schema:Event + ical:Vevent graph
}

const card = findComponents(parseComponents(vcfText), "VCARD")[0];
const { data } = vcardToContact(card); // a ContactData for @jeswr/solid-task-model's buildPerson
```

## API

| Export | What it does |
|---|---|
| `importCalendar(options)` | Read iCalendar VEVENTs (`icsText` or `davUrl`) → `schema:Event` resources under `options.container`. Per-item report. |
| `importAddressBook(options)` | Read vCards (`vcfText` or `davUrl`) → SolidOS `vcard:Individual` resources via `buildPerson`. Per-item report. |
| `veventToEvent(component, { subject })` | Pure: map one VEVENT to `schema:Event` quads (+ `ical:rrule`, `ical:Vevent`). |
| `vcardToContact(component, { inAddressBook? })` | Pure: map one vCard to `ContactData`. |
| `fetchDav(url, options?)` | Optional: GET / REPORT a DAV endpoint through the SSRF guard; returns the raw text. |
| `parseComponents` / `findComponents` / `getProperty` / `unfoldLines` / `parseContentLine` | The RFC 5545/6350 content-line parser. |
| `parseICalDate(raw, isDate?)` | iCal DATE / DATE-TIME → an `{ value, datatype }` RDF literal. |
| `defaultEventSlug` / `defaultContactSlug` | Stable, UID-derived resource-name functions (override via `options.slug`). |
| `DavFetchError` | Thrown by `fetchDav` on a non-2xx / over-cap response (never carries the credential). |
| `isHttpIri` | The http(s)-only IRI filter. |

### Import options (shared)

| Option | Default | Meaning |
|---|---|---|
| `writeFetch` | `globalThis.fetch` | The authed fetch used to PUT each resource. **Pass your DPoP/WebID fetch.** |
| `container` | *(required)* | The owner-private container each resource is written under. |
| `icsText` / `vcfText` | — | Already-fetched source text (the unit-testable path; no network). |
| `davUrl` | — | A DAV endpoint to read from, dereferenced through the SSRF guard. |
| `davAuth` | — | `{ type: "basic", username, password }` or `{ type: "bearer", token }`. **Never logged / URL-embedded.** |
| `inAddressBook` (contacts) | — | `vcard:inAddressBook` back-link written on each imported person. |
| `slug` | UID-derived | Resource-name function; the default is **stable per source UID** (idempotent re-sync). |
| `maxItems` | unbounded | Cap items imported (bound a hostile/huge file). |
| `continueOnError` | `false` | `false` = fail-closed (stop on first error); `true` = record + continue. |
| `conditional` | `"overwrite"` | PUT condition — `"overwrite"`, `"if-none-match"` (create-only), `"none"`. |

## Security & privacy

This package writes **third-party data into the user's pod**, so its security posture
is load-bearing:

- **Owner-only by default — never auto-shares.** `importCalendar` / `importAddressBook`
  **never write an ACL/ACR** and never broaden access. The effective access of each
  written resource is whatever the **target container** grants, so you **must** pass a
  container that is already **owner-private** (a freshly-provisioned private container
  inherits owner-only access). This package will not, and cannot, make imported data
  public. (Tested: no `.acl`/`.acr` write, no `acl:agentClass`/`foaf:Agent` in any body.)
- **SSRF-safe DAV fetch.** A user-configured DAV URL is attacker-influenceable;
  `fetchDav` dereferences it **only** through
  [`@jeswr/guarded-fetch`](https://github.com/jeswr/guarded-fetch) — https-only, no
  userinfo, blocks private / loopback / link-local / cloud-metadata addresses, DNS-pins
  (closing the lookup→connect rebinding window via the `./node` entry), caps response
  size + time, and **does not follow redirects** (so the `Authorization` header cannot
  leak to another origin).
- **DAV credentials are never exposed.** A Basic / Bearer credential is turned into an
  `Authorization` header only — it is **never logged**, **never placed in a URL**, and
  **never re-sent cross-origin** (no redirect-follow). `DavFetchError` messages carry
  only the URL + status. (Tested: the password never appears in the error or the URL.)
- **Untrusted-input hardened.** Imported DAV data is untrusted: an unparseable date
  drops **that** field (never aborts the event); a `javascript:` / `mailto:` / `urn:` /
  bare-string value in an IRI field is **dropped**, never coerced; a malformed email /
  phone is dropped; a missing required field yields a placeholder rather than a throw; a
  malformed line / unterminated component is skipped. The whole import never aborts on
  one bad entry. (Tested with hostile fixtures.)
- **No hand-built RDF.** Events are emitted as typed `n3` quads + `n3.Writer`; contacts
  go through `@jeswr/solid-task-model`'s `buildPerson` typed accessors. This package
  builds no triples by string concatenation. The RFC 5545/6350 **content-line** parser
  is in-house (small + exhaustively tested) — it parses only the line/property/param
  grammar this bridge needs and keeps the committed `dist/` self-contained; it is **not**
  a bespoke RDF parser (RDF read/write goes through the suite libraries).

## Re-sync & edits

The default slug is **stable per source `UID`**, so re-importing the same calendar /
address book **overwrites the same resource** rather than duplicating — and with
`conditional: "overwrite"` (the default) a source **edit** is reflected on re-sync.
Phase-1 is **read/import-only**: write-back to the DAV server, CalDAV
`sync-collection`/`ctag` incremental sync, deletes, and full RRULE expansion are
follow-ups (see below).

## Follow-ups

- **Live DAV credentials for go-live** are a `needs:user` item (the bridge is built +
  tested against fixtures + injected fetches; a real CalDAV/CardDAV server account is
  needed to exercise it end-to-end).
- **Phase 2: write-back** to the DAV server (two-way sync).
- **CalDAV `sync-collection` / `ctag` incremental sync** (only fetch what changed).
- **Full RRULE expansion** (materialise recurring instances) — would likely justify
  `ical.js` (esbuild-inlined into `dist/`) at that point.
- **`ContactData` has no `ORG` field** — vCard `ORG` is currently folded into the
  contact `note`. An `organization` field on `@jeswr/solid-task-model`'s `ContactData`
  (mapped to `vcard:organization-name`) would carry it losslessly; flagged to upstream.

## How it fits the suite

This is OSS-integration target #10 — a bridge from the entire CalDAV/CardDAV installed
base (iCloud, Google, Fastmail, Nextcloud, Radicale, SOGo, …) into a user's pod, as the
suite's `schema:Event` + SolidOS `vcard:AddressBook` models. It composes the suite
keystones: [`@jeswr/solid-task-model`](https://github.com/jeswr/solid-task-model) (the
contacts model + serialisers), [`@jeswr/guarded-fetch`](https://github.com/jeswr/guarded-fetch)
(SSRF), and [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf) (RDF parse, via the
task-model).

## License

MIT

[RFC 4791]: https://www.rfc-editor.org/rfc/rfc4791
[RFC 5545]: https://www.rfc-editor.org/rfc/rfc5545
[RFC 6350]: https://www.rfc-editor.org/rfc/rfc6350
[RFC 6352]: https://www.rfc-editor.org/rfc/rfc6352
