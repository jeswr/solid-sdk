<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-31t prerequisite question

1. Which prerequisite-containing base should this lane use to implement A-005?

   DESIGN §1.2 requires the imported legacy bridge, §2.4 requires the agent-model
   vocabulary, and §3.1–3.3 require the model and unchanged legacy message types.
   The task declares A-004 as a prerequisite and says it is already merged, but
   this checkout at `6ad0939808c3c1c438415d45409a5a4c30e281bd` contains only the
   agent-model scaffold (`src/index.ts` exports nothing). Neither
   `packages/personal-agent` nor `packages/agentic-legacy-bridge` exists.
   The prescribed `agent/integration` ref also does not exist locally.

   Options:

   - Redispatch the lane on a base containing A-002 and A-004, with a valid
     integration ref for the required affected gate (recommended).
   - Explicitly authorize integrating a specified local prerequisite commit into
     this branch and specify the gate base. Locally available
     `4559de9bd1375cce8ca9aba861e3d7e32c0d61fe` contains the model implementation
     and imported packages, but it is not an ancestor of this checkout.

   Implementation is stopped pending that correction. Recreating the missing
   prerequisite packages or choosing a new base without direction would exceed
   the lane scope. No fetch, merge, branch switch, or prerequisite import was run.
