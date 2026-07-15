---
name: roborev-review
description: Use when a repository should get automated per-commit AI review, when installing roborev or configuring .roborev.toml, when reading or addressing roborev verdicts, running refine/fix loops, or choosing reviewer agents and models. Consent-gated — never set up as a side-effect of another task.
---
<!-- AUTHORED-BY Claude Fable 5 -->

> **Consent gate — highly opinionated practice.** You MUST ask the user before setting this
> up in a repository (an AskUserQuestion / explicit confirmation, not an assumption).
> roborev queues background AI agents on every commit — the cost, quota, and git-hook
> implications are the user's decision. A repo charter (AGENTS.md/CLAUDE.md) that already
> mandates roborev counts as standing consent. Never install it silently as a side-effect
> of another task.

# Per-commit AI review with roborev

roborev (https://www.roborev.io/) reviews **every commit asynchronously**: a post-commit
hook queues the commit, a reviewer agent produces a verdict with severity-ranked findings,
and `refine`/`fix` loops turn findings into follow-up commits. The suite convention is that
agents read verdicts between work rounds and address findings before merge — review
coverage without a human bottleneck.

## Setup

Install via `brew install roborev` (or the installer in the roborev docs). Then, in the
repo, with consent:

```sh
roborev init          # writes .roborev.toml
roborev install-hook  # post-commit hook that queues each commit for review
```

Suite-convention `.roborev.toml`:

```toml
agent = "codex"                  # reviewer agent
model = "gpt-5.6-sol"            # resolve the CURRENT best at setup time — see caveat
security_agent = "claude-code"   # auth / VC / ACL / token surfaces
review_min_severity = "low"
```

**Model pins go stale.** Resolve the latest available reviewer model at setup time — today
`gpt-5.6-sol` — do not copy a pin blindly from another repo or from this file. Agents
resolve the current default at session start rather than hardcoding.

**Reviewer-model diversity.** Reviews come from a **different model family than the
author**: Claude-authored commits get a codex/GPT reviewer (and security surfaces get a
second, Claude-based pass via `security_agent`). Same-family review repeats the author's
blind spots; cross-family review is the point.

## Operating discipline

- **Async only, never blocking.** Agents run reviews in the background and never block
  foreground work waiting for a verdict (`roborev review --background`, or simply let the
  hook queue it). Sequence verdict-reading after other useful work.
- **Read verdicts between rounds**: `roborev status` for the queue, `roborev show
  [<commit>]` for findings. A lead session reads verdicts at verify-merge time and routes
  findings back as fix briefs.
- **Address findings** — fix, or record why not. `roborev refine <commit>` iterates on a
  reviewed commit with the findings as input; `roborev fix` applies the reviewer's
  suggested remediation. Findings on security-critical surfaces are merge-blockers.
- Verdicts are advisory input to the human/lead merge decision — a green verdict never
  auto-merges anything.

## Agent persona

When this work is delegated to a sub-agent, the lead runbook in
[`.claude/agents/solid-app-orchestration.md`](../../.claude/agents/solid-app-orchestration.md)
owns the review loop — it routes through this skill. Specialist personas run roborev only
async/background per their stop-gates.
