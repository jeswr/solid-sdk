// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Therapies view acceptance (Phase 3b §4.4): the header truth (GF diet is the
 * only treatment), failures shown as failures, and no candidate presented as an
 * effective treatment.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NOT_MEDICAL_ADVICE } from "./medical-disclaimer";
import { TherapiesView } from "./therapies-view";
import { renderWithSession } from "../../test/session-harness";

// The therapies page is static; the live "recruiting now" fetch is best-effort.
function emptyTrialsFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200 })) as unknown as typeof globalThis.fetch;
}

describe("TherapiesView", () => {
  it("leads with the header truth and the not-medical-advice frame", () => {
    renderWithSession(<TherapiesView />, { publicFetch: emptyTrialsFetch() });
    expect(screen.getByText(NOT_MEDICAL_ADVICE)).toBeInTheDocument();
    expect(screen.getByText(/gluten-free diet is still the only treatment/i)).toBeInTheDocument();
  });

  it("shows larazotide + Nexvax2 honestly as discontinued/failed", () => {
    renderWithSession(<TherapiesView />, { publicFetch: emptyTrialsFetch() });
    expect(screen.getByText(/Larazotide/)).toBeInTheDocument();
    expect(screen.getByText(/Nexvax2/)).toBeInTheDocument();
    // both carry a "discontinued/failed" stage badge
    expect(screen.getAllByText(/Discontinued \/ failed/i).length).toBeGreaterThanOrEqual(2);
  });

  it("never presents a candidate as an effective/approved cure", () => {
    renderWithSession(<TherapiesView />, { publicFetch: emptyTrialsFetch() });
    expect(screen.queryByText(/cures coeliac|proven treatment|approved treatment/i)).not.toBeInTheDocument();
  });
});
