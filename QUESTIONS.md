<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-02 (sst-vuhh) questions

1. Which base containing CON-01 should this lane use?

   Spec: connectors/DESIGN.md §2 D1–D2 and connectors/tasks.json CON-02
   (`depends_on: ["CON-01"]`). The lane brief says CON-01 is already merged,
   but the supplied base and initial HEAD are both
   `917d3be9c7967622829adc43c1aaabb0964ec993`. At that commit,
   `packages/pod-connectors` is absent and the integrations remain under
   `apps/pod-manager/src/lib/integrations/`. The extracted package, its
   PodWriter/SourceAuth ports, and its package scripts are therefore unavailable.

   Options:
   - Supply a corrected lane base containing CON-01 (preferred).
   - Explicitly authorize importing CON-01 from a specified local source clone
     and commit into this checkout.
   - Expand this lane to implement CON-01 as well; this changes its current scope.

   Conservative disposition: implementation is blocked until CON-01 is supplied.
   Do not recreate its extraction, invent competing runner interfaces, or fetch
   or merge another branch without authorization. No CON-02 acceptance criterion
   has been implemented or claimed as passing.
