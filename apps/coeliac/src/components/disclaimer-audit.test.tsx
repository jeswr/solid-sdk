// AUTHORED-BY Claude Fable 5
/**
 * Disclaimer audit (Brief 4B item 4). EVERY inference / conclusion surface must carry
 * the medical-disclaimer frame ("information, not medical advice … discuss with your
 * clinician") so a user can never read a pattern, plan, or genetic signal as a
 * diagnosis. This test renders each such surface and asserts the canonical
 * `NOT_MEDICAL_ADVICE` sentence is present — so the frame can never be dropped from an
 * inference surface without a red test.
 *
 * The knowledge surfaces (research / trials / therapies) already have their own
 * disclaimer-presence tests; this audit covers the INFERENCE + CONCLUSION surfaces:
 * Insights, Plan, Challenges, Genetics, and Community (which surfaces eating-out).
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderWithSession } from "../../test/session-harness";
import { DietPlanView } from "./diet-plan-view";
import { GeneticsView } from "./genetics-view";
import { InsightsView } from "./insights-view";
import { NOT_MEDICAL_ADVICE } from "./medical-disclaimer";
import { ProtocolsView } from "./protocols-view";
import { CommunityView } from "./community/community-view";

const SURFACES: ReadonlyArray<[name: string, ui: ReactElement]> = [
  ["Insights", <InsightsView key="i" />],
  ["Plan", <DietPlanView key="p" />],
  ["Challenges", <ProtocolsView key="c" />],
  ["Genetics", <GeneticsView key="g" />],
  ["Community", <CommunityView key="m" />],
];

describe("medical-disclaimer audit — every inference/conclusion surface", () => {
  for (const [name, ui] of SURFACES) {
    it(`${name} renders the not-medical-advice frame`, async () => {
      renderWithSession(ui);
      expect(await screen.findByText(NOT_MEDICAL_ADVICE)).toBeInTheDocument();
    });
  }
});
