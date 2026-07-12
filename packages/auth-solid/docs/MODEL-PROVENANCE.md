# Model provenance — `@jeswr/auth-solid`

Standing rule while Fable is unavailable: every artifact in this repo is authored by **Claude Opus
4.8** and tagged so it can be targeted for re-review / upgrade when Fable returns.

- **Commit trailers** on every commit: `Model: claude-opus-4-8`,
  `Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade candidate`,
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **New source files** carry an `AUTHORED-BY Claude Opus 4.8` top-of-file marker.

## Ledger

| Artifact | Description | Author |
|---|---|---|
| `src/provider.ts` | `Solid(config)` factory → Auth.js `OIDCConfig<SolidProfile>` (checks/scope/profile/account/customFetch) | Opus 4.8 |
| `src/dpopFetch.ts` | DPoP HTTP seam — token-leg customFetch + `solidDpopFetch` pod fetch, transport guards, §8 nonce retry | Opus 4.8 |
| `src/session.ts` | jwt/session persistence helpers (`persistSolidTokensIntoJwt`, `extractSolidAuthState`) | Opus 4.8 |
| `src/types.ts` | public types (`SolidProviderConfig`, `SolidProfile`, `SolidAuthState`, …) | Opus 4.8 |
| `src/index.ts` | public API barrel | Opus 4.8 |
| `test/*.test.ts`, `test/mockOp.ts` | vitest suite + faithful Map-backed mock OP (real DPoP-proof verification) | Opus 4.8 |
| `scripts/*.mjs` | build-dist (esbuild, inline solid-dpop) / check-dist-fresh / check-lockfile-transport | Opus 4.8 |
