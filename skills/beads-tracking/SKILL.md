---
name: beads-tracking
description: Use when a repository needs agent-friendly issue tracking with beads (bd), when filing follow-up work discovered mid-task, claiming/closing/syncing beads, labelling surfaces for collision-free parallel dispatch, structuring epics, or running an autonomous ready-frontier drain. Consent-gated — bd init writes .beads/ into the user's repo.
---
<!-- AUTHORED-BY Claude Fable 5 -->

> **Consent gate — highly opinionated practice.** You MUST ask the user before setting this
> up in a repository (an AskUserQuestion / explicit confirmation, not an assumption).
> `bd init` writes a `.beads/` directory and commits issue JSONL into the user's repo. A
> repo charter (AGENTS.md/CLAUDE.md) that already mandates beads counts as standing
> consent. Never install it silently as a side-effect of another task.

# Issue tracking with beads

beads (https://github.com/gastownhall/beads, CLI `bd`) is git-native issue tracking built
for agent-driven repos: issues live as JSONL in the repository, carry real dependency
edges, and `bd ready` computes the unblocked frontier — which makes autonomous dispatch
possible. It replaces markdown TODO lists entirely.

## Setup

With consent: `bd init -p <prefix>` (issue ids become `<prefix>-1`, `<prefix>-2`, …). The
JSONL (`issues.jsonl`) is committed; the local database and daemon files are gitignored by
bd's own `.beads/.gitignore`. `bd sync` flushes and commits the JSONL.

## Conventions

| Convention | Rule |
| --- | --- |
| Claim before working | `bd update <id> --claim` before touching code; a failed claim means someone else has it — stop |
| Close on merge | `bd close <id>` when the work lands on the main branch, not when the PR opens |
| Sync at session end | `bd sync` so the JSONL commit carries the session's tracker state |
| Follow-ups are beads, never TODOs | every follow-up task, discovered bug, or deferred improvement: `bd create "<title>" -d "<why + acceptance>" --deps discovered-from:<current-id>` — no TODO comments, no prose-only report mentions |
| `needs:user` label | human-gated work (consent, credentials, taste calls) — excluded from autonomous dispatch |
| `surface:<path>` labels | one label per bead naming its path surface (`surface:apps/pod-money`, `surface:e2e`); dispatch at most one bead per surface per wave so parallel merges stay path-disjoint |
| Epics are containers | never dispatch an epic; dispatch its ready children and close the epic when they are done |
| Repo root only | run `bd` ONLY from the repository root checkout, never inside a git worktree — a worktree-local `.beads/` forks the JSONL |

## Autonomous drain

With the conventions above in place, ready-frontier work drains without per-agent
hand-dispatch. The pattern, per wave:

1. **Frontier** — `bd ready --json`, filtered to the dispatchable set: status `open` only,
   drop `needs:user`, drop epics, drop beads whose branch already has an open PR, keep at
   most one bead per `surface:*` label, cap the wave.
2. **Implement** — one persona agent per bead (persona chosen from the surface label), each
   in an isolated git worktree: claim, implement, gate, push, open a PR. Never merge.
3. **Verify** — an adversarial reviewer per PR: house rules + CI + review findings; merge
   only clean, green, low-risk PRs and `bd close` the bead; hold anything with concerns
   (security surfaces are never auto-merged) with a note for the lead.
4. Re-read the frontier — newly unblocked beads appear — and repeat until dry or capped.

A genericised template of this loop ships beside this skill as
[`drain-ready-beads.example.js`](drain-ready-beads.example.js): copy it into
`.claude/workflows/<name>.js` in the target repo, set the repo path/slug and persona map at
the top, and adapt the prompts to the workspace's house rules.

## Agent persona

When this work is delegated to a sub-agent, the lead runbook in
[`.claude/agents/solid-app-orchestration.md`](../../.claude/agents/solid-app-orchestration.md)
owns bead decomposition and dispatch — it routes through this skill. Every specialist
persona files follow-up work per the table above.
