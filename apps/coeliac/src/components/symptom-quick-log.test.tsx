// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The symptom-log acceptance: two-tap logging with a stubbed fetch, and the
 * EMERGENCY RAIL — a breathing/anaphylaxis chip goes straight to emergency
 * guidance, never "we'll correlate it", and never a normal log flow.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithSession } from "../../test/session-harness";
import { SymptomQuickLog } from "./symptom-quick-log";

describe("SymptomQuickLog", () => {
  it("logs a non-emergency symptom in two taps (stubbed fetch)", async () => {
    const user = userEvent.setup();
    const { store } = renderWithSession(<SymptomQuickLog />);
    await user.click(screen.getByRole("button", { name: "Bloating", pressed: false }));
    // The severity slider appears; log it.
    expect(screen.getByRole("slider")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Log Bloating/i }));
    await waitFor(() => expect(screen.getByText(/Saved to your pod/i)).toBeInTheDocument());
    const symptoms = await store.allSymptoms();
    expect(symptoms).toHaveLength(1);
    expect(symptoms[0].symptomType).toBe("bloating");
  });

  it("triggers the emergency rail for a breathing symptom — never 'correlate'", async () => {
    const user = userEvent.setup();
    const { store } = renderWithSession(<SymptomQuickLog />);
    await user.click(screen.getByRole("button", { name: /Wheeze Breathing/i }));

    // Emergency guidance is shown…
    expect(screen.getByRole("alert")).toHaveTextContent(/medical emergency/i);
    expect(screen.getByText(/999/)).toBeInTheDocument();
    // …and it explicitly refuses to "correlate" it.
    expect(screen.getByText(/will not analyse or .*correlate/i)).toBeInTheDocument();
    // No normal log flow (no severity slider / log button, nothing written).
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Log / })).not.toBeInTheDocument();
    expect(await store.allSymptoms()).toHaveLength(0);
  });
});
