// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Trials view acceptance (Phase 3b): the HARD RAIL — trials are framed as
 * "discuss with your clinician", the CTA is "Read on ClinicalTrials.gov", and no
 * enrolment verdict / "Apply" / "you match" is EVER rendered.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NOT_MEDICAL_ADVICE } from "./medical-disclaimer";
import { TrialsView } from "./trials-view";
import { renderWithSession } from "../../test/session-harness";

const CTGOV_BODY = {
  studies: [
    {
      protocolSection: {
        identificationModule: { nctId: "NCT07298343", briefTitle: "ZED1227 in Non-responsive Celiac Disease" },
        statusModule: { overallStatus: "RECRUITING" },
        designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE2"] },
        eligibilityModule: { eligibilityCriteria: "Adults 18-70 with biopsy-confirmed celiac disease." },
        contactsLocationsModule: { locations: [{ city: "London", country: "United Kingdom" }] },
      },
    },
    {
      protocolSection: {
        identificationModule: { nctId: "NCT06001177", briefTitle: "KAN-101 ACeD-it" },
        statusModule: { overallStatus: "RECRUITING" },
        designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE2"] },
        contactsLocationsModule: { locations: [{ city: "Chicago", country: "United States" }] },
      },
    },
  ],
};

function ctgovPublicFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("clinicaltrials.gov")) {
      return new Response(JSON.stringify(CTGOV_BODY), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

describe("TrialsView", () => {
  it("frames trials as clinician-discussion, never enrolment", async () => {
    renderWithSession(<TrialsView />, { publicFetch: ctgovPublicFetch() });
    expect(screen.getByText(NOT_MEDICAL_ADVICE)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Read on ClinicalTrials\.gov/).length).toBeGreaterThan(0));
    // the discuss-with-your-clinician framing is on every card
    expect(screen.getAllByText(/discuss it with your clinician/i).length).toBeGreaterThan(0);
    // HARD RAIL: nothing that recommends enrolment / claims an affirmative match.
    // (The honest "this app does not check whether you are eligible" negation is
    // fine — we forbid only affirmative match/enrol verdicts + Apply/Enrol CTAs.)
    expect(screen.queryByText(/you (match|qualify)|you should enrol|you are eligible for/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply|enrol/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^apply|^enrol/i })).not.toBeInTheDocument();
  });

  it("CTA links to the canonical study page with safe rel", async () => {
    renderWithSession(<TrialsView />, { publicFetch: ctgovPublicFetch() });
    const cta = await screen.findAllByRole("link", { name: /Read on ClinicalTrials\.gov/ });
    expect(cta[0]).toHaveAttribute("href", expect.stringMatching(/clinicaltrials\.gov\/study\/NCT/));
    expect(cta[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("the country filter shows all countries when selected (name-based, not ISO)", async () => {
    const user = userEvent.setup();
    renderWithSession(<TrialsView />, { publicFetch: ctgovPublicFetch() });
    await waitFor(() => expect(screen.getByLabelText(/Show trials in/i)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Show trials in/i), "");
    await waitFor(() => {
      expect(screen.getByText(/ZED1227 in Non-responsive Celiac Disease/)).toBeInTheDocument();
      expect(screen.getByText(/KAN-101 ACeD-it/)).toBeInTheDocument();
    });
  });
});
