// AUTHORED-BY Claude Opus 5.5
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

async function openTab(id: string) {
  await act(async () => {
    location.hash = `#${id}`;
    dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

afterEach(async () => {
  cleanup();
  await openTab("stories");
});

describe("IDEA sandbox app", () => {
  it("plays a story: the planted refund is stopped and the log verifies", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("A planted instruction"));
    fireEvent.click(screen.getByRole("button", { name: "Play all" }));
    await waitFor(() => expect(screen.getAllByText("Stop").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Allowed").length).toBeGreaterThan(0);

    await openTab("record");
    expect(await screen.findByText(/entries check out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try to rewrite the first entry" }));
    expect(screen.getByText(/The log has been changed: entry 0/)).toBeTruthy();
  });

  it("states the rules in plain English from the policy", async () => {
    render(<App />);
    await openTab("rules");
    expect(screen.getByText("May never sign agreements.")).toBeTruthy();
    expect(screen.getByText("Send at most 5 messages a day; then it stops.")).toBeTruthy();
  });

  it("asks the MCP lockdown proxy what it offers, and locking a system hides its tools", async () => {
    render(<App />);
    await openTab("systems");
    expect(await screen.findByText(/14 of 17 tools offered/)).toBeTruthy();
    const payments = screen.getByRole("heading", { name: "Payments" }).closest(".system");
    const toggle = payments?.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (!toggle) throw new Error("no system toggle");
    fireEvent.click(toggle);
    expect(await screen.findByText(/13 of 17 tools offered/)).toBeTruthy();
  });
});
