// drain-ready-beads.example.js — TEMPLATE for the self-driving bead-frontier loop.
//
// Copy into the target repo as .claude/workflows/drain-ready-beads.js and adapt:
//   1. Set REPO (absolute path) and REPO_SLUG (owner/name) below.
//   2. Adapt pickPersona() to the workspace's surface:* labels and persona set.
//   3. Adapt the house-rule list in verifyPrompt() to the workspace's AGENTS.md.
// This template wraps the loop in a default-export async function so it lints as a normal
// module; a workflow harness that executes the file body top-level (with args/agent/
// pipeline/phase/log as globals) can inline the body and drop the wrapper.
//
// PURPOSE: keep the lead session OUT of per-agent dispatch. Each wave reads the ready-bead
// frontier (`bd ready --json`), filters to safely-dispatchable work, runs one persona agent
// per bead in an isolated worktree (implement -> PR), adversarially verifies each PR and
// merges the clean ones, then re-reads the frontier (newly-unblocked beads appear) and
// repeats until dry or capped.
//
// DISPATCHABLE = status "open" (in_progress is someone else's claim)
//   MINUS needs:user-labelled beads   (human-gated: not agent work)
//   MINUS epics                        (containers — dispatch their ready children instead)
//   MINUS beads with an open PR       (branch bead/<id> already pushed = in flight)
//   MINUS surface collisions          (at most ONE bead per surface:* label per wave —
//                                      disjoint path sets are what make parallel merges safe)
//
// SAFETY: impl agents run in ISOLATED worktrees and never touch the shared checkout; `bd`
// runs ONLY from the repo root (a worktree-local .beads would fork the JSONL). Verify merges
// only clean, green, low-risk PRs; anything with concerns (security surfaces, house-rule
// violations, red CI, unaddressed review comments) stays OPEN with the bead in_progress and
// a note for the lead. Every agent files follow-up beads instead of TODOs.

export const meta = {
  name: "drain-ready-beads",
  description:
    "Self-driving bead-frontier loop: filter bd ready, implement each bead via its persona agent in an isolated worktree, adversarially verify + merge clean PRs, repeat until dry or capped.",
  whenToUse:
    "Run whenever ready beads should be drained without the lead session hand-dispatching agents.",
  phases: [
    { title: "Frontier", detail: "bd ready --json + dispatchability filters" },
    { title: "Implement", detail: "one persona agent per bead, isolated worktree -> PR" },
    { title: "Verify", detail: "adversarial review; merge clean PRs, close beads" },
  ],
};

// ---- EDIT ME: repo parameters -------------------------------------------------------------
const REPO = "/absolute/path/to/your/repo";
const REPO_SLUG = "owner/repo";
// -------------------------------------------------------------------------------------------

const FRONTIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    beads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          surface: { type: "string" },
          priority: { type: "number" },
        },
        required: ["id", "title", "surface"],
      },
    },
    droppedAsInFlight: { type: "array", items: { type: "string" } },
    droppedAsGated: { type: "array", items: { type: "string" } },
  },
  required: ["beads"],
};

const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bead: { type: "string" },
    prUrl: { type: "string" },
    gatesGreen: { type: "boolean" },
    skipped: { type: "boolean" },
    reason: { type: "string" },
    followUpBeads: { type: "array", items: { type: "string" } },
  },
  required: ["bead", "skipped"],
};

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bead: { type: "string" },
    merged: { type: "boolean" },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: ["bead", "merged"],
};

// EDIT ME: map surface:* labels to the persona agents defined in .claude/agents/.
function pickPersona(surface) {
  const s = (surface || "").toLowerCase();
  if (s.startsWith("apps/")) return "solid-app-builder";
  if (s.startsWith("packages/ui")) return "solid-frontend-dev";
  if (s.startsWith("packages/data-model")) return "solid-data-modeler";
  if (s === "e2e" || s.startsWith("e2e/")) return "solid-test-engineer";
  if (s === "infra" || s === "deploy" || s.startsWith(".github")) return "solid-devops";
  return "general-purpose"; // everything else: docs, misc, unknown surfaces
}

function frontierPrompt(cap, only) {
  return `You are the frontier reader for the bead drain in ${REPO}. From the REPO ROOT run:
  cd ${REPO} && bd ready --json
  cd ${REPO} && gh pr list --state open --json headRefName --limit 100
Filter the ready beads to the DISPATCHABLE set:
  - status === "open" only (in_progress beads are already claimed);
  - drop any bead labelled needs:user (report in droppedAsGated);
  - drop issue_type === "epic";
  - drop any bead whose branch bead/<id> appears in the open-PR head refs (report in droppedAsInFlight);
  ${only ? `- keep ONLY ids in ${JSON.stringify(only)};` : ""}
  - surface = the value of its "surface:<value>" label ("misc" if absent); keep at most ONE bead
    per surface (highest priority first, then oldest), so parallel work is path-disjoint;
  - cap the final list at ${cap}, priority order.
Return the structured output only. Do not modify anything.`;
}

function implPrompt(b, persona) {
  return `You are the ${persona} persona draining bead ${b.id} ("${b.title}", surface: ${b.surface}). You are running in an ISOLATED git worktree of ${REPO} — never touch the shared checkout.
Ground rules (non-negotiable):
- Read ${REPO}/AGENTS.md first, then \`cd ${REPO} && bd show ${b.id}\` for the full spec. bd commands run ONLY from ${REPO} (never from your worktree). Claim first: \`cd ${REPO} && bd update ${b.id} --claim\` (if the claim fails, STOP and return skipped=true, reason="already claimed").
- Follow your persona's "Read first" skills list before writing code. Verify library APIs against the published npm dist / context7, not memory.
- Work ONLY within the bead's surface paths. If the bead is underspecified, make the smallest reasonable call, note it in the PR body, and file a follow-up bead rather than expanding scope.
- In your worktree: create branch bead/${b.id}, implement, run the workspace gate, commit with the workspace's commit style + authoring-model trailer, push, and open a PR on ${REPO_SLUG} titled "${b.id}: <summary>". Do NOT merge it.
- File every discovered follow-up as a bead: \`cd ${REPO} && bd create "<title>" -d "<why + acceptance>" --deps discovered-from:${b.id}\` (label needs:user if human-gated). List their ids in followUpBeads.
- If gates cannot go green, still push the branch + open a DRAFT PR, set gatesGreen=false and explain in reason.
Return the structured output only.`;
}

function verifyPrompt(r) {
  return `You are the adversarial verifier for bead ${r.bead} (PR: ${r.prUrl}) on ${REPO_SLUG}. READ-ONLY except for the merge/close actions at the end. From ${REPO}:
1. Fetch the diff (gh pr diff) and review it adversarially: correctness, scope (only the bead's surface), and the house rules from ${REPO}/AGENTS.md (EDIT ME: list the workspace's non-negotiables here, e.g. the RDF discipline, no minted IRIs, no hand-built .acl, no @inrupt).
2. Wait for CI: gh pr checks ${r.prUrl.split("/").pop()} --watch --fail-fast (give up after ~10 minutes and treat as not-green). Count unaddressed reviewer/Copilot comments as concerns.
3. Verdict: merge ONLY if implGatesGreen=${String(r.gatesGreen === true)}, CI is green, and you found no material concerns. Security-sensitive surfaces (auth, ACL, token handling) are NEVER auto-merged — hold with a concern.
   - To merge: gh pr merge ${r.prUrl} --squash --delete-branch, then cd ${REPO} && bd close ${r.bead} && bd sync.
   - To hold: leave the PR open, cd ${REPO} && bd update ${r.bead} --append-notes "drain hold: <concerns>" and leave it in_progress.
Return the structured output only (merged=true only after the merge command succeeded).`;
}

export default async function drainReadyBeads(args, { agent, pipeline, phase, log }) {
  const maxBeads = args?.maxBeads || 4;
  const maxWaves = args?.waves || 3;
  const only = args?.only || null;

  const implemented = [];
  const merged = [];
  const held = [];
  const skipped = [];
  let wave = 0;

  while (wave < maxWaves) {
    wave += 1;
    phase("Frontier");
    const frontier = await agent(frontierPrompt(maxBeads, only), {
      label: `frontier:wave${wave}`,
      phase: "Frontier",
      schema: FRONTIER_SCHEMA,
      effort: "low",
    });
    if (!frontier?.beads.length) {
      log(`wave ${wave}: frontier dry — stopping`);
      break;
    }
    log(
      `wave ${wave}: dispatching ${frontier.beads.length} bead(s): ${frontier.beads.map((b) => b.id).join(", ")}`,
    );
    if ((frontier.droppedAsGated || []).length) {
      log(`gated (needs:user): ${frontier.droppedAsGated.join(", ")}`);
    }

    const waveResults = await pipeline(
      frontier.beads,
      (b) =>
        agent(implPrompt(b, pickPersona(b.surface)), {
          label: `impl:${b.id}`,
          phase: "Implement",
          schema: IMPL_SCHEMA,
          agentType: pickPersona(b.surface),
          isolation: "worktree",
        }),
      (r, b) => {
        if (!r || r.skipped || !r.prUrl) {
          return {
            bead: b.id,
            merged: false,
            concerns: [r ? r.reason || "skipped" : "agent died"],
          };
        }
        implemented.push({ bead: r.bead, prUrl: r.prUrl, followUps: r.followUpBeads || [] });
        return agent(verifyPrompt(r), {
          label: `verify:${b.id}`,
          phase: "Verify",
          schema: VERDICT_SCHEMA,
        });
      },
    );

    for (const v of waveResults.filter(Boolean)) {
      if (v.merged) merged.push(v.bead);
      else if (implemented.some((i) => i.bead === v.bead)) {
        held.push({ bead: v.bead, concerns: v.concerns || [] });
      } else skipped.push({ bead: v.bead, reason: (v.concerns || []).join("; ") });
    }
    log(
      `wave ${wave} done: ${merged.length} merged total, ${held.length} held, ${skipped.length} skipped`,
    );
  }

  return { waves: wave, implemented, merged, held, skipped };
}
