<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/pod-connectors

> Experimental — AI-agent-generated. Security-critical; private until conformance is gate-green.

Source API and export-file adapters extracted with history from Pod Manager. The default
catalog is unconfigured and uses recorded fixtures for demos. No environment variables are
read by this package: the host injects public OAuth client ids and token proxy URLs.

```ts
import { createRegistry, createFetchPodWriter, runImport } from '@jeswr/pod-connectors';

const registry = createRegistry({ spotify: { clientId: 'public-client-id' } });
const adapter = registry.adapterById('spotify')!;
const report = await runImport({
  adapter,
  mode: 'demo',
  podWriter: createFetchPodWriter({
    adapterId: adapter.metadata.id,
    webId,
    podRoot,
    fetch: authenticatedPodFetch,
  }),
});
```

Live imports take `sourceAuth: { fetch: authenticatedSourceFetch }`. The optional
`createSourceAuth(id, adapter, token, sourceFetch)` helper adds bearer and adapter headers.
Keep Pod and source transports separate. Tokens stay in memory. A `PodWriter` binds a
connector container, resolves and reads slugs, writes RDF with `{ ifMatch }` or
`{ ifNoneMatch: '*' }`, and registers Type Index entries. The fetch-backed implementation
keeps the existing deterministic document paths and Type Index bootstrap behavior.

Entry points:

- `.`: contracts, runners, catalog, config factory, fetch-backed writer, errors.
- `./oauth`: browser PKCE helpers and popup flow (only `authorize` touches `window`).
- `./node`: host-neutral runtime primitives; CLI implementation belongs to CON-03.
- `./testing`: recorded fixture fetch, memory Pod and import helpers; recorder belongs to CON-02.
- `./adapters/<id>`: each source's existing adapter (OAuth or export-file).
- `./core/*`, `./pod/*`, `./<id>/*`, `./registry`, `./types`, `./file-adapters`:
  compatibility modules used by Pod Manager's thin re-export shims.

`pnpm --filter @jeswr/pod-connectors build` builds ESM and declarations. `test` runs all
moved fixture tests and the environment-read regression test without production traffic.
