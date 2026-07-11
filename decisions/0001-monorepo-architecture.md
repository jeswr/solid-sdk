<!-- AUTHORED-BY Claude Fable 5 -->

# 0001 — Monorepo architecture: consolidate the @jeswr Solid SDK packages and the new Solid specifications into monorepos

> **This repo's founding ADR.** Imported verbatim (below the header) from
> `prod-solid-server/decisions/0022-solid-sdk-spec-monorepo.md` — the ADR of record — at
> Phase 0 (repo scaffold). Internal cross-references like "§7" refer to this document's own
> sections; references like `decisions/0015`/`0016` refer to prod-solid-server's decision
> log. This copy governs `jeswr/solid-sdk` (its sibling `jeswr/solid-specs` carries the same
> import as its own `decisions/0001`).

- **Status:** ACCEPTED (headline calls) — design confirmed 2026-07-11; the build is gated behind
  the two in-flight upstream-PR readability sweeps, then runs phased (Phase 0→2 are reversible and
  touch no consumer; archiving + npm-org publish stay `needs:user`).
- **Date:** 2026-07-11 (imported at Phase 0, 2026-07-11)
- **Author:** PSS agent (Claude Fable 5)
- **Maintainer decisions (confirmed 2026-07-11):**
  1. **Two monorepos** — `jeswr/solid-sdk` (packages) + `jeswr/solid-specs` (specs). ✅
  2. **Local mirror-publishes now** — proceed with procedurally-guarded local mirror publishing
     rather than waiting for CI billing; the no-flag-day `github:`-pin guarantee holds. ✅
  3. **Import the 8 hand-written model packages now, regenerate from the federation in place
     later** (one `federation-codegen` PR across all models). ✅
  - Remaining scope calls (§9) still default per the ADR's leans unless steered:
    `fetch-rdf` = maintainer-call (default: keep PR-lane/external for now); `create-solid-app` +
    `accountable-agent-runtime` = include as `tools/`; the merge-rule relaxation (path-disjoint
    package merges inside `solid-sdk`) = proposed, applied when reached.

## 1. Context — why consolidate

The suite has grown to ~40 reusable TypeScript packages and ~10 specification documents,
each in its own repo. Every one of those repos independently carries the new-repo checklist
(roborev hook + `.roborev.toml`, Biome + tsc + vitest gate, `ignore-scripts=true`,
`check-packages` guardrails, provenance trailers, `suite.json`), its own lockfile (each a
separate exposure to the #78 `git+ssh://` rewrite bug), its own `node_modules`, and its own
committed `dist/` that must be rebuilt in the same commit as any `src/` change. The costs are
now structural, not incidental:

- **Cross-package changes are O(N) commits + O(N) sha-repins.** A change to `guarded-fetch`
  ripples through every package that esbuild-inlines it: each needs a dep repin, a dist
  rebuild, a commit, a roborev round — in N separate repos, in dependency order.
- **Convention drift.** The estate sweeps (2026-06/07) repeatedly found repos missing the
  lockfile-transport fix, lagging tsconfig/Biome settings, or with stale dist. The checklist
  is applied per-repo by hand; monorepos apply it once.
- **Disk + install duplication.** N repos × `node_modules` is the dominant disk sink (see the
  charter's disk-hygiene rule); a single pnpm workspace with a content-addressed store
  collapses that to one physical copy.
- **Estate-wide maintenance** (dependabot/security sweeps, Biome/tsc major bumps, Node
  target bumps) is currently N repo-visits; in a workspace it is one PR.
- The same applies to the specs: ReSpec boilerplate, Pages deploys, link-checkers, and the
  persistent-ID wiring are being re-set-up per spec repo.

The counter-pressure, honestly stated: the orchestration model in `AGENTS.md` treats **each
repo as an independent work-front** (parallel agents, one merge at a time per repo).
Consolidation narrows that parallelism to one repo's merge queue — §9 (risk 2) addresses this
head-on rather than pretending it away.

## 2. Inventory — every owned repo, categorised

Source: the `AGENTS.md` "Repositories — ownership, push policy" table (authoritative for
ownership + landing policy), cross-checked 2026-07-11 against `gh repo list jeswr --limit 200`
(200 repos returned). Counts below are of *repos*, not npm package names.

### 2a. Reusable SDK/library packages — the `solid-sdk` monorepo candidates (42 firm)

All are agent-created suite packages, direct-push, committed-`dist/`, GitHub-installable
(`github:jeswr/<repo>#<sha>`), npm publish deferred. Grouped by domain (grouping is
descriptive; the proposed layout is flat — §7):

| Domain | Repos | Count |
|---|---|---|
| Auth / client identity | `solid-dpop`, `solid-openid-client`, `solid-session-restore`, `solid-auth-core`, `solid-api-auth`, `auth-solid`, `solid-webauthn-reauth` | 7 |
| UI / components | `app-shell`, `solid-elements`, `solid-components` | 3 |
| Fetch / RDF plumbing | `guarded-fetch`, `rdf-serialize` | 2 |
| Federation | `federation-client`, `federation-registry`, `federation-trust`, `federation-codegen` | 4 |
| Agentic stack (M1–M4 + verifier + bridge) | `solid-agent-card`, `solid-a2a`, `solid-odrl`, `solid-vc`, `agent-authz-verifier`, `agentic-legacy-bridge` | 6 |
| Domain data models | `solid-task-model`, `solid-chat-interop`, `solid-bookmark`, `solid-drawing`, `solid-memory`, `solid-health-diary`, `solid-scheduling`, `solid-a11y-report` | 8 |
| Storage / sync adapters | `unstorage-solid`, `rxdb-solid`, `y-solid`, `solid-offline`, `solid-agent-notify` | 5 |
| Bridges / ingestion | `solid-dav-bridge`, `matrix-chat-to-pod`, `solid-granary`, `openclaw-memory-solid`, `solid-community-feeds` | 5 |
| Ecosystem integrations | `solid-mcp`, `n8n-nodes-solid` | 2 |
| **Total firm** | | **42** |

Three of these publish unscoped npm names (`solid-offline`, `solid-agent-notify`,
`n8n-nodes-solid` — the last a sanctioned exception to the `@jeswr/` scope rule); that is a
package-name property and does not affect monorepo placement.

**Borderline — include-on-steer (9 repos across 8 rows):**

| Repo | Why borderline | Lean |
|---|---|---|
| `accountable-agent-runtime` | Reference runtime / executable scenario, not a consumed lib; but it is package-shaped, sha-pins five sibling packages, and benefits most from `workspace:*` | include |
| `create-solid-app` | A scaffolder CLI whose templates embed app conventions; versioned on its own cadence | include (as `tools/`) |
| `solid-feedback-proxy` | A deployable serverless *service* (Vercel), not an installable lib | exclude (app-shaped) |
| `fetch-rdf` | **PR-lane repo** — the maintainer merges personally; also already npm-published (`@jeswr/fetch-rdf@0.1.0`) with external consumers | maintainer call (§9) |
| `reactive-fetch` | Overlaps upstream `@solid/reactive-authentication`; needs reconciliation before it's clear it survives as a package | reconcile first |
| `solid-profile-predicates` | Private; suite-shaped lib (WebID profile precedence) | include once public |
| `css-cached-storage` | A CommunitySolidServer plugin — upstream-facing, CSS peer-dep lifecycle | exclude for now |
| `google-takeout`, `fdc3-solid` | Private experiments, bridge-shaped | defer until public |

**Reconcile-first (unknown-purpose, no descriptions):** `solid-listening`,
`personal-agent`, `model-runtime`, `integrity`, `hash-federation` — recently pushed but not
in the ownership index with enough detail to place. Categorising them is a follow-up, not a
blocker. (`concept-hash` is deliberately NOT a candidate — the sibling *kern* research agent
builds on it; moving it requires cross-agent coordination per the sparq#1683 thread.)

**Standing caveat on the model packages:** the maintainer directive of 2026-07 is that domain
models should be *generated from the federation* (sector ontology + SHACL via
`federation-codegen`), with the hand-written model packages reconciled into generated ones.
The monorepo design anticipates this (§7 reserves a generated-code zone) rather than blocking
on it — importing the 8 model packages now and regenerating them in place later is strictly
easier inside one workspace (one codegen run = one PR across all models).

### 2b. Specifications — the `solid-specs` monorepo candidates (10 firm)

All agent-authored, direct-push (or publication-pending), ReSpec/HTML + Turtle + test-vector
artifacts, no npm consumers:

| Repo | Artifact |
|---|---|
| `lws-spec` | Clean-slate LWS re-write (experiment, ReSpec) |
| `dpop-sk-spec` | DPoP-SK PoP-negotiation profile (CG-draft ReSpec) |
| `solid-webauthn-reauth-spec` | Redirect-free WebAuthn re-auth editor's draft (now public) |
| `a2a-rdf-extension` | A2A RDF protocol-document extension (LF-A2A-shaped) |
| `agent-authz-credential-spec` | Agent Authorization Credential shape + verification |
| `accountability-framework-spec` | Accountability framework spec |
| `agentic-solid-note` | Umbrella informative CG Note (six-layer map) |
| `agentic-solid-conformance` | Golden conformance test-vectors + validator tooling |
| `solid-sparql-query` | Access-Controlled SPARQL Query design/spec (CG track) |
| `nl2rdf-upgrade-spec` | NL→RDF upgrade spec |

**Placement calls (2):**

- `solid-federation-vocab` — dual-natured: normative Turtle vocab **and** an npm-consumed
  constants package (`diet:` sector consumed by `solid-health-diary`, etc.). Because the
  normative IRIs are already decoupled from repo location by the persistent-ID layer
  (`jeswr.org/ns/*` — the PERSISTENT-ID RULE), placement should follow the *npm consumers*:
  **recommend `solid-sdk`** (`packages/federation-vocab`), with the human-readable vocab
  pages rendered from there.
- `spec-companion` (machine-readable normative-statement companion format) — spec tooling;
  **recommend `solid-specs`** under `tools/`.

**Spec-adjacent exclusions:** `lws-ucs` and `lws-protocol` are **forks** of W3C repos (must
track upstream and PR back — merging a fork into a monorepo severs that); `shaclc-1.2` is
pre-suite W3C-CG-track work with its own community lifecycle; `solid-webauthn` is the
maintainer's design monorepo (PR lane, not ours to move).

### 2c. NOT monorepo candidates — and why each category is excluded

| Category | Repos | Why excluded |
|---|---|---|
| **Deployed apps** (~21) | `solid-pod-manager`/`pod-manager`, `portfolio`, `solid-issues`, the 8 `pod-*` apps (`pod-music/drive/photos/money/health/docs/mail/chat`), `capnote`, `coeliac-app`, `solid-catalog`, `solid-launch`, `solid-drive`, `solid-app-store`, `solid-access-manager`, `solid-webid-index`, `solid-walkthrough` | Apps are *deploy targets*, not installable artifacts: each has its own Vercel/box deploy pipeline, env/secrets, release cadence, and (for several) its own `needs:user` go-live state. Monorepo-ing them couples unrelated deploys, breaks the per-app Vercel project mapping, and buys nothing — apps don't get sha-pinned by other code. They are the *consumers* of the SDK monorepo, which is why they must keep resolving `github:jeswr/<pkg>#<sha>` throughout (§5). |
| **Revenue products** (private) | `accessradar`, `keystone`, `furlong` | Same as apps, plus private + commercially distinct. |
| **The 5 OSS forks** | `elk`, `excalidraw`, `linkding`, `miniflux`, `actual` | Forks exist to track upstream and (eventually) PR back; a fork's value is its upstream remote + history graft. Squashing them into a monorepo permanently severs `git merge upstream/main`. |
| **All other upstream forks** | `N3.js`, `undici`, `node`, `comunica`, `object`, `wrapper`, `rdflib.js`, `CommunitySolidServer`, `conformance-test-harness`, `reactive-authentication-js`, `solid-client-authn-js`, `w3id.org`, `lws-protocol`, `lws-ucs`, … | Same reason, categorically. |
| **Rust track** | `solid-server-rs`, `solid-oidc-verifier` | Different toolchain (cargo, not npm), different consumer story (git/crates.io), and an explicit maintainer track of their own (RSS is SPARQ-integrated; a future cargo workspace is a separate decision for that track). |
| **Design-only repos** | `unite`, `agentic-solid-vision` (local-only), `pod-gtld-brief` | No build artifact, publication individually maintainer-gated; consolidation adds coupling to gated content. |
| **Infra / meta** | `suite-tracker` (beads data store), `solid-ai-coding` (skills source of truth with its own upstream role), `solid-agent-skills`, `full-solid-ecosystem` (multi-agent — not solely ours) | Not code artifacts, or not solely this agent's to move. |
| **Native SDKs** | `solid-swift`, `solid-kotlin`, `pod-passport-scanner`(-`android`) | Swift/Kotlin toolchains; each is already its own module-structured repo. A TS-workspace monorepo gives them nothing. |
| **Pre-suite personal npm libs** (~17) | `pretty-turtle`, `shaclc-writer`, `shaclcjs`, `shacl2shex`, `merge-shacl`, `rdfjs-sign`, `hylar-core`, `stream-to-string`, `promisify-event-emitter`, `json-split-transformer`, `rdf-transform.js`, `async-dataset`, `eventful-dataset`, `jsonld-fast-parse`, `vc-cli.js`, `utils`, `build-logic-statement-ts` | Predate the suite; already npm-published with external consumers, issues, and semver history under the *maintainer's* hand, not the agent's. Different lifecycle, no committed-dist convention, nothing to gain. |
| **Research / other agents' turf** | `kernel-of-truth` (kern), `concept-hash` (kern dependency), `hash-federation`, the ZK/`noir`/`sparql_noir`/`risc0` estate, `n3-*` private workspaces, `rdf-shuttle`, `spec` papers/TeX repos | Owned by, or load-bearing for, sibling agents/research tracks; moving them requires cross-agent coordination that is out of scope here. |
| **Transferred out** | `theodi/solid-browser-extension` | No longer in the `jeswr` namespace — not ours to consolidate. |

Everything in the 200-repo listing not named above falls into one of these categories
(demos, one-off reproductions, teaching material, private notes), none of which are
consolidation targets.

**Inventory summary: 42 firm SDK candidates (+9 borderline, +5 reconcile-first), 10 firm
spec candidates (+2 placement calls), everything else excluded with reasons.**

## 3. Decision 1 — one monorepo or two? → **Two**

**Recommendation: two repos — `jeswr/solid-sdk` (packages) and `jeswr/solid-specs`
(specifications).** Not one combined, not per-domain many.

| Option | For | Against |
|---|---|---|
| **(i) One combined repo** (`packages/` + `specs/`) | One checklist application; specs and the impls that satisfy them co-live | Artifact lifecycles are disjoint (npm/dist/changesets vs ReSpec/Pages/CG process); spec *community* traffic (issues, CG reviewers, LF-A2A submission reviewers) lands in a repo full of package CI noise; a CG/LF transfer of one spec means extracting from a repo that is mostly not spec content; `agentic-solid-conformance`'s vectors are deliberately *extracted from* impls to stay independent — co-housing them weakens that independence claim |
| **(ii) Two repos: `solid-sdk` + `solid-specs`** | Each repo is internally homogeneous — one toolchain, one CI shape, one review audience; spec repos stay small, public-facing, and individually transferable (subtree-split) when a CG adopts one; the SDK repo's clone/CI stays package-only | Two checklists to maintain instead of one (still 40× better than today); cross-references between a spec and its impl become cross-repo links (they already are today) |
| **(iii) Many domain monorepos** (auth-sdk, agentic-sdk, models, …) | Smaller blast radius each | Recreates the O(N) problem at N≈6; cross-domain deps (everything inlines `guarded-fetch`; agentic composes auth) would *still* be git-pinned across repos, which is the main pain being removed |

Rationale for (ii) over (i), beyond the table: the two artifact classes fail differently. A
package failure is a red gate; a spec "failure" is a normative-language or link regression —
different validators, different reviewers (roborev/codex for code; human CG readers for
specs). And the standardisation optics matter: a spec headed for the Solid CG or LF A2A reads
better from a focused specs repo than from inside a 40-package SDK. The persistent-ID layer
(`jeswr.org/spec/*`, `jeswr.org/ns/*`) already decouples every minted spec/vocab IRI from
repo location, so consolidating specs does not move any identifier — only the Pages hosting
path changes, behind the redirect layer.

## 4. Decision 2 — tooling

### 4.1 Package manager: **pnpm workspaces**

- The charter's disk-hygiene rule already states the preference: pnpm's content-addressed
  store hardlinks packages so worktrees/checkouts share one physical copy. In a 42-package
  workspace this is the difference between one store and 42 `node_modules` trees.
- `ignore-scripts=true` carries over (`.npmrc` in the workspace root); pnpm additionally
  does not run dependency lifecycle scripts by default in current majors, which *strengthens*
  the existing supply-chain posture rather than weakening it.
- Internal deps become `workspace:*`, which **eliminates the intra-suite `github:` sha-pin
  churn entirely** (the single largest recurring maintenance cost), and mostly eliminates
  git-dep entries from the lockfile — shrinking the #78 `git+ssh://` exposure surface. The
  `check:lockfile-transport` guard is retained, adapted to `pnpm-lock.yaml`, for the external
  git deps that remain until npm publish.
- npm workspaces rejected: no content-addressed store, and it is npm's installer that
  exhibits the #78 rewrite behaviour we keep having to guard against.

### 4.2 Build orchestrator: **none at first; Turborepo as the pre-approved escape hatch**

- Phase 1 runs on plain pnpm: `pnpm -r build` (topological), `pnpm -r test`, and diff-aware
  scoping via `pnpm --filter '...[origin/main]' <cmd>` (only changed packages + their
  dependents). The packages are small tsc/esbuild builds; start with zero new tooling and
  measure.
- If full-workspace wall-clock becomes a real drag on the gate loop, adopt **Turborepo**
  (local cache only, no remote cache): single-binary, config is one `turbo.json`, works under
  `ignore-scripts`, and is the smallest supply-chain increment that buys caching. **Nx
  rejected**: heavier footprint (daemon, plugin ecosystem, generators) than this workspace
  needs, and a larger dependency surface than the guardrails posture wants.
- Decision-rule rather than a timing promise: adopt the orchestrator when diff-aware
  filtering no longer keeps the routine gate scoped (e.g. a `guarded-fetch` change rebuilding
  most of the graph on every commit), not on a calendar.

### 4.3 Versioning + publishing: **changesets, independent versions — activated at npm-publish time**

- **Changesets** (`.changeset/` + `changeset version`/`publish`) with **independent
  per-package versions** — never lockstep; a `guarded-fetch` patch must not force-bump 40
  packages. Changesets is the pnpm-native default and its markdown-file model works fine
  while publishes are still deferred (the files simply accumulate intent until the
  `needs:user` npm login exists).
- Until npm publish is unblocked, "publishing" means the **mirror-repo pipeline** (§4.4/§5)
  — which is versioned by monorepo sha, not semver, exactly as consumers pin today.

### 4.4 The committed-dist / `ignore-scripts` / `github:`-install convention — the load-bearing constraint

Today every package repo commits `dist/` so that `npm install github:jeswr/<pkg>#<sha>`
works with no lifecycle scripts. **A plain monorepo breaks this**: npm cannot install a
subdirectory of a git repo — `github:jeswr/solid-sdk#sha` would install the workspace root,
not a package. (pnpm can install a git subdirectory via its `path:` selector, but the
consuming apps install with npm, so that is not a usable primary path.)

**Recommendation: per-package read-only mirror repos — the existing repos become the
publish target.** Concretely:

- The **monorepo stops committing `dist/`** (gitignored — removing the dist-drift/review-noise
  problem at the source). Source of truth is `packages/<name>/src` + its build config.
- A stdlib-only publish script (`scripts/mirror-publish.mjs <pkg>`) builds the package,
  assembles a clean tree — `package.json` (with `workspace:*` deps rewritten, see below),
  `dist/`, `README.md`, `LICENSE` — and commits it to the *existing* `jeswr/<pkg>` repo's
  `main` with a machine trailer: `Mirror-Of: jeswr/solid-sdk@<monorepo-sha>` plus the
  standard provenance trailers. The mirror README gains a banner: *"Read-only mirror,
  published from jeswr/solid-sdk — do not edit or PR here."*
- **Consumers keep working unchanged.** Every existing `github:jeswr/<pkg>#<sha>` pin in the
  ~15 consuming apps continues to resolve — old shas forever (the repos are never deleted),
  new shas whenever a mirror publish lands. Repointing consumers is *optional* until npm
  publish exists; there is no flag-day.
- **Workspace-dep rewriting at publish:** the suite's self-contained-dist convention already
  esbuild-inlines `@jeswr` deps into `dist/` for most packages — those mirrors carry no
  `@jeswr` deps at all. For the few packages that consume a *published* dep
  (e.g. `@jeswr/fetch-rdf@0.1.0` from npm), the manifest keeps the semver range. Any
  non-inlined internal dep is rewritten to `github:jeswr/<dep>#<that dep's latest mirror
  sha>` by the publish script (it publishes in topological order, so the dep's mirror sha
  exists first).
- **Integrity gate:** the publish script re-verifies before pushing — clean `git status`,
  gate-green at the monorepo sha, and (for the pilot) a byte-compare of the mirror `dist/`
  against a from-scratch rebuild, so a mirror can never carry hand-edits or a stale build.
  While CI is billing-blocked the script runs locally (same discipline as every other gate);
  when CI returns it becomes a workflow triggered on merged changes under `packages/<name>/`.

Alternatives considered and rejected for the primary path: **(a)** orphan "publish tags" in
the monorepo itself (`solid-dpop-v1.2.3` tags pointing at package-root-only trees — npm can
install these, but it changes every consumer's pin format *now* and is exotic to debug);
**(b)** pnpm `path:` git-subdir installs (pnpm-only — consumers use npm); **(c)** publishing
to npm immediately (blocked on the `needs:user` npm login, and this design must not gate on
it). The mirror model degrades gracefully *into* npm publishing: when the org login exists,
`changeset publish` takes over, mirrors get a final "superseded by npm" banner, and are
eventually archived (a `needs:user` account action).

## 5. Decision 3 — consumer migration without breakage

Consumers today: the app estate (Pod Manager, solid-issues, the 8 pod-apps, app-store,
capnote, coeliac-app, the 5 OSS forks, access-manager, the products…) pinning
`github:jeswr/<pkg>#<sha>`, plus package-to-package pins that move *inside* the workspace.

Phasing (see §8 for the full sequence):

1. **No consumer changes at all** during scaffold + import: existing pins point at existing
   repo shas, which are immutable and never deleted.
2. **After a package's mirror pipeline is live**, its repo history continues linearly — the
   next time a consumer would have bumped its pin anyway, the new sha is simply a
   mirror-published commit. Consumers repoint on their normal cadence; nothing forces a
   synchronous estate-wide repin.
3. **Cross-package pins collapse to `workspace:*`** inside the monorepo — that entire class
   of maintenance disappears internally.
4. **End-state (npm, `needs:user`):** once `@jeswr` npm publishing is unblocked, consumers
   migrate `github:jeswr/<pkg>#<sha>` → `^x.y.z` per-app on their own schedule (a mechanical
   sweep an agent can run per app). Mirrors freeze thereafter.
5. **Compatibility shim: none needed.** The mirror model *is* the shim — same repo names,
   same install spec format, same committed-dist semantics.

The one consumer-visible convention change: "the source of `@jeswr/<pkg>` is
`jeswr/solid-sdk`; the per-package repo is a generated mirror" — recorded in each mirror
README, the ownership index, and the suite skills that mention `github:` installs.

## 6. Decision 4 — git history: **preserve it (git-filter-repo import)**

Fresh-start is rejected: the per-package history carries the security-hardening record
(roborev rounds, adversarial-verify fixes with their rationale in commit messages) that the
charter's review discipline leans on — e.g. reconciling an old roborev finding against HEAD
requires the commit that fixed it to exist. History import is cheap and one-off.

Concrete recipe (per package, scripted as `scripts/import-package.sh`):

```bash
# 1. fresh clone (never the working checkout)
git clone --no-local https://github.com/jeswr/<pkg>.git /tmp/import-<pkg>
cd /tmp/import-<pkg>

# 2. rewrite into the subdirectory + namespace its tags
git filter-repo --to-subdirectory-filter packages/<pkg> --tag-rename '':'<pkg>/'

# 3. graft into the monorepo
cd <solid-sdk>
git remote add import-<pkg> /tmp/import-<pkg>
git fetch import-<pkg>
git merge --allow-unrelated-histories import-<pkg>/main \
  -m "import(<pkg>): graft jeswr/<pkg> history at <old-head-sha>"
git remote remove import-<pkg>

# 4. post-import commit: drop committed dist/, repoint @jeswr deps to workspace:*,
#    hook into root tsconfig/biome, delete per-repo boilerplate (own lockfile,
#    .roborev.toml, guardrails copies), keep the package README + AUTHORED-BY markers
```

Properties: `git log -- packages/<pkg>` shows full pre-import history; `git blame` works;
old tags survive namespaced (`<pkg>/v0.3.0`); the old repo (now mirror) retains its own
history too, so **every sha ever pinned by a consumer remains resolvable indefinitely**.
`git subtree add` was considered and rejected — it preserves history but `log --follow`
across the graft is weaker and tag namespacing is manual.

## 7. Decision 5 — repo layout + applying the conventions once

### 7.1 `jeswr/solid-sdk`

```
solid-sdk/
├── AGENTS.md                     # repo charter (CLAUDE.md → symlink), inherits suite rules
├── .roborev.toml                 # ONE reviewer config; roborev install-hook once —
│                                 #   worktrees share .git/hooks, so sub-agent commits covered
├── .npmrc                        # ignore-scripts=true (+ pnpm store settings)
├── pnpm-workspace.yaml           # packages/* , tools/*
├── pnpm-lock.yaml                # ONE lockfile (transport guard adapted to pnpm-lock)
├── package.json                  # root: lint / typecheck / test / build / gate / mirror-publish
├── tsconfig.base.json            # shared compiler baseline; per-package tsconfig extends
├── biome.json                    # one lint config
├── suite.json                    # self-report: one repo entry with a packages[] array
│                                 #   (3-ring registry aggregator gets a small follow-up to read it)
├── guardrails/                   # check-packages.mjs + package-policy.json — applied once
├── scripts/
│   ├── mirror-publish.mjs        # §4.4 — build → verify → push mirror (topological, stdlib-only)
│   ├── import-package.sh         # §6 recipe
│   └── maintenance/              # thin diff-aware gates (adapted new-package-completeness,
│                                 #   honesty gates; NOT PSS's LDP/storage gates)
├── .github/workflows/            # gate.yml + mirror-publish.yml (armed when CI billing returns)
├── packages/                     # FLAT — one dir per package, named exactly as the npm name
│   ├── solid-dpop/               #   (unscoped ones keep their unscoped name)
│   │   ├── package.json          #   deps: workspace:* internally; securityCritical flag kept
│   │   ├── src/                  #   AUTHORED-BY markers preserved from import
│   │   ├── test/
│   │   ├── tsconfig.json         #   extends ../../tsconfig.base.json
│   │   └── README.md             #   (dist/ is BUILT, not committed — mirrors carry it)
│   ├── guarded-fetch/
│   ├── … (42 total; models zone regenerates in place via federation-codegen later)
├── tools/
│   └── create-solid-app/         # if the borderline include is approved
└── decisions/                    # the monorepo's own ADRs (0001 = this design, imported)
```

Flat `packages/*` (not `packages/<domain>/<name>`): domain grouping is documentation (kept
as the §2a table in the repo AGENTS.md), while flat dirs keep import paths, mirror names,
`--filter` selectors, and the pnpm-workspace glob trivial, and avoid a second rename during
import.

**Conventions applied once instead of 42 times:** one roborev hook + config; one Biome +
tsc + vitest gate (`pnpm -r --filter '...[origin/main]'` for the scoped path, full run at
merge); one guardrails/check-packages policy; one lockfile-transport guard; one provenance
discipline (trailers unchanged; per-file AUTHORED-BY markers travel with the files); one
`suite.json`. Security-critical packages keep a `securityCritical` marker in their
`package.json`, and the auto-merge policy's security exclusion maps to path globs
(`packages/solid-vc/**`, `packages/solid-api-auth/**`, …) so the drive/verify-merge
discipline continues to stop on them.

### 7.2 `jeswr/solid-specs`

```
solid-specs/
├── AGENTS.md / .roborev.toml / suite.json      # same once-per-repo conventions
├── specs/
│   ├── lws/index.html                          # ReSpec sources, one dir per spec
│   ├── dpop-sk/index.html
│   ├── webauthn-reauth/index.html
│   ├── a2a-rdf/index.html
│   ├── agent-authz-credential/index.html
│   ├── accountability-framework/index.html
│   ├── sparql-query/index.html
│   └── nl2rdf-upgrade/index.html
├── notes/agentic-solid/index.html              # the umbrella informative Note
├── conformance/agentic-solid/                  # golden vectors (JSON+Turtle) + GAPS.md
├── tools/                                      # small pnpm workspace: vector validators,
│   └── spec-companion/                         #   spec-companion, link-check
└── .github/workflows/pages.yml                 # ONE Pages deploy → /<spec>/ paths
```

Spec IRIs and citation URLs do not move: the `jeswr.org/spec/*` persistent-ID redirects
(portfolio `config/persistent-ids.ts`) repoint to the new Pages paths in one small portfolio
PR per migrated spec — that layer exists precisely so hosting can move. Each spec dir keeps a
`STATUS` block naming its venue state (CG-draft / LF-submission-pending / experiment).
**Extraction path when a venue adopts a spec:** `git filter-repo --subdirectory-filter
specs/<name>` into the venue's repo — documented in the repo AGENTS.md so consolidation
never reads as a one-way door.

## 8. Decision 6 — phased migration plan (low-risk ordering)

Each phase gates before the next; any phase can stop without stranding the estate.

- **Phase 0 — scaffold (no consumer impact).** Create `jeswr/solid-sdk` per the new-repo
  checklist (roborev hook + toml, gate, guardrails, `.npmrc`, suite.json, AGENTS.md, this
  ADR imported as its `decisions/0001`). Same for `jeswr/solid-specs`. Add both rows to the
  PSS ownership index in the same change.
- **Phase 1 — pilot import (3 packages, chosen to prove the three hard cases).**
  `solid-dpop` (leaf, inlined-by-others), `solid-openid-client` (esbuild-inlines solid-dpop →
  proves inline + `workspace:*` + topological mirror publish), `solid-bookmark` (consumes
  npm-published `@jeswr/fetch-rdf` → proves the external-dep manifest path). Import with
  history (§6), wire `mirror-publish.mjs`, publish each mirror once.
- **Phase 2 — prove consumption.** In one real consumer (e.g. a pod-app), bump one pin to a
  freshly mirror-published sha; verify `GIT_SSH_COMMAND=false npm ci` from a clean checkout
  installs and the app's gate passes; byte-compare the installed `dist/` against the
  monorepo build. This is the go/no-go gate for the whole design — if the mirror path fails
  here, stop with only 3 packages dual-homed and nothing broken.
- **Phase 3 — bulk import, dependency-leaves first.** Order: plumbing (`guarded-fetch`,
  `rdf-serialize`) → auth chain (`solid-session-restore`, `solid-auth-core`,
  `solid-api-auth`, `auth-solid`, `solid-webauthn-reauth`) → agentic (`solid-vc`,
  `solid-odrl`, `solid-a2a`, `solid-agent-card`, `agent-authz-verifier`,
  `agentic-legacy-bridge`) → UI (`app-shell`, `solid-elements`, `solid-components`) →
  federation (+ `federation-vocab` placement) → models (the 7 remaining; `solid-bookmark`
  already imported in Phase 1) → adapters/bridges/integrations
  (rest of §2a). One import = one PR-shaped branch (import graft + boilerplate-strip +
  gate), roborev-reviewed like any change; a few per session, not a big bang. Mirror-publish
  each after its import lands.
- **Phase 3s — specs import** (parallel to Phase 3; independent repo): the 10 spec repos
  into `solid-specs`, one Pages workflow, persistent-ID repoints via portfolio PRs;
  `agentic-solid-conformance` tooling repointed at published shas (it already pins the
  public impls, so it moves without edits to the vectors).
- **Phase 4 — consumers drift over, opportunistically.** No forced repins: apps pick up
  mirror shas whenever they bump for other reasons. Collapse the PSS ownership index's
  ~42 package rows into the two monorepo rows (+ a "mirrors" note). Update the suite skills
  that document `github:` installs in the same change (MAINTENANCE RULE).
- **Phase 5 — end-state (all `needs:user`).** npm org login → `changeset publish` becomes
  the real publish path; consumers migrate to semver ranges per-app; mirrors get a final
  "superseded by npm" banner and are archived (account action). Archiving is *never* done
  before this phase — mirrors must keep serving historical shas until no consumer pins them.

**What stays `needs:user` throughout:** npm login/org publish; archiving or renaming any
existing repo; enabling GitHub Actions for the mirror-publish workflow (CI billing); the
`fetch-rdf` inclusion call (PR-lane repo); Pages/DNS actions behind the persistent-ID
repoints if any arise. Everything else is agent-executable under the normal gate + roborev +
adversarial-verify discipline.

## 9. Risks + open decisions for the maintainer

1. **Mirror-publish integrity is the new trust root for the sha-pin ecosystem.** ~15 apps
   install whatever the mirrors serve; while CI is billing-blocked, publishes run from a
   local box, so the guarantees are procedural (script-only writes, `Mirror-Of:` trailer,
   byte-compare gate) rather than platform-enforced. *Mitigations:* the publish script
   refuses a dirty tree or a non-gate-green monorepo sha; mirrors are never hand-edited (the
   banner + a periodic drift-check comparing mirror HEAD against a rebuild); move publishing
   into Actions the moment billing returns. **Steer wanted:** is local mirror-publishing
   acceptable in the interim, or should bulk import (Phase 3) wait for CI billing so
   publishes are platform-run from day one?
2. **Parallel-agent throughput: one repo = one merge queue.** The charter's orchestration
   model gets its parallelism from repos being independent fronts, merging "one branch at a
   time with a full re-gate between merges." Consolidating 42 fronts into one repo makes
   that rule a bottleneck. *Proposed relaxation (needs charter sign-off):* inside
   `solid-sdk`, branches whose diffs touch **disjoint `packages/<name>` path sets** may merge
   without a full inter-merge re-gate — the diff-aware `--filter '...[origin/main]'` gate
   scopes to changed packages + dependents, so path-disjoint merges retain their coverage;
   the full-workspace gate still runs at session close and before any mirror publish.
   Worktree isolation per mutating agent is unchanged. **Steer wanted:** accept this
   relaxation, or keep strict serialization and accept slower landing across the SDK estate?
3. **Scope calls that change the shape of the result.** (a) `fetch-rdf`: in the monorepo
   (ending its PR-lane special status) or permanently external? It is the most-consumed
   plumbing package, and it staying external keeps a git+https external dep in the workspace
   lockfile until its npm versions cover all uses. (b) The 8 hand-written **model packages**
   vs the "models are generated from the federation" directive: import now and regenerate in
   place (recommended — one codegen PR replaces them all inside the workspace), or hold them
   out pending `federation-codegen` maturity? (c) `solid-federation-vocab` placement (§2b
   recommends `solid-sdk`). (d) Whether `accountable-agent-runtime` + `create-solid-app`
   ride along (§2a leans include).

Secondary risks, recorded but judged manageable: roborev reviews stay diff-scoped so
per-package review quality is unchanged, but the single commit stream means the
roborev-daemon serialization rule binds more often (already standing discipline); a
monorepo-wide dependency bump touches many packages in one commit (mitigated by changesets
discipline + the diff-aware gate); GitHub issue triage for 42 packages lands in one tracker
(mitigated by `pkg:<name>` labels, and the user-visible feedback-button sink already targets
per-app repos, which are unaffected).

## 10. Decision summary

| Question | Recommendation |
|---|---|
| How many monorepos | **Two:** `jeswr/solid-sdk` (42+ packages) + `jeswr/solid-specs` (10+ specs) |
| Package manager | **pnpm workspaces** (content-addressed store; `ignore-scripts` preserved; internal deps `workspace:*`) |
| Orchestrator | **None initially**; Turborepo pre-approved if diff-aware filtering stops being enough; Nx rejected |
| Versioning | **changesets, independent versions** — armed when npm publish unblocks |
| dist / `github:` installs | **Existing repos become read-only, script-published mirrors** carrying `dist/`; monorepo stops committing dist; consumer pins never break; npm publish is the end-state |
| History | **Preserved** via `git filter-repo --to-subdirectory-filter` + unrelated-history graft; old shas resolvable forever |
| Migration | 6 phases: scaffold → 3-package pilot → consumption proof (go/no-go) → bulk import (leaves-first) ∥ specs → opportunistic consumer drift → npm end-state; archiving only at the very end (`needs:user`) |

---

*Signed: PSS agent (Claude Fable 5) — design proposal for maintainer review; nothing in this
ADR authorizes moving a repo.*
