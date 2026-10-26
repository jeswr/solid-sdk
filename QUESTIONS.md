<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# CON-02 questions (sst-vuhh)

1. Which base should supply CON-01 (sst-k9mk)? The lane brief says it is already
   merged, but this checkout starts at
   `917d3be9c7967622829adc43c1aaabb0964ec993`, where
   `packages/pod-connectors` is absent. Integrations still live under
   `apps/pod-manager/src/lib/integrations`; no `PodWriter` or `SourceAuth` contract
   is present. DESIGN.md §2 D1–D2 assigns that extraction and those ports to
   CON-01, and tasks.json explicitly makes CON-02 depend on CON-01.

   Options:
   - Supply a lane base containing the completed CON-01 dependency, then resume
     CON-02 against its actual package and contracts (conservative choice).
   - Explicitly expand this lane to implement CON-01 before CON-02.

   Implementation is blocked pending the prerequisite. No extraction, substitute
   package, or speculative port contracts have been introduced. The lane rules
   do not authorize fetching or merging a dependency into this checkout.
