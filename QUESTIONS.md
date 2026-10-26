<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-vuhh — CON-02 prerequisite question

1. How should the missing CON-01 prerequisite be supplied? Connectors DESIGN.md
   §2 D1–D2 and tasks.json CON-02 require CON-01 (sst-k9mk) before this work.
   The lane brief says that dependency is already merged, but base
   `917d3be9c7967622829adc43c1aaabb0964ec993` has no
   `packages/pod-connectors`, no pod-connectors workspace dependency, and keeps
   the integration implementation under
   `apps/pod-manager/src/lib/integrations/`. No local `lane/sst-k9mk` branch is
   available in this checkout.

   Options:
   - Supply a new lane base containing the completed CON-01 implementation.
   - Explicitly authorize merging completed CON-01 from a named local source
     clone and commit, as the current lane rules do not prescribe that merge.

   Conservative reading: stop implementation until CON-01 is present. Do not
   recreate its package extraction or change Pod Manager as part of CON-02.
