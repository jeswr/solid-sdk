# Model provenance

Standing rule while **Fable is unavailable**: everything authored by **Claude
Opus 4.8** is tagged so it can be targeted for re-review / upgrade when Fable
returns. Every source file carries an `AUTHORED-BY Claude Opus 4.8` marker; every
commit carries `Model: claude-opus-4-8` +
`Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade candidate` trailers.

## Ledger

| Artifact | Author | Origin | Notes |
| --- | --- | --- | --- |
| `src/protocol/**` (base64url, codec, constants, origin, types) | Claude Opus 4.8 | Ported from `jeswr/solid-webauthn` `packages/protocol` (jointly authored, Samu Lang + Jesse Wright) | Inlined into this repo so the package is self-contained / GitHub-installable (the source lived in a monorepo behind a workspace `*` dep). Added `isAllowedOrigin`. |
| `src/client/{TokenProvider,dpopBoundRequest,WebAuthnTokenExchange,WebAuthnTokenProvider}.ts` | Claude Opus 4.8 | Ported from `jeswr/solid-webauthn` `packages/client` (jointly authored, Samu Lang + Jesse Wright) | Re-auth flow reused logic-for-logic; imports rewired to the inlined protocol layer. |
| `src/client/registration.ts` | Claude Opus 4.8 | New | Extracted the app-side passkey registration ceremony from the monorepo demo (`packages/sample-app/app.js`) into a reusable, fail-closed, injectable-authed-fetch helper. |
| `test/**` | Claude Opus 4.8 | Ported + expanded from the monorepo's client + protocol tests | Added exhaustive registration + codec + origin coverage. |
| scaffold (`package.json`, tsconfig\*, biome, scripts, suite.json, README, DESIGN) | Claude Opus 4.8 | New | Mirrors the `@jeswr/solid-dpop` / `@jeswr/solid-session-restore` suite scaffold. |

The dual copyright (Samu Lang + Jesse Wright) and SPDX `MIT` headers are preserved
from the source files.
