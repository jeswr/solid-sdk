# Solid Issues

An issue tracker where the data lives in **your own Solid Pod**, not a central
server. Sign in with your WebID; issues are read and written over authenticated
HTTP to a single document in your pod.

Built following the [`solid-ai-coding`](https://github.com/jeswr/solid-ai-coding)
guide (`AGENTS.md`).

## Stack

| Concern | Library |
|---|---|
| Browser auth (patched `fetch`, DPoP) | `@solid/reactive-authentication` + the issuer-from-profile `WebIdDPoPTokenProvider` (`src/lib/`) |
| Fetch + parse RDF | `@jeswr/fetch-rdf` |
| Typed Solid data access | `@solid/object` |
| Typed RDF wrappers (`Issue`, `Tracker`) | `@rdfjs/wrapper` |
| RDF terms / Turtle | `n3` |
| UI | Next.js (App Router) · Tailwind · shadcn/ui · react-hook-form + zod · sonner |

## Data model

Issues use the **W3C workflow ontology** `wf:`
(`http://www.w3.org/2005/01/wf/flow#`) + Dublin Core Terms — the SolidOS
issue-pane model, so the data interoperates with the wider ecosystem. State is
carried by `rdf:type` (`wf:Open` / `wf:Closed`). Rationale and the full mapping:
[`decisions/0001-issue-tracker-vocabulary.md`](./decisions/0001-issue-tracker-vocabulary.md).

One document per pod holds the tracker config + all issues
(`<pod>/issue-tracker/issues.ttl`); writes are conditional `PUT`s (`If-Match`) so
a concurrent edit surfaces as a recoverable conflict rather than silent data loss.

## Sharing & cross-pod (milestone 2)

- **Share** a tracker with another person by WebID (view or edit) — managed via
  Web Access Control, with ACP (Inrupt ESS) supported through the access-control
  converters. The owner always keeps control (fail-closed).
- **Discovery**: the tracker is registered in your **public type index** so others
  can find it; `resolveTracker(webId)` falls back to the conventional pod path.
- **Open another pod's tracker** by WebID; read-only access is detected from the
  `WAC-Allow` header and the UI adapts.
- See [`decisions/0002-sharing-and-discovery.md`](./decisions/0002-sharing-and-discovery.md).

## Develop

```sh
npm install
npm run dev      # in-memory CSS on :3000, seeds alice/bob + prints creds, app on :3200
```

Open http://localhost:3200 and sign in with the printed WebID.

> **Port note:** the dev script and tests default to CSS on `:3000` (per the
> guide). If `:3000` is occupied, override the test port — the app uses an
> issuer-from-profile auth provider, so it is not tied to `:3000`:
> ```sh
> IT_CSS_PORT=3100 IT_CSS_BASE=http://localhost:3100 npm run test:e2e
> ```

## Test

```sh
npm run typecheck   # tsc --noEmit
npm test            # Vitest — data layer unit/integration (src/lib)
npm run test:e2e    # Playwright — golden path against a real local CSS (popup login)
npm run build       # next build
```

## Roadmap (future)

Priority/labels (`wf:issueCategory`), comments (`wf:message`), per-issue ACLs,
assignee groups (`vcard:Group`), and a published SHACL shape.
