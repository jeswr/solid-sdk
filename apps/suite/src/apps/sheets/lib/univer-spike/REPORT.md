<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# SHT-L1: headless Univer feasibility

Measured 2026-10-25 on Node v24.22.1, pnpm 10.4.1, esbuild 0.28.1.

## Finding

Univer 1.2.0 can load and save a workbook headlessly in Node, without DOM
polyfills, React integration, hooks or network calls in the spike. The real
`UniverSheetsPlugin` is registered; `createUnit` loads a cloned snapshot and
`Workbook.save()` returns its state. `finally` disposes the instance. Synthetic
multi-sheet fixtures retain sheet order, formulas, cached values and styles
through repeated load/save cycles. Tests import the public `index.ts` barrel.

The measured headless browser bundle is below the Sheets spec's 2.5 MB gzip
fallback threshold. This does **not** establish the size or accessibility of a
complete browser editor. No engine decision is changed by this spike.

## Package policy and licence

All checks ran in full registry mode and passed before adding direct dependencies:

| Command suffix after `pnpm run check:packages` | Result |
| --- | --- |
| `@univerjs/core @univerjs/sheets` | PASS, both first published 1055 days ago |
| `rxjs esbuild @vitest/coverage-v8` | PASS, ages 5348 / 3255 / 1237 days |
| `@univerjs/engine-formula @univerjs/engine-render @univerjs/protocol @univerjs/rpc @univerjs/themes` | PASS, ages 1055 / 1055 / 969 / 1055 / 537 days |

Direct runtime packages are pinned to `@univerjs/core@1.2.0`,
`@univerjs/sheets@1.2.0` and their required peer `rxjs@7.8.2`.
`esbuild@0.28.1` and `@vitest/coverage-v8@4.1.10` are development tools, using
versions already present in the lockfile. Lifecycle scripts stay disabled.

The installed Univer manifests declare Apache-2.0, matching the
[release licence](https://github.com/dream-num/univer/blob/v1.2.0/LICENSE).
The measured dependency closure's manifest licences are Apache-2.0, MIT, ISC,
BSD-3-Clause and 0BSD. This is a manifest inventory, not a legal audit. No Pro
packages are installed. The upstream
[capability table](https://github.com/dream-num/univer/tree/v1.2.0#readme)
distinguishes OSS model/formula capabilities from optional commercial features;
this spike makes no claim about XLSX, collaboration or other Pro functionality.

## Reproduce and sizes

From the repository root:

```sh
pnpm --filter @jeswr/app-suite measure:univer
pnpm --filter @jeswr/app-suite test
```

The measurement script lives at `apps/suite/test/univer-spike.measure.mjs`.
It reports exact versions, per-package bytes, licences and the bundle import
count. Bundling keeps all public spike exports, including real engine loading;
it does not accidentally measure an unused/tree-shaken import. Configuration:
`bundle`, `minify`, `treeShaking`, `platform: browser`, `format: esm`,
`target: es2022`, `legalComments: none`, no externals, no source map. Gzip uses
Node zlib level 9. Output stays in memory; no generated bundle is committed.
This measures size only; production distribution must retain licence notices.

| Measurement | Bytes | Approximate size |
| --- | ---: | ---: |
| Minified browser ESM, whole spike barrel | 7,757,001 | 7.40 MiB |
| Same output, gzip level 9 | 1,689,651 | 1.61 MiB |
| Installed core package | 4,418,377 | 4.21 MiB |
| Installed sheets package | 4,816,619 | 4.59 MiB |
| Installed runtime dependency + required peer closure (61 packages) | 96,021,170 | 91.57 MiB |

The bundle has 985 input modules and zero external imports. No UI plugin,
editor stylesheet, locale catalogue, browser formula integration or application
shell is added. `sheets` still depends transitively on `engine-render` (28,476,371
unpacked bytes) and `engine-formula` (40,732,060 bytes); most install cost comes
from them. They are installed even though their plugins are not registered here.

Install size means the sum of regular file lengths in the unique installed
runtime dependency and required peer closure rooted at core/sheets/rxjs. It
includes their distributed CJS/ESM/types/maps and any declared runtime type
packages, excludes symlinks, nested node_modules and development dependencies,
and counts an existing shared dependency once. It is not incremental disk usage,
a pnpm store allocation, or compressed download size.

## Conversion contract and SHT-00 boundary

- `parseCsv` / `serializeCsv` support BOM input, LF/CRLF/CR records, escaped
  quotes, commas, multiline fields, Unicode, trailing empty fields and empty
  input. Malformed quoting throws `SyntaxError`. Output is canonical CRLF.
- `csvToWorkbook` creates ordered sheets and imports every field as an explicit
  Univer string cell. Leading zeroes, ISO dates and `=...` stay lexical text;
  import does not run formulas. Ragged rows are padded on export. At least one
  sheet with nonempty unique IDs is required, including safe prototype-like IDs.
- `workbookToCsv` projects the occupied sparse rectangle, padding holes and
  omitting unused grid capacity. It writes scalar values (including zero/false),
  cached formula results, and plain rich text with the final document CRLF
  removed. A formula with no cached value exports an empty field. Unknown sheets
  and invalid coordinates throw. CSV loses types, styles, merges, formulas and
  rich-text runs; the snapshot retains them.
- `inferColumns` treats the first row as headers and infers finite decimal
  numbers, valid ISO calendar dates, lowercase booleans or strings. It ignores
  blank values; empty/mixed columns and leading-zero identifiers stay strings.
  These are plain metadata inputs, not RDF statements or a final descriptor API.
- `workbookToStorage` produces `workbookJson` plus ordered sheet records with
  `sheets/<n>.csv` and `sheets/<n>.jsonld` paths (zero-based position), IDs, names,
  CSV and column projections. The full snapshot is authoritative.
  `storageToWorkbook` parses that snapshot and checks its derived sheet records
  against the supplied records, throwing on any divergence rather than silently
  overwriting formulas or styles. The projection is an in-memory hand-off, not
  a new persistent format. Inputs are typed workbook snapshots, not an untrusted
  JSON validation boundary; no arbitrary-size/resource-limit guarantee is made.

SHT-00's implementation is absent at base
`606c87b7edf73e83f118f95295b0eeda7abb6d92`; SHT-L1 depends only on DS-01.
`QUESTIONS.md` records the conservative interpretation: prove the snapshot/CSV/
column boundary now, then bind it to SHT-00's actual types on integration. This
lane does not invent its API or write `index.ttl`, JSON-LD/RDF statements, Type
Index registrations, If-Match operations or any I/O. The SHT-00 integration
therefore remains unverified.

## API stability and gaps

The imports use public package-root exports: `Univer`, `UniverInstanceType`,
`Workbook`, `IWorkbookData`, `CellValueType`, `LocaleType` and
`UniverSheetsPlugin`. No internal dependency-injection services or private paths
are used. Both Univer direct packages and transitive SDK packages use the same
1.2.0 release line. Keep them aligned when upgrading and rerun snapshot and CSV
round-trips; this spike only demonstrates the pinned release. Public declarations
still permit optional sheet names (the projection falls back to the sheet ID),
and the engine fills defaults during load/save, so arbitrary input JSON is not
expected to remain byte-identical.

[Upstream Node documentation](https://docs.univer.ai/guides/sheets/getting-started/node)
uses plugin mode and documents additional plugins for rendering infrastructure,
formula computation and number formats. This smaller spike tests load/save and
cached values only. Formula recalculation, command editing/onChange, number/date
format rendering, a lazy editor route, Yjs, XLSX, RDF persistence, grid a11y,
large-workbook performance and the complete editor's 2.5 MB budget are unmeasured.

The existing bead sst-fwm1 and SHT-00/SHT-01 integration work retain these gaps;
this report does not schedule extra features or select a fallback engine.
No UI is rendered, so screenshots, browser launch and axe scenarios do not apply.
