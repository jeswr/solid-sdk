# Pod Health

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

A personal-health **data layer** over a [Solid](https://solidproject.org) pod: typed RDF accessors
for health records, vital signs, conditions, medications, immunizations, and GPX workouts, on the
[full-solid-ecosystem](https://github.com/jeswr/full-solid-ecosystem) **health sector** ontology
(FHIR-aligned Mode A + QUDT units). One app in the parallel Solid suite (ADR-0013).

This package is the durable **core** — the part that survives a UI rewrite. It reads, writes, and
lists health data on a pod through the sanctioned Solid RDF toolchain, never a bespoke parser:

- [`@jeswr/fetch-rdf`](https://www.npmjs.com/package/@jeswr/fetch-rdf) — fetch + parse RDF off the pod.
- [`@solid/object`](https://www.npmjs.com/package/@solid/object) + [`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper) — typed accessors over the quads.
- [`n3`](https://www.npmjs.com/package/n3) `Writer` — serialise back to Turtle for a conditional `PUT`.

## What it models

The data layer is pod-shaped — entities live as sibling subjects in container resources, and the
app's primary class (`health:HealthRecord`) is registered in the user's Solid **type index** so
other apps can discover it.

| Surface | Module | Notes |
|---|---|---|
| Health records, observations/vitals (heart rate, steps, sleep), conditions, medication statements, immunizations, medicinal products, codeable concepts, instants | `src/model.ts` | `@rdfjs/wrapper` `TermWrapper` / `DatasetWrapper` typed accessors over the health sector ontology |
| GPX track → RDF workout + ordered route points (WGS84 geo) | `src/gpx.ts` | a small, self-contained GPX `<trkpt>` scanner (the XML envelope only — the RDF still flows through the typed accessors) |
| Turtle serialisation for writes | `src/serialise.ts` | `n3.Writer` with the project prefixes |
| Solid type-index read/write (discovery) | `src/type-index.ts` | registers `health:HealthRecord`; convention-only fallback-and-create |
| Pod I/O — `readHealth` / `writeHealth` (conditional `PUT` on the ETag) | `src/store.ts` | WAC-aware: a 401/403 surfaces as a typed `RdfFetchError` with `.status` — discovery is a hint, not a grant |
| The vocabulary (single home for every IRI) | `src/vocab.ts` | never hand-concatenate IRIs at a call site |

A federation-registry-ready Client Identifier Document lives at `public/clientid.jsonld`: it
publishes the `fedapp:` block from [`https://w3id.org/jeswr/fed`](https://github.com/jeswr/solid-federation-vocab)
(sector = health, the consumed/produced classes) alongside the Solid-OIDC client metadata.

## Namespace note (interim vocabulary)

The fse health sector ontology currently uses the **placeholder** base
`https://TBD.example/solid/health#`, pending fse "namespace decision #2". This data layer builds
against that interim IRI verbatim, isolated in `src/vocab.ts`, so a single edit re-points the whole
layer once the namespace is frozen. The `fedapp:` clientid block uses the already-frozen
`https://w3id.org/jeswr/fed#` vocabulary and the `https://w3id.org/jeswr/sectors/health#sector`
slug. See the tracked sector-vocab ADR follow-up.

## Usage

```ts
import { readHealth, writeHealth, gpxToWorkout } from "pod-health";

// Read a pod resource into a typed, mutable document.
const { document, etag } = await readHealth("https://carol.example/health/record.ttl");
for (const obs of document.observations) {
  console.log(obs.kind, obs.measuredValue, obs.unitCode);
}

// Mint + write a heart-rate vital sign back (conditional on the ETag).
const obs = document.mintObservation("https://carol.example/health/hr-2", "HeartRate");
obs.patient = "https://carol.example/profile/card#me";
obs.measuredValue = 72;
obs.unitCode = "/min";
await writeHealth("https://carol.example/health/record.ttl", document, { etag });

// Parse a GPX track into a typed workout with an ordered route.
const { workout } = gpxToWorkout(gpxString, {
  workoutIri: "https://carol.example/health/workouts/run1",
  activityType: "Run",
});
```

Authentication is the caller's concern: pass no `fetch` and
[`@solid/reactive-authentication`](https://www.npmjs.com/package/@solid/reactive-authentication)
patches `globalThis.fetch`, or pass an authenticated `fetch` explicitly.

## Gate

```bash
npm run gate   # lint (Biome) + typecheck (tsc) + coverage (vitest, ~100%) + build (tsc)
```

The data layer is held to ~100% unit coverage (lines / functions / statements 100 %, branches
≥ 95 %; one provably-unreachable defensive `n3.Writer` error branch is the only gap).

## Tracked follow-ups (deliberately not in this core)

- **Next.js UI + pages** — scaffolded with `create-solid-app` once it lands (the suite-wide
  bootstrap); a throwaway hand-rolled Next.js app is deliberately avoided here.
- **Cross-server E2E matrix** — Playwright against the well-known Solid servers, including
  prod-solid-server with **passkey** and **user/password** login (plus CSS WAC/ACP, ESS, NSS).
- **100 %-coverage ratchet** — a CI gate that ratchets coverage against every well-known server so
  it can never regress.
- **Sector-vocab ADR** — freeze the health sector namespace (fse decision #2) and migrate the
  app-local `ph:` workout/route terms upstream into the health sector ontology where appropriate.

## Provenance

Authored by **Claude Opus 4.8** (Fable unavailable) — a re-review / upgrade candidate. See commit
trailers and the `AUTHORED-BY` markers on each source file.

## License

MIT
