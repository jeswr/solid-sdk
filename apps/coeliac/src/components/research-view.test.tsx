// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Research view acceptance (Phase 3a): renders with a STUBBED public fetch (no
 * server). Asserts the not-medical-advice frame, the cited guidelines anchor, the
 * ranked literature, and that a RETRACTED paper never appears.
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NOT_MEDICAL_ADVICE } from "./medical-disclaimer";
import { ResearchView } from "./research-view";
import { renderWithSession } from "../../test/session-harness";

const EPMC_BODY = {
  hitCount: 2709,
  resultList: {
    result: [
      {
        id: "1",
        source: "MED",
        doi: "10.1/rev",
        title: "Systematic review of coeliac disease management",
        journalTitle: "Gut",
        pubYear: "2026",
        pubType: "systematic review; Journal Article",
        isOpenAccess: "Y",
        citedByCount: 12,
        firstPublicationDate: "2026-05-01",
      },
      {
        id: "2",
        source: "MED",
        title: "Retracted: bogus coeliac trial",
        pubType: "retracted publication",
        citedByCount: 99,
        firstPublicationDate: "2025-01-01",
      },
    ],
  },
};

/** A public-fetch stub that answers only the EPMC host with the fixture. */
function epmcPublicFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("www.ebi.ac.uk")) return new Response(JSON.stringify(EPMC_BODY), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

describe("ResearchView", () => {
  it("shows the not-medical-advice frame + the cited guidelines", async () => {
    renderWithSession(<ResearchView />, { publicFetch: epmcPublicFetch() });
    expect(screen.getByText(NOT_MEDICAL_ADVICE)).toBeInTheDocument();
    // guidelines anchor is always present (works even offline)
    expect(screen.getByText(/NG20/)).toBeInTheDocument();
    expect(screen.getAllByText(/still eating gluten/i).length).toBeGreaterThan(0);
  });

  it("renders ranked literature and NEVER a retracted paper", async () => {
    renderWithSession(<ResearchView />, { publicFetch: epmcPublicFetch() });
    await waitFor(() =>
      expect(screen.getByText(/Systematic review of coeliac disease management/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Retracted: bogus coeliac trial/)).not.toBeInTheDocument();
    // the reader link goes to the canonical source with safe rel
    const link = screen.getByRole("link", { name: /Systematic review of coeliac/ });
    expect(link).toHaveAttribute("href", "https://doi.org/10.1/rev");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
