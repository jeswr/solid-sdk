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

describe("second pass", () => {
  it("asking a person for one action marks it and moves it to ask in the Claude Code settings", async () => {
    render(<App />);
    await openTab("systems");
    const radios = screen.getAllByRole("radio", { name: "Ask a person" });
    const refund = radios.find((r) => r.getAttribute("name") === "choice-payments_refund");
    if (!refund) throw new Error("no refund choice");
    fireEvent.click(refund);
    await waitFor(() => expect(screen.getAllByText("Ask first").length).toBeGreaterThan(0));
    const managed = screen.getByText(/allowManagedMcpServersOnly/).textContent ?? "";
    const settings = JSON.parse(managed) as { permissions: { ask: string[]; deny: string[] } };
    expect(settings.permissions.ask).toContain("mcp__harbour-finch__payments_refund");
    expect(settings.permissions.deny).toContain("mcp__harbour-finch__db_delete_rows");
  });

  it("tries every refused action by every route", async () => {
    render(<App />);
    await openTab("compare");
    fireEvent.click(screen.getByRole("button", { name: "Try every route" }));
    expect(
      await screen.findByText(/No route behaves differently/, {}, { timeout: 20_000 }),
    ).toBeTruthy();
  });
});

describe("merge-gate fixes", () => {
  it("a story in progress survives a visit to another tab", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("A planted instruction"));
    fireEvent.click(screen.getByRole("button", { name: "Play all" }));
    await waitFor(() => expect(screen.getAllByText("Stop").length).toBeGreaterThan(0));
    const before = document.querySelectorAll(".timeline > li").length;
    expect(before).toBeGreaterThan(2);
    await openTab("rules");
    expect(screen.queryAllByText("Stop")).toHaveLength(0);
    await openTab("stories");
    expect(screen.getAllByText("Stop").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".timeline > li").length).toBe(before);
  });
});
