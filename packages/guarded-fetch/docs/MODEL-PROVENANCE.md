# Model provenance ledger — `@jeswr/guarded-fetch`

While Fable is unavailable, everything in this repo is authored by **Claude Opus 4.8** and tagged so
it can be targeted for re-review / upgrade when Fable returns.

- **Commit trailers:** `Model: claude-opus-4-8`,
  `Provenance: Opus 4.8 (Fable unavailable) — re-review/upgrade candidate`,
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **New source files:** an `AUTHORED-BY Claude Opus 4.8` top-of-file marker.

| Artifact | Authored by | Notes |
|---|---|---|
| `src/addresses.ts` | Claude Opus 4.8 | IP classifier (ipaddr.js-backed policy) + browser-safe `classifyIpLiteral`; consolidated from 4 suite copies |
| `src/guard.ts` | Claude Opus 4.8 | the SSRF/DNS-rebinding policy core (default `.` entry, browser-safe) |
| `src/node.ts` | Claude Opus 4.8 | the undici DNS-pinning `./node` entry (full rebinding closure) |
| `src/index.ts` | Claude Opus 4.8 | public barrel |
| `test/**` | Claude Opus 4.8 | the characterization suite = the security audit artifact (191 tests), incl. the replace-vs-harden evidence (undici-rejects-`http.Agent`; our lookup pins like `request-filtering-agent`) |
| `scripts/**` | Claude Opus 4.8 | self-contained dist build + check:dist + check:lockfile-transport |
| docs / config | Claude Opus 4.8 | README (incl. the maintained-SSRF-library evaluation matrix + adopt-vs-custom decision), suite.json, api-extractor, biome, tsconfig |

Phase 1 deliverable: the consolidated library, characterized and proven behaviour-parity with the
four sources, plus the verified replace-vs-harden evaluation (README) answering "why not a maintained
SSRF library?" — adopt `ipaddr.js` for IP classification; keep a custom undici DNS-pinning connection
layer because no maintained SSRF filter targets the suite's native-`fetch`/undici path. The three
consumers are NOT yet rewired onto it (Phase 2, post-review).
