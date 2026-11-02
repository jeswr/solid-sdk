<!-- AUTHORED-BY Claude Opus 5.5 -->

# Sheets engine: Univer behind an adapter (SHT-01)

Status: Accepted, 1 Nov 2026. Confirms the 25 Oct 2026 decision in
`specs/apps/07-parity-backlog.md` (Sheets) now that the full browser editor has been measured.

## Decision

The Sheets editor uses Univer 1.2.0 (`@univerjs/presets` + `@univerjs/preset-sheets-core`, the same
release line as the `@univerjs/core` and `@univerjs/sheets` pins the headless spike added). The app
never imports Univer outside `apps/suite/src/apps/sheets/lib/engine/`. Everything else talks to the
`SheetEngine` / `MountEngine` interfaces in `apps/suite/src/apps/sheets/lib/contract.ts`, and the
engine module is reached only through a dynamic `import()`, so Univer is a lazy chunk that only the
editor route downloads. The Sheets list, Drive and every other app never pay for it.

FortuneSheet stays the documented fallback. The spec made it the fallback only if the lazy editor
chunk exceeded 2.5 MB gzip. It does not, so the fallback is not taken.

## Measurement

Measured 1 Nov 2026 with esbuild 0.28.1 (`--bundle --minify --splitting --format=esm
--platform=browser --target=es2022`, React and React DOM external because the suite already ships
them), gzip level 9, on an entry that mounts `UniverSheetsCorePreset` with the en-US locale and
creates a workbook:

| What | Raw | Gzip |
| --- | ---: | ---: |
| Static closure of the editor entry (what the editor route loads) | 6.80 MB | 1.75 MB |
| Preset stylesheet (`@univerjs/preset-sheets-core/lib/index.css`) | | 24 KB |
| All chunks including on-demand ones | 11.76 MB | |

Without code splitting the same bundle is 2.77 MB gzip. The difference is Univer's hyphenation
dictionaries (one per language, up to 784 KB minified each), which `engine-render` loads with
dynamic imports only when text in that language needs hyphenating. Next.js's webpack build splits
them the same way, so they are not part of the editor's first load. Re-measure on every Univer
upgrade; if the static closure passes 2.5 MB gzip, revisit this ADR before upgrading.

## Licence

Every installed `@univerjs/*` package used here declares Apache-2.0, matching the upstream
`v1.2.0` LICENSE. The preset pulls only open-source packages (`ui`, `design`, `docs`, `docs-ui`,
`engine-render`, `engine-formula`, `sheets`, `sheets-ui`, `sheets-formula`, `sheets-formula-ui`,
`sheets-numfmt`, `sheets-numfmt-ui`, `network`, `rpc`, `drawing`, `icons`, `themes`, `telemetry`)
plus MIT/ISC/BSD dependencies. No Univer Pro package is installed, so XLSX import/export, live
collaboration and printing from Univer's commercial tier are not available; XLSX is a parity item to
solve separately (SheetJS or a small exporter over the snapshot). `pnpm run check:packages` passed
for `@univerjs/presets` and `@univerjs/preset-sheets-core`.

## Consequences

- The engine snapshot (`workbook.json`, Univer `IWorkbookData`) is the source of truth for formulas,
  formatting and sheet order. The per-sheet CSV and JSON-LD descriptor are derived on every save
  (ADR 0002) and never read back into the engine.
- Univer renders the grid to a canvas. Its keyboard navigation works, but screen-reader access to
  cell contents is limited; this is a known accessibility gap for the grid, while the suite chrome
  around it (title, menus, status, dialogs) must pass axe.
- Dark mode uses Univer's own dark theme toggled from the suite theme, not the suite tokens.
  Matching the suite palette exactly is a parity item.
- Upgrading Univer means moving all `@univerjs/*` pins together and rerunning the snapshot and CSV
  round-trip tests plus this measurement.
