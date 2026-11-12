<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/health-insights

Pure trigger inference and elimination protocol logic extracted from Coeliac (sst-rndk.1).
Consumes typed `@jeswr/solid-health-diary` data; no storage, RDF construction, UI or network access.

The root entry exports `correlate`, `rankSuspicions`, `rankedSuspects`, `analyze`, lag resolution,
learned lag profiles, context clustering, proposals, reviews, reintroduction scheduling,
conclusion and current-plan derivation, safety rails, and their input/output types and constants.
Protocol APIs include `startProtocol`, `advanceProtocol`, `promptFor`, `nextAction`,
`isPhaseElapsed`, `challengeSafetyRefusal` and `emergencyTriggersFromDiary`.
`deriveCurrentPlan` accepts structural `PlanConclusion` and `PlanProtocol` inputs, so apps own cache types.

Correlation expresses patterns, never diagnosis or confirmed causation. Emergency symptoms are excluded
from correlation; protocol safety rails and the original oracle tests are retained.

Run `pnpm --filter @jeswr/health-insights build` and `pnpm --filter @jeswr/health-insights test`.
