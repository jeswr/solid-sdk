<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# Model provenance ledger

Everything in this repo was authored by **Claude Opus 4.8** (while Fable was unavailable), so it can
be targeted for re-review / upgrade when Fable returns. See the suite-wide rule in
`prod-solid-server/CLAUDE.md` → "Model provenance".

- **Commit trailers** on every commit: `Model: claude-opus-4-8`,
  `Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade candidate`, and
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **New source files** carry an `AUTHORED-BY Claude Opus 4.8` top-of-file marker.

| Artifact | Model | Notes |
|---|---|---|
| Initial repo scaffold (Vite + React + TS SPA under `web/`) | Claude Opus 4.8 | Cloned from the proven pod-drive recipe |
| Auth seam (`web/src/auth/**`) | Claude Opus 4.8 | Copied verbatim from pod-drive (preserves the hard-won invariants); app-store namespace keys + the FINDING-4 UI test adapted |
| Launch seam (`web/src/lib/launch.ts` + tests) | Claude Opus 4.8 | The token-free launch-URL builder with the exhaustive no-token suite |
| DCAT catalog generator (`web/scripts/gen-catalog.mjs` + test) | Claude Opus 4.8 | n3.Writer Turtle + jsonld JSON-LD from one quad array |
| UI (`web/src/App.tsx`, `web/src/components/**`, `web/src/styles.css`) | Claude Opus 4.8 | app-shell chrome + the catalog grid + the sign-in dialog + the LD catalog view |
| Catalog data (`web/data/apps.json`) | Claude Opus 4.8 | The 17-app inventory from the recon build spec |
| Repo meta (README, LICENSE, suite.json, CI, deploy docs) | Claude Opus 4.8 | The new-repo checklist |
