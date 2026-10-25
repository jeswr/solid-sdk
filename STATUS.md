<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-9skv — SKL-01 lane report

Consolidated the requested 14 existing + 6 additional skills under `skills/`.
The 14 package-local skills remain unchanged. Detailed source guidance and companion
examples are preserved; the existing condensed text appears in `## Quick reference`.
The longest top-level SKILL.md is 376 lines; all quick references are at most 40 lines.
`beads-tracking` and `roborev-review` have `metadata.internal: true`.

## Commits

- `1b7b510f` — `docs: restore detailed cross-cutting skills`: restore the eleven
  existing skills with detailed counterparts, their companion examples, and linked
  authentication lifecycle references; rebase imported package/app paths.
- `47523a86` — `docs: complete the consolidated skill inventory`: add `solid-app-shell`,
  `solid-offline`, `solid-auth`, `solid-conformance`, `solid-rdf`, and `solid-wac`;
  retain the optimistic UI entry point, mark the internal workflows, and record
  conservative interpretations in [QUESTIONS.md](QUESTIONS.md).
- `dd23dbb4` — `docs: trim the offline source note`: remove an extra trailing blank
  line found by the final whitespace check.
- Final commit (this report) — `docs: record skill consolidation validation`.

All commits use the requested identity, unsigned Conventional Commit subjects, and
`Co-Authored-By: GPT-6.1-Sol (Codex) <noreply@openai.com>` trailer.

## Verification

| Exact command | Result |
| --- | --- |
| `pnpm run lint:root` | PASS: Biome, lockfile transport, app workspace guard, and notification fetch guard. |
| `TURBO_SCM_BASE=61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4 pnpm run gate` | PASS: affected scope is the workspace root; 2 test files / 26 tests pass. |
| `pnpm run gate:full` | FAIL: unchanged `@jeswr/unstorage-solid#build` hits `EROFS` opening the npm cache under `/home/runner/.npm/_cacache/tmp/`. Turbo stops: 4 successful / 28 scheduled tasks, 1 cached. |
| `python3 /tmp/validate-sst9skv.py` | PASS: YAML, matching names, descriptions beginning “Use when” and ≤1024 characters, ≤500 total lines for all 34 skills; ≤40-line quick references and internal metadata for all 20 top-level skills; 99 local Markdown links resolve; no absolute user paths or NUL bytes in consolidated Markdown. |
| `for d in skills/*; do python3 /home/runner/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d" || exit; done` | PASS: all 20 top-level skills. |
| `git diff --check 61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4` | PASS. |

The temporary audit compares every non-empty paragraph from all selected detailed
SKILL.md files, all eleven companions, and the fourteen existing condensed skills
against the consolidated documents: **1,014 paragraphs preserved**. It normalizes only
Markdown headings/emphasis/whitespace, rebased link targets, the escaped NUL separator,
and the workspace spelling of the session-restore install command. The offline source's
superseded availability paragraph is retained in its linked historical reference.
The section-by-section checklist below gives the committed locations independently
of the temporary audit script. No validator/index/sync implementation is added here;
those belong to SKL-03/SKL-04.

No package or app implementation was changed, so per-package lint/build/typecheck/test
commands are not applicable. No dependency or manifest/lockfile changes were made;
`pnpm run check:packages <name>` is **not applicable** (no added dependency).
The imported companion code is documentation, not an additional executable test suite;
no companion harness was run and no real accounts or production services were tested.

## Verification limits and open questions

The full gate's existing `packages/unstorage-solid/scripts/build-deps.mjs` cloned
`fetch-rdf` from GitHub into a temporary directory before its `npm install --ignore-scripts`
failed on the read-only cache. The helper removed that temporary clone in its `finally`
block. This indirect remote clone conflicts with the lane's no-remote-fetch rule;
the helper should have been inspected before running the full gate. The full gate was
not retried or changed to work around it. Its failure is outside this documentation diff;
full-workspace verification remains incomplete.

`roborev` is not installed (`command -v roborev` found no executable), so per-commit
automated review could not run. No tool was installed. The existing bead is not closed
by an implementation lane: the repository workflow closes on merge, and forbids tracker
commands from a worktree; this lane is restricted to its dedicated checkout.

[QUESTIONS.md](QUESTIONS.md) records the conservative interpretations. The only remaining
cross-lane design question is SKL-03's duplicate-name rule for the explicitly required
top-level and package-local `solid-offline` skills. Both stay in place per D1–D2; the
package skill wins for API/security details, while the top-level skill keeps patterns.
No requested content work remains unfinished. `solid-lws`, proposal lessons, the index,
validation tooling, and skill sync remain assigned to their separate planning tasks.

## Source selection and preservation

Read-only snapshot root: `/home/runner/work/solid-sdk-lanes/_sources/skills/`.
Its `SOURCES.txt` identifies:

- `solid-ai-coding` — `c1d8611`, 2026-07-12 18:36:02 +0100 (13 detailed skills).
- `solid-agent-skills` — `e49ef94`, 2026-06-01 21:30:57 +0100 (auth, conformance, RDF).
- `installed-solid-wac/SKILL.md` — the dispatcher-selected newer WAC source; no commit
  identifier was supplied. It supersedes the repo copy, including the ACL-mint escalation
  section absent there.

The source `solid-agent-skills/LICENSE` is byte-identical to the repository's root MIT
LICENSE (Jesse Wright, 2026); its copyright and permission notice are retained there.
Existing source author markers and the accessible-links source metadata are preserved.
All newly created Markdown files carry the requested author marker.

No source snapshot or installed skill directory was modified. Literal NULs in the
offline source's separator gotcha are escaped as `\u0000`, retaining the same instruction
in reviewable text. Historical verification results and commit links remain historical;
they are not claims that those harnesses were rerun in this lane. Server paths and ADRs
are explicitly scoped to the original `prod-solid-server` implementation, not invented
as SDK files. Code companions are fenced `references/*.md` documents with extraction
instructions and all their original code; relative Markdown links point to these copies.

## Source section checklist

Each checked item names an original section and its committed destination. Introductory
prose, tables, code blocks, and footnotes within each section are included in the paragraph
audit. Existing condensed bodies are preserved in Quick reference (headings demoted and,
where necessary, prose reflowed to meet 40 lines). Internal workflows have no detailed
counterpart in the snapshots, so their complete existing content is retained there.
`solid-optimistic-ui` links to the detailed `solid-app-shell` source without duplication.

### `skills/accessible-html-links/SKILL.md`

- [x] Write accessible links → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] Review checklist → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] Agent persona → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).

### `solid-ai-coding/accessible-html-links/SKILL.md`

- [x] Accessible HTML Links → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] The one rule → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] Markup anti-patterns to reject → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] Link text (WCAG 2.4.4 / 2.4.9) → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] `rel` and `target` on external links → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] First Rule of ARIA → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] Canonical corrected pattern → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] How to apply in reviews → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).
- [x] Specification references → [skills/accessible-html-links/SKILL.md](skills/accessible-html-links/SKILL.md).

### `skills/beads-tracking/SKILL.md`

- [x] Issue tracking with beads → [skills/beads-tracking/SKILL.md](skills/beads-tracking/SKILL.md).
- [x] Setup → [skills/beads-tracking/SKILL.md](skills/beads-tracking/SKILL.md).
- [x] Conventions → [skills/beads-tracking/SKILL.md](skills/beads-tracking/SKILL.md).
- [x] Autonomous drain → [skills/beads-tracking/SKILL.md](skills/beads-tracking/SKILL.md).
- [x] Agent persona → [skills/beads-tracking/SKILL.md](skills/beads-tracking/SKILL.md).

### `skills/roborev-review/SKILL.md`

- [x] Per-commit AI review with roborev → [skills/roborev-review/SKILL.md](skills/roborev-review/SKILL.md).
- [x] Setup → [skills/roborev-review/SKILL.md](skills/roborev-review/SKILL.md).
- [x] Operating discipline → [skills/roborev-review/SKILL.md](skills/roborev-review/SKILL.md).
- [x] Agent persona → [skills/roborev-review/SKILL.md](skills/roborev-review/SKILL.md).

### `solid-ai-coding/solid-app-shell/SKILL.md`

- [x] Cross-app interop on a shared pod — a consumer must map EVERY producer's `forClass` → [skills/solid-app-shell/references/interop-and-forms.md](skills/solid-app-shell/references/interop-and-forms.md).
- [x] A prebuild config generator must load `.env` itself — and resolve precedence PER-LAYER → [skills/solid-app-shell/references/interop-and-forms.md](skills/solid-app-shell/references/interop-and-forms.md).
- [x] Never call a throwing typed setter from a controlled input's `onChange` → [skills/solid-app-shell/references/interop-and-forms.md](skills/solid-app-shell/references/interop-and-forms.md).
- [x] Tailwind v4: a host app's UNLAYERED global rule out-ranks ALL your `@layer`'d utilities → [skills/solid-app-shell/references/chrome-integration.md](skills/solid-app-shell/references/chrome-integration.md).
- [x] Apply theme in an isomorphic layout effect, not a passive `useEffect`, to kill the first-frame flash → [skills/solid-app-shell/references/chrome-integration.md](skills/solid-app-shell/references/chrome-integration.md).
- [x] `@lit/react` drops a custom element's reactive PROPERTY under React 19 unless it reflects to an attribute → [skills/solid-app-shell/references/chrome-integration.md](skills/solid-app-shell/references/chrome-integration.md).
- [x] A shared chrome library that isolates COLOR but not the BOX MODEL: keep host element rules SCOPED → [skills/solid-app-shell/references/chrome-integration.md](skills/solid-app-shell/references/chrome-integration.md).
- [x] Consuming `@jeswr/app-shell` on a Tailwind-v4 app while keeping YOUR OWN palette → [skills/solid-app-shell/references/chrome-integration.md](skills/solid-app-shell/references/chrome-integration.md).
- [x] App shell — optimistic, non-blocking pod mutations → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).
- [x] Revert correctly — the two traps (both real review findings) → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).
- [x] Trap 1 — reverting the WHOLE record clobbers concurrent edits to other fields → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).
- [x] Trap 2 — a stale failed write clobbers a NEWER mutation of the same item → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).
- [x] Flush a debounced write on tab teardown — don't lose the last edit → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).
- [x] Indicator, no-ops, and reconciliation → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).
- [x] Reading a pod container into a view (the read side) → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).
- [x] Gotchas → [skills/solid-app-shell/SKILL.md](skills/solid-app-shell/SKILL.md).

### `solid-agent-skills/solid-auth/SKILL.md`

- [x] Solid auth (Solid-OIDC / DPoP / WebID verification) → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] When to use → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 Verify with oauth4webapi — never hand-roll → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 Asymmetric algorithms only → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 DPoP `jti` replay cache — fail-closed, checked early → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 Bidirectional WebID↔issuer check (defence vs issuer compromise) → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 SSRF guard + DNS pinning on profile fetch → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 Bound the fetch; no remote JSON-LD context → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 Claim hardening → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] 🔒 Realm preflight gate (boot-time, fail-closed) → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] Performance: two-tier WebID cache (not security, but in the brief) → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] Gotchas → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).
- [x] See also → [skills/solid-auth/SKILL.md](skills/solid-auth/SKILL.md).

### `skills/solid-client-id/SKILL.md`

- [x] Publish a Solid Client Identifier Document → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Required shape → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Rules → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Agent persona → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).

### `solid-ai-coding/solid-client-id/SKILL.md`

- [x] Solid static Client Identifier Document → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Why — static client_id vs dynamic registration → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] The document (verified template) → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Field requirements → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Hosting rules → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Next.js / Vercel hosting recipe (verified) → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Wiring into the bundled provider → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Where a static client id can — and cannot — work → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).
- [x] Gotchas → [skills/solid-client-id/SKILL.md](skills/solid-client-id/SKILL.md).

### `solid-agent-skills/solid-conformance/SKILL.md`

- [x] Solid conformance (CTH / EARL / Karate) → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] When to use → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] 🔒 The DPoP `ath` patch (the #1 blocker) → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] 🔒 Keycloak service-account wiring (DPoP-bound RFC 9068 tokens) → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] test-subjects.ttl: claim only what you implement → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] Reading the result (EARL) → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] Native HTTPS under concurrent load → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] CI gate (and what it excuses) → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] Local run → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] Harness-stability hardening (landed in this phase) → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] Gotchas → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).
- [x] See also → [skills/solid-conformance/SKILL.md](skills/solid-conformance/SKILL.md).

### `skills/solid-fetch-rdf/SKILL.md`

- [x] Read RDF with `@jeswr/fetch-rdf` → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Rules → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Agent persona → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).

### `solid-ai-coding/solid-fetch-rdf/SKILL.md`

- [x] @jeswr/fetch-rdf — fetch + parse Solid RDF → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] API surface (complete, v0.1.0) → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Usage → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] What this package does NOT do → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Writing to a pod location safely — the scope guard comes from a library, not a re-derivation → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Gotchas → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Receiver-side: parsing AS2 LDN notifications safely → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Receiver-side: trusting cross-pod claims (provenance) → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).
- [x] Consuming an external Hydra / TPF search index safely → [skills/solid-fetch-rdf/SKILL.md](skills/solid-fetch-rdf/SKILL.md).

### `skills/solid-notifications/SKILL.md`

- [x] Implement Solid live updates → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Modern protocol → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Legacy NSS → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Reliability rules → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Agent persona → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).

### `solid-ai-coding/solid-notifications/SKILL.md`

- [x] Solid notifications — live-sync over the pod → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Two worlds — branch by server → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Modern path — Solid Notifications Protocol → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] 1. Discover the subscription service (never hardcode) → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] 2. Subscribe — POST a JSON-LD channel request → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] 3. Listen → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Legacy path — NSS `wss://` → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Webhooks vs WebSockets → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Container semantics — the gotcha → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Reconnection & expiry → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Banned / avoid → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).
- [x] Cross-links → [skills/solid-notifications/SKILL.md](skills/solid-notifications/SKILL.md).

### `skills/solid-object/SKILL.md`

- [x] Read Solid RDF with `@solid/object` → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] Common wrappers → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] Rules for untrusted RDF → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] Agent persona → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).

### `solid-ai-coding/solid-object/SKILL.md`

- [x] @solid/object — typed wrappers for Solid data → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] What ships (v0.6.0) → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] Reading a profile → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] Rendering a profile — `ProfileAgent` reference class → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] Writing → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).
- [x] Gotchas → [skills/solid-object/SKILL.md](skills/solid-object/SKILL.md).

### `solid-ai-coding/solid-offline/SKILL.md`

- [x] Offline / instant-load — stale-while-revalidate from a WebID-scoped cache → [skills/solid-offline/SKILL.md](skills/solid-offline/SKILL.md).
- [x] The pattern → [skills/solid-offline/SKILL.md](skills/solid-offline/SKILL.md).
- [x] Security — the cache MUST be scoped to the authenticated WebID → [skills/solid-offline/SKILL.md](skills/solid-offline/SKILL.md).
- [x] Best-effort, never load-bearing → [skills/solid-offline/SKILL.md](skills/solid-offline/SKILL.md).
- [x] In-memory cache ≠ cold open — and the value must round-trip → [skills/solid-offline/SKILL.md](skills/solid-offline/SKILL.md).
- [x] Gotchas → [skills/solid-offline/SKILL.md](skills/solid-offline/SKILL.md).
- [x] Historical package-availability preamble → [skills/solid-offline/references/source-availability-note.md](skills/solid-offline/references/source-availability-note.md); current API authority links to the package skill.

### `skills/solid-optimistic-ui/SKILL.md`

- [x] Make pod mutations optimistic → [skills/solid-optimistic-ui/SKILL.md](skills/solid-optimistic-ui/SKILL.md).
- [x] Correct rollback → [skills/solid-optimistic-ui/SKILL.md](skills/solid-optimistic-ui/SKILL.md).
- [x] Persistence lifecycle → [skills/solid-optimistic-ui/SKILL.md](skills/solid-optimistic-ui/SKILL.md).
- [x] Agent persona → [skills/solid-optimistic-ui/SKILL.md](skills/solid-optimistic-ui/SKILL.md).

### `solid-agent-skills/solid-rdf/SKILL.md`

- [x] Solid RDF (Turtle / JSON-LD / N3.js / @rdfjs) → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] When to use → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] The model: byte-exact storage, convert on read → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] Parsing (`parseRdf`) → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] 🔒 SSRF-safe JSON-LD (security-critical — do not skip) → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] Serialising (`serializeRdf`) → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] 🏗️ House rule: build graphs with typed accessors, never hand-built triples → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] LDP container listing shape (what GET on a container returns) → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] SPARQL (PATCH engine) → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] Gotchas checklist → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).
- [x] See also → [skills/solid-rdf/SKILL.md](skills/solid-rdf/SKILL.md).

### `skills/solid-reactive-authentication/SKILL.md`

- [x] Maintain reactive-authentication integrations → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Load-bearing rules → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Agent persona → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).

### `solid-ai-coding/solid-reactive-authentication/SKILL.md`

- [x] Sessions, reloads, silent re-auth → [skills/solid-reactive-authentication/references/session-restore.md](skills/solid-reactive-authentication/references/session-restore.md).
- [x] Reload-restore: persist the DPoP refresh token, restore via a refresh grant → [skills/solid-reactive-authentication/references/session-restore.md](skills/solid-reactive-authentication/references/session-restore.md).
- [x] Silent session restore is a SHARED, AUDITED package — not a per-app copy → [skills/solid-reactive-authentication/references/session-restore.md](skills/solid-reactive-authentication/references/session-restore.md).
- [x] A restore must yield an AUTHENTICATED, refresh-capable fetch — not just a WebID → [skills/solid-reactive-authentication/references/session-restore.md](skills/solid-reactive-authentication/references/session-restore.md).
- [x] Token-endpoint client auth: EXACT-host gates + a FAIL-CLOSED auth-method selection → [skills/solid-reactive-authentication/references/client-auth-and-autologin.md](skills/solid-reactive-authentication/references/client-auth-and-autologin.md).
- [x] Deep-link autologin (`#autologin/<webid>` on load) — full-page redirect, enforce the WebID → [skills/solid-reactive-authentication/references/client-auth-and-autologin.md](skills/solid-reactive-authentication/references/client-auth-and-autologin.md).
- [x] Testing proactive refresh with fake timers → [skills/solid-reactive-authentication/references/login-lifecycle.md](skills/solid-reactive-authentication/references/login-lifecycle.md).
- [x] Detecting login: prove a per-attempt token, never infer from an HTTP status → [skills/solid-reactive-authentication/references/login-lifecycle.md](skills/solid-reactive-authentication/references/login-lifecycle.md).
- [x] Correlating the probe correctly — the re-wrap, CORS, and concurrency constraints → [skills/solid-reactive-authentication/references/login-lifecycle.md](skills/solid-reactive-authentication/references/login-lifecycle.md).
- [x] `reset()` / logout must generation-fence ALL in-flight async — re-checked AFTER every await → [skills/solid-reactive-authentication/references/login-lifecycle.md](skills/solid-reactive-authentication/references/login-lifecycle.md).
- [x] StrictMode: idempotent global patch + a module-level popup holder → [skills/solid-reactive-authentication/references/login-lifecycle.md](skills/solid-reactive-authentication/references/login-lifecycle.md).
- [x] Cross-account DPoP-token leak: a per-login `globalThis.fetch` patch with NO teardown reuses the PREVIOUS account's token → [skills/solid-reactive-authentication/references/login-lifecycle.md](skills/solid-reactive-authentication/references/login-lifecycle.md).
- [x] Foreign-origin fetch — the global patch upgrades-and-retries, so capture native `fetch` BEFORE `registerGlobally()` → [skills/solid-reactive-authentication/references/login-lifecycle.md](skills/solid-reactive-authentication/references/login-lifecycle.md).
- [x] Eliminating the per-resource 401-dance (proactive token attach) → [skills/solid-reactive-authentication/references/proactive-auth.md](skills/solid-reactive-authentication/references/proactive-auth.md).
- [x] Deterministic repro: the discovery-stage circular-await deadlock → [skills/solid-reactive-authentication/references/proactive-auth.md](skills/solid-reactive-authentication/references/proactive-auth.md).
- [x] The 401-budget Playwright test — assert the dance is gone AND can't creep back → [skills/solid-reactive-authentication/references/proactive-auth.md](skills/solid-reactive-authentication/references/proactive-auth.md).
- [x] @solid/reactive-authentication — auth via a patched fetch → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Published API (v0.1.2 — trust this over repo demos) → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Issuer resolution today → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] A dynamic-import-defined custom element is not upgraded at first mount — never eager-bind its methods → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] The login stack is a shared library, not a per-app fork → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] The WebID/DPoP token provider belongs in a LIBRARY, not copied per app → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Login consistency via a shared component → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Letting users pick their Solid server — behaviour spec + tested code → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Integrating Solid-OIDC DPoP into an auth framework (Auth.js / next-auth v5) → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).
- [x] Gotchas → [skills/solid-reactive-authentication/SKILL.md](skills/solid-reactive-authentication/SKILL.md).

### `skills/solid-scale-and-sharding/SKILL.md`

- [x] Design Solid document layout → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Sharding choices → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Discovery and queries → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Agent persona → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).

### `solid-ai-coding/solid-scale-and-sharding/SKILL.md`

- [x] Solid document layout, scale, and sharding → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Rule 1 — start with one document → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Rule 2 — reuse existing Solid data models before designing a layout → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] When you do split: shard along meaningful boundaries → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Finding data again: the Type Index → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Querying: keep expectations low → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Hard limits to design around → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).
- [x] Decision checklist → [skills/solid-scale-and-sharding/SKILL.md](skills/solid-scale-and-sharding/SKILL.md).

### `skills/solid-server-matrix/SKILL.md`

- [x] Diagnose Solid server differences → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] High-value differences → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] Detection workflow → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] Common diagnoses → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] Agent persona → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).

### `solid-ai-coding/solid-server-matrix/SKILL.md`

- [x] Solid server matrix → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] The implementations → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] Hosted providers (get-a-pod, June 2026 × [solid/catalog](https://github.com/solid/catalog) `catalog-data.ttl`) → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] Compatibility matrix → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] Runtime detection — what am I talking to? → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] "Where does this app's data live?" — decision tree → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).
- [x] Common misdiagnoses → [skills/solid-server-matrix/SKILL.md](skills/solid-server-matrix/SKILL.md).

### `skills/solid-test-infrastructure/SKILL.md`

- [x] Test Solid code against real protocol behavior → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Harness rules → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Non-vacuous security tests → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Agent persona → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).

### `solid-ai-coding/solid-test-infrastructure/SKILL.md`

- [x] Solid test infrastructure — build it before the features → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] The bundled harness (execution-verified) → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] The dev environment — seeded and ready to log in → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Patterns the harness enables → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Per-feature loop (the actual instruction) → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] PGlite-backed services — boot once per worker, reset between tests → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] ESM project (`"type": "module"`) — Playwright loads the config + setup files as ESM → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Node version — 25.1 breaks SSR/prerender via `localStorage` → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] jsdom + Radix UI — `fireEvent.pointerDown` never opens a dropdown → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Clearing a Dependabot backlog in a fork — range-scoped pnpm overrides → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).
- [x] Gotchas → [skills/solid-test-infrastructure/SKILL.md](skills/solid-test-infrastructure/SKILL.md).

### `skills/solid-type-index/SKILL.md`

- [x] Use the Solid Type Index → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Read → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Register → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Bootstrap missing indexes → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Search and security → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Agent persona → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).

### `solid-ai-coding/solid-type-index/SKILL.md`

- [x] Solid Type Index → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Vocabulary → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Read path: discover an index, then a class → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Convention, not enforcement — always fallback-and-create → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Create-and-link recipe (when an index is absent) → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Worked TermWrapper implementation → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Notes / caveats → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Type-Index-driven client-side pod search (no server FTS) → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Cross-references → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).
- [x] Could not verify → [skills/solid-type-index/SKILL.md](skills/solid-type-index/SKILL.md).

### `installed-solid-wac/SKILL.md`

- [x] Solid WAC (Web Access Control) → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] When to use → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] The four modes — one mapper is the authority → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] 🔒 `.acl` creation must be Control-gated on EVERY write verb (auxiliary-mint escalation) → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] 🔒 ACL resolution walk (own → ancestor → fail-closed) → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] 🔒 Rule matching + agentGroup fail-closed → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] 🔒 House rule: parse/author ACL via typed wrappers, defensively → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] 🔒 Reading ACLs fail-closed on transient errors → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] 401 vs 403 + WWW-Authenticate → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] WAC-Allow header → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] Gotchas → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).
- [x] See also → [skills/solid-wac/SKILL.md](skills/solid-wac/SKILL.md).

### `skills/web-seo/SKILL.md`

- [x] Improve web SEO honestly → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] Technical baseline → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] Entity structured data → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] Content and performance → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] Human follow-up → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] Agent persona → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).

### `solid-ai-coding/web-seo/SKILL.md`

- [x] web-seo — SEO for a modern personal / portfolio site → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] The one thing to internalize first (honesty rule) → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] 1. Crawlability & render — Googlebot must get full HTML → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] 2. Next.js App Router metadata (the legible layer) → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] 3. Structured data — the key ENTITY lever (JSON-LD) → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] Coexisting JSON-LD (SEO) with RDFa (a WebID/Linked-Data profile) → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] 4. Content & E-E-A-T → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] 5. Core Web Vitals (the performance gate; p75 of real users) → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] 6. Off-page (human actions — list as needs:user, never promise rank) → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] 7. Verify before claiming done → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).
- [x] Anti-patterns → [skills/web-seo/SKILL.md](skills/web-seo/SKILL.md).

### `solid-ai-coding/solid-object/profile-agent.ts`

- [x] Complete companion code and source comments → [skills/solid-object/references/profile-agent.ts.md](skills/solid-object/references/profile-agent.ts.md).

### `solid-ai-coding/solid-reactive-authentication/login-ux.test.ts`

- [x] Complete companion code and source comments → [skills/solid-reactive-authentication/references/login-ux.test.ts.md](skills/solid-reactive-authentication/references/login-ux.test.ts.md).

### `solid-ai-coding/solid-reactive-authentication/login-ux.ts`

- [x] Complete companion code and source comments → [skills/solid-reactive-authentication/references/login-ux.ts.md](skills/solid-reactive-authentication/references/login-ux.ts.md).

### `solid-ai-coding/solid-reactive-authentication/webid-token-provider.e2e.md`

- [x] `webid-token-provider.ts` — verification record → [skills/solid-reactive-authentication/references/webid-token-provider.e2e.md](skills/solid-reactive-authentication/references/webid-token-provider.e2e.md).
- [x] What was tested → [skills/solid-reactive-authentication/references/webid-token-provider.e2e.md](skills/solid-reactive-authentication/references/webid-token-provider.e2e.md).
- [x] What the test asserts (the real flow) → [skills/solid-reactive-authentication/references/webid-token-provider.e2e.md](skills/solid-reactive-authentication/references/webid-token-provider.e2e.md).
- [x] Result → [skills/solid-reactive-authentication/references/webid-token-provider.e2e.md](skills/solid-reactive-authentication/references/webid-token-provider.e2e.md).
- [x] Versions / date → [skills/solid-reactive-authentication/references/webid-token-provider.e2e.md](skills/solid-reactive-authentication/references/webid-token-provider.e2e.md).
- [x] Key decisions / friction → [skills/solid-reactive-authentication/references/webid-token-provider.e2e.md](skills/solid-reactive-authentication/references/webid-token-provider.e2e.md).
- [x] Addendum — static Client Identifier Document (`clientId` option) → [skills/solid-reactive-authentication/references/webid-token-provider.e2e.md](skills/solid-reactive-authentication/references/webid-token-provider.e2e.md).

### `solid-ai-coding/solid-reactive-authentication/webid-token-provider.test.ts`

- [x] Complete companion code and source comments → [skills/solid-reactive-authentication/references/webid-token-provider.test.ts.md](skills/solid-reactive-authentication/references/webid-token-provider.test.ts.md).

### `solid-ai-coding/solid-reactive-authentication/webid-token-provider.ts`

- [x] Complete companion code and source comments → [skills/solid-reactive-authentication/references/webid-token-provider.ts.md](skills/solid-reactive-authentication/references/webid-token-provider.ts.md).

### `solid-ai-coding/solid-test-infrastructure/css-account.ts`

- [x] Complete companion code and source comments → [skills/solid-test-infrastructure/references/css-account.ts.md](skills/solid-test-infrastructure/references/css-account.ts.md).

### `solid-ai-coding/solid-test-infrastructure/dev.mjs`

- [x] Complete companion code and source comments → [skills/solid-test-infrastructure/references/dev.mjs.md](skills/solid-test-infrastructure/references/dev.mjs.md).

### `solid-ai-coding/solid-test-infrastructure/feature.spec.example.ts`

- [x] Complete companion code and source comments → [skills/solid-test-infrastructure/references/feature.spec.example.ts.md](skills/solid-test-infrastructure/references/feature.spec.example.ts.md).

### `solid-ai-coding/solid-test-infrastructure/global-setup.ts`

- [x] Complete companion code and source comments → [skills/solid-test-infrastructure/references/global-setup.ts.md](skills/solid-test-infrastructure/references/global-setup.ts.md).

### `solid-ai-coding/solid-test-infrastructure/playwright.config.ts`

- [x] Complete companion code and source comments → [skills/solid-test-infrastructure/references/playwright.config.ts.md](skills/solid-test-infrastructure/references/playwright.config.ts.md).

### Package offline merge authority

- [x] The complete [package SKILL.md](packages/solid-offline/SKILL.md) stays unchanged:
  Page-client workflow; Security and correctness rules; Status and React integration;
  package/workspace gate guidance. The new top-level skill links to it from both its
  quick reference and detailed pattern introduction, with explicit API/security precedence.
- [x] The [app-shell package skill](packages/app-shell/SKILL.md) stays unchanged and is
  linked as component API authority by the new `solid-app-shell` pattern guide.
