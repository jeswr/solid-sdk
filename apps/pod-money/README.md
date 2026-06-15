# Pod Money

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

A personal-finance app for [Solid](https://solidproject.org/) pods. **Your accounts,
transactions, balances and holdings live in *your* pod, as plain RDF** — Pod Money is just a typed
lens over them, so any other Solid app can read or write the same data through the same vocabulary.

This repository is the **non-throwaway data-layer core**: a typed RDF model and a pod-shaped
read / write / list / discover layer. The full UI (a Next.js app scaffolded with `create-solid-app`),
the cross-server end-to-end matrix, and the coverage ratchet are tracked follow-ups (see below) —
the data layer here is the part that survives a UI rewrite.

## What it models

Pod Money's domain is built on the **finance sector ontology (FIBO-slim)** from
[`jeswr/full-solid-ecosystem`](https://github.com/jeswr/full-solid-ecosystem) — a gUFO-rebased
sector ontology that reuses [FIBO](https://spec.edmcouncil.org/fibo/) via a version-pinned slim
MIREOT module. The typed accessors cover:

| Concept | Class | Notes |
|---|---|---|
| Account | `fin:FinancialAccount` (+ Current / Savings / Credit / Investment sub-kinds) | status is a disjoint Phase partition: Active / Frozen / Closed |
| Transaction | `fin:Transaction` (+ Payment / CardPayment / Transfer event types) | money movement with amount, posting time, owning account, category, counterparty |
| Monetary amount | `fin:MonetaryAmount` | decimal value + ISO 4217 currency code |
| Balance | `fin:Balance` | point-in-time statement of an account's amount |
| Holding | `fin:Holding` | a position in a `fin:FinancialInstrument` within an investment account |
| Category | `pm:Category` | user-defined spending category (an app-local concept) |

### Interim namespace

The finance sector ontology currently publishes under the **placeholder base**
`https://TBD.example/solid/finance#`, pending the fse "namespace decision #2". Pod Money builds
against that interim IRI verbatim, with every term centralised in
[`src/vocab.ts`](src/vocab.ts) — so re-pointing the whole data layer once the namespace is frozen
is a one-line change. (Tracked: see the sector-vocab ADR follow-up.)

## The RDF stack — never a bespoke parser

Per the suite house rules, all RDF goes through the
[`jeswr/solid-ai-coding`](https://github.com/jeswr/solid-ai-coding) libraries:

- **`@jeswr/fetch-rdf`** — GET + content-type-dispatched parse (read), returning the dataset + ETag.
- **`@solid/object` / `@rdfjs/wrapper`** — typed `TermWrapper` / `DatasetWrapper` accessors; every
  read and write goes through the mapping helpers (`OptionalFrom`, `SetFrom`, `LiteralFrom`, …).
- **`n3.Writer`** — serialise the mutated dataset back to Turtle for a conditional `PUT`.

There is **no hand-built Turtle and no hand-concatenated triple** anywhere in `src/`.

## Pod shape

| Resource | Path (under the pod root) | Holds |
|---|---|---|
| Finance container | `finance/` | the app's data, registered in the type index |
| Ledger | `finance/ledger.ttl` | accounts + transactions + monetary amounts |
| Public type index | `settings/publicTypeIndex.ttl` | a `solid:TypeRegistration` for `fin:Transaction` → `finance/` so peers can discover the data |

Writes are **lost-update-safe**. A read reports both the resource ETag *and* whether the resource
existed, and `save` picks its precondition from that state: `If-Match: <etag>` for an update with a
validator; an **unconditional PUT** for an existing resource the server returned without an ETag
(degraded servers such as legacy NSS — sending a create precondition here would `412` forever);
and `If-None-Match: *` only for a genuine create. A `412` surfaces as a `PreconditionFailedError`
for the caller to re-read and retry.

## Usage

```ts
import { MoneyStore } from "pod-money";

const store = new MoneyStore({ podRoot: "https://alice.pod.example/" });
// (auth is the ambient globalThis.fetch patched by @solid/reactive-authentication)

await store.addAccount({ iri: store.ledgerUrl + "#everyday", kind: "Current", label: "Everyday" });
await store.addTransaction({
  iri: store.ledgerUrl + "#t-1",
  amountIri: store.ledgerUrl + "#amt-1",
  kind: "CardPayment",
  account: store.ledgerUrl + "#everyday",
  amount: -19.99,
  currency: "GBP",
  postingTime: new Date(),
});
await store.registerInTypeIndex();            // make the data discoverable

const accounts = await store.listAccounts();
const txns = await store.listTransactions();   // amounts resolved to { amount, currency }
const where = await store.discover(MoneyStore.primaryClass);  // type-index lookup
```

## Federation — registry-ready

Pod Money ships a [`public/clientid.jsonld`](public/clientid.jsonld) Client Identifier Document
that publishes the **`fedapp:` block** from [`https://w3id.org/jeswr/fed`](https://github.com/jeswr/solid-federation-vocab):
`fedapp:sector` = finance, with `fedapp:consumes` / `fedapp:produces` declaring the
`fin:Transaction` / `fin:FinancialAccount` / `fin:Balance` classes it works with. This lets a
data-federation registry reason about the app before any consent — **membership remains the
registry's job after a signed challenge; nothing here is self-asserted membership.** Regenerate the
document from the typed builder with `npm run build && node scripts/gen-clientid.mjs`.

## Develop

```bash
npm install          # ignore-scripts=true (supply-chain hardening)
npm run lint         # biome
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run coverage     # vitest --coverage (100% lines + functions on the data layer)
npm run build        # tsc -> dist/
npm run gate         # all of the above in order
```

## Tracked follow-ups

These are deliberately **not** in this run (the data layer is the durable core; the rest is tracked
work):

- **Next.js UI via `create-solid-app`.** The full app (login via `@solid/reactive-authentication`,
  account/transaction/budget views, force-static `clientid.jsonld` route) is scaffolded once
  `create-solid-app` lands in `full-solid-ecosystem`; do **not** hand-roll a throwaway Next.js app
  before then.
- **Cross-server E2E matrix.** Playwright against every well-known Solid server — CSS (WAC + ACP),
  ESS, NSS, and **prod-solid-server with both passkey and username/password login** — exercising
  read / write / list / type-index against a real pod.
- **Coverage ratchet.** A CI gate that asserts the cross-server matrix passes against all
  well-known servers and that the unit-coverage floor never regresses.
- **Sector-vocab ADR.** Decide and freeze the finance sector namespace (today the placeholder
  `https://TBD.example/solid/finance#`), then re-point `src/vocab.ts` and the `clientid.jsonld`
  fedapp block in one change.

## License

MIT.
