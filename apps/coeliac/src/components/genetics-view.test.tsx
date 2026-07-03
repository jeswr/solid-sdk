// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Genetics view acceptance (Phase 3c). PRIVACY-CRITICAL. The load-bearing test
 * is `raw-genome-bytes-never-leave-device`: an uploaded raw file is parsed ENTIRELY
 * in the browser and NO fetch request ever carries the raw genotype content. Also
 * covers: consent unchecked-by-default + Save gated on it; consent-refused → no
 * write; NPV framing present; the derived summary IS written on consent.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GeneticsView } from "./genetics-view";
import { GENETIC_FRAMING } from "@/lib/genetics/interpret";
import { makeFetchMock, renderWithSession } from "../../test/session-harness";

/**
 * A raw genome file: the two coeliac tag SNPs (which the summary legitimately
 * derives from) PLUS a large block of OTHER personal SNP rows and a unique secret
 * marker — none of which may ever leave the device.
 */
const SECRET = "SECRET_RAW_GENOME_PAYLOAD_9f83aa_DO_NOT_LEAK";
const OTHER_SNP = "rs0000042_private_personal_variant";
function rawGenomeFile(): File {
  const lines = [
    "# 23andMe raw genome export — PRIVATE",
    `# ${SECRET}`,
    "rs2187668\t6\t32713862\tCT",
    "rs7454108\t6\t32772074\tTC",
  ];
  for (let i = 0; i < 500; i++) lines.push(`${OTHER_SNP}${i}\t${i}\t${i}\tAA`);
  return new File([lines.join("\n")], "genome.txt", { type: "text/plain" });
}

/** Every recorded request body concatenated — what actually left the device. */
function allBodies(fetchMock: ReturnType<typeof makeFetchMock>): string {
  return fetchMock.calls.map((c) => c.body ?? "").join("\n");
}

describe("GeneticsView — privacy invariants", () => {
  it("RAW genome bytes never leave the device (only the derived summary is written)", async () => {
    const fetchMock = makeFetchMock();
    const { fetchMock: fm, store } = renderWithSession(<GeneticsView />, { fetchMock });
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: /upload a test file/i }));
    const input = screen.getByLabelText(/genetic test file/i);
    await user.upload(input, rawGenomeFile());

    // A preview appears (parsed on-device); the two tag SNPs are interpreted.
    await waitFor(() => expect(screen.getByText(/this is what will be saved/i)).toBeInTheDocument());

    // Consent + save (the derived summary DOES get written).
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /save summary to my pod/i }));

    await waitFor(() => expect(fm.puts().some((u) => u.endsWith("summary.ttl"))).toBe(true));
    // The record transitions to `synced` (not stuck pending — the rev discriminator
    // must match the record that was flushed).
    await waitFor(async () => expect((await store.getGeneticSummary())?.sync).toBe("synced"));

    const bodies = allBodies(fm);
    // THE INVARIANT: no request body ever carried the raw file's secret marker or
    // any of the 500 other personal SNP rows.
    expect(bodies).not.toContain(SECRET);
    expect(bodies).not.toContain(OTHER_SNP);
    // The whole raw blob (kilobytes of genome) never appears anywhere on the wire.
    expect(bodies).not.toMatch(/32713862\t/); // the raw file's position column formatting
    // Sanity: the DERIVED summary (a tag-SNP call) WAS written — the feature works.
    const summaryBody =
      fm.calls.find((c) => c.url.endsWith("summary.ttl") && c.method === "PUT")?.body ?? "";
    expect(summaryBody).toMatch(/rs2187668/);
  });

  it("the consent checkbox is UNCHECKED by default and gates Save", async () => {
    renderWithSession(<GeneticsView />);
    const user = userEvent.setup();
    // Manual entry → preview → consent gate.
    await user.click(screen.getAllByRole("radio", { name: /^Present$/ })[0]);
    await user.click(screen.getByRole("button", { name: /preview summary/i }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: /save summary to my pod/i })).toBeDisabled();
  });

  it("refusing consent writes NOTHING to the pod", async () => {
    const fetchMock = makeFetchMock();
    const { fetchMock: fm } = renderWithSession(<GeneticsView />, { fetchMock });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("radio", { name: /^Present$/ })[0]);
    await user.click(screen.getByRole("button", { name: /preview summary/i }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());
    // Never tick consent. Save stays disabled → no summary PUT can occur.
    expect(fm.puts().some((u) => u.endsWith("summary.ttl"))).toBe(false);
  });

  it("shows the NPV-only framing everywhere", () => {
    renderWithSession(<GeneticsView />);
    expect(screen.getByText(GENETIC_FRAMING)).toBeInTheDocument();
    expect(screen.getByText(GENETIC_FRAMING).textContent).toMatch(/does NOT mean you have coeliac/i);
  });
});
