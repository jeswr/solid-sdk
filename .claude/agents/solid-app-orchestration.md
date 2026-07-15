---
name: solid-app-orchestration
description: How the lead session orchestrates Solid application development — round-based parallel specialists (solid-app-builder, solid-frontend-dev, solid-data-modeler, solid-test-engineer, solid-devops) over DISJOINT path sets, scoped briefs that name exact apps/packages/files + skills, verify-merge between rounds. Read before spawning any app-development persona, whether in this monorepo or in a consuming app repo that copied these definitions down.
metadata:
  type: lead-runbook
---
<!-- AUTHORED-BY Claude Fable 5 -->

This is the lead's runbook for building Solid applications with a team of sub-agent
specialists. The **lead role is played by the main session** — sub-agents cannot spawn
children, so orchestration never delegates downward. Specialists are real sub-agents; the
lead plans, spawns, verifies, and merges.

## The team

| Persona | Owns | Definition |
| --- | --- | --- |
| `solid-app-builder` | one app end-to-end (`apps/<slug>` or the app repo) | `.claude/agents/solid-app-builder.md` |
| `solid-frontend-dev` | routes/UI/auth UX within named paths | `.claude/agents/solid-frontend-dev.md` |
| `solid-data-modeler` | RDF shapes, vocab, pod data layer | `.claude/agents/solid-data-modeler.md` |
| `solid-test-engineer` | Vitest + Playwright + the local-server harness | `.claude/agents/solid-test-engineer.md` |
| `solid-devops` | Vercel projects, CI gates, env matrix | `.claude/agents/solid-devops.md` |

## Round-based builds

1. **Plan a round**: partition the work into briefs whose path sets are **DISJOINT**
   (`apps/<slug>` vs `packages/<name>` vs test/CI files). Disjointness is what makes the
   parallelism safe — this repo's merge rule (AGENTS.md §Merge rule) only relaxes re-gating
   for path-disjoint branches. Shared-file work (root config, `scripts/`, `guardrails/`,
   a package two specialists both need) serializes or goes to exactly one agent.
2. **Spawn all specialists for the round in one message**, each in its own isolated git
   worktree + branch. Never point two mutating agents at the same checkout.
3. **Verify-merge between rounds**: the lead reads each compact report, runs/reads the gate
   (`pnpm run gate`; `gate:full` at session close), reads roborev verdicts, merges the
   disjoint branches, and only then plans the next round on the merged state.

## Writing a scoped brief

Each specialist gets ONLY the context its slice needs; the common prefix (persona file +
AGENTS.md conventions) is shared and cached, so the brief itself stays small and exact:

- **Name the exact paths**: `apps/pod-money/src/routes/**`, `packages/solid-task-model/`,
  specific files where known. Never "the whole repo", never "wherever needed".
- **Name the SPEC sections** the slice implements (section numbers/headings, not "the spec").
- **Name the skills to read**: the persona's own "Read first" list plus any
  `packages/<pkg>/SKILL.md` for packages the brief touches.
- **State the round's interface contracts** (types, routes, resource shapes) the slice must
  honor so parallel slices meet in the middle.
- **Repeat the stop-gates** (below) in every brief. Briefs inherit them from the persona
  files, but repetition is cheap and a missed stop-gate is not.

## Model inheritance

The persona definitions deliberately omit the `model:` frontmatter key: **specialists
inherit the lead session's model**. Override per-spawn (pass a cheaper model on the Agent
call) only for mechanical, well-spec'd work — a rename sweep, applying a written fix list,
regenerating fixtures. Design, auth/security surfaces, and RDF modelling stay on the
session model.

## Task tracking (beads)

Where the workspace uses beads (a `.beads/` directory exists —
https://github.com/gastownhall/beads), tracking is bead-driven: the lead decomposes work
into beads with real dependency edges (`bd dep`), dispatches from the `bd ready` frontier —
one bead per disjoint surface — and may run a committed `drain-ready-beads`-style workflow
from `.claude/workflows/` to drain the frontier autonomously. Specialists claim
(`bd update <id> --claim`) and close (`bd close <id>`) the beads they work.

## Follow-up work

In a beads workspace, every follow-up task, discovered bug, or deferred improvement is
filed as a bead — `bd create "<title>" -d "<why + acceptance>"
--deps discovered-from:<current-bead-id>` (omit `--deps` when not working a bead) — never a
TODO comment or a prose-only report mention. Label human-gated items `needs:user`. Run `bd`
only from the repository root checkout, never from inside a worktree (avoids divergent
`.beads` JSONL).

## Review and gates

- **roborev reviews every commit asynchronously.** Specialists never block foreground on a
  verdict; the lead reads verdicts between rounds and routes findings back as fix briefs.
- The workspace gate (`pnpm run gate`) is the merge bar; security-critical packages
  (`"securityCritical": true`) are never auto-merged and always get adversarial review.

## Stop-gates (repeat in every brief)

- Never push to repos the user does not own; for external repos, STOP at "ready to PR" and
  hand back to the lead — the lead gets maintainer approval before any `gh pr create`.
- Specialists never merge PRs; the lead merges after verify.
- roborev only async/background, never a foreground wait.

## What comes back

Each specialist's final message is **data for the lead, not prose for a human**: what
changed (paths), gate results (exact commands run, pass/fail), and open questions/blockers.
The lead consolidates rounds into the report the maintainer actually reads.
