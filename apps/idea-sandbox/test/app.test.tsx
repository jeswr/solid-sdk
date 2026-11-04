// AUTHORED-BY Claude Opus 5.5
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

async function go(hash: string) {
  await act(async () => {
    location.hash = `#${hash}`;
    dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeAll(() => {
  // Reduced motion: traces appear at once instead of step by step.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  cleanup();
  await go("home");
});

describe("IDEA sandbox app", () => {
  it("plays a story as a trace: the planted refund is blocked and the log verifies", async () => {
    render(<App />);
    await go("story/injected-refund");
    await waitFor(() => expect(screen.getAllByText("Blocked by policy").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Policy check passed").length).toBeGreaterThan(0);
    expect(screen.getByText(/The ticket says this customer is a VIP/)).toBeTruthy();

    await go("record");
    expect(await screen.findByText(/entries check out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try to rewrite the first entry" }));
    expect(screen.getByText(/The log has been changed: entry 0/)).toBeTruthy();
  });

  it("states the rules in plain English from the policy", async () => {
    render(<App />);
    await go("rules");
    expect(screen.getByText("May never sign agreements.")).toBeTruthy();
    expect(screen.getByText("Send at most 5 messages a day; then it stops.")).toBeTruthy();
  });

  it("asks the MCP lockdown proxy what it offers, and locking a system hides its tools", async () => {
    render(<App />);
    await go("systems");
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
    await go("systems");
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
    await go("compare");
    fireEvent.click(screen.getByRole("button", { name: "Try every route" }));
    expect(
      await screen.findByText(/No route behaves differently/, {}, { timeout: 20_000 }),
    ).toBeTruthy();
  });
});

describe("merge-gate fixes", () => {
  it("a story in progress survives a visit to another page", async () => {
    render(<App />);
    await go("story/injected-refund");
    await waitFor(() => expect(screen.getAllByText("Blocked by policy").length).toBeGreaterThan(0));
    const before = document.querySelectorAll(".trace-list > li").length;
    expect(before).toBeGreaterThan(2);
    await go("rules");
    expect(screen.queryAllByText("Blocked by policy")).toHaveLength(0);
    await go("story/injected-refund");
    expect(screen.getAllByText("Blocked by policy").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".trace-list > li").length).toBe(before);
  });
});

describe("automations", () => {
  it("drafts a rule from a request, shows it in the pop-up, and runs it once turned on", async () => {
    render(<App />);
    await go("home");
    fireEvent.click(screen.getByRole("button", { name: "Turn support emails into Jira issues" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New automation rule")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("tab", { name: "Systems" }));
    expect(within(dialog).getAllByText("hidden from this rule").length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("tab", { name: "Policies" }));
    expect(within(dialog).getByText(/Harbour & Finch's rules for every automation/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Turn on/ }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      await screen.findByRole("button", { name: "Run on Jon Baker: Still waiting on my refund" }),
    );
    await waitFor(() => expect(screen.getAllByText("Blocked by policy").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Policy check passed").length).toBeGreaterThan(0);
  });

  it("the meeting rule replies to the person who asked, with the booking link", async () => {
    render(<App />);
    await go("automation/meeting-replies");
    fireEvent.click(screen.getByRole("button", { name: "Run on Nadia Price: Coffee next week?" }));
    await waitFor(() =>
      expect(screen.getAllByText("Policy check passed").length).toBeGreaterThan(0),
    );
    const panel = screen.getByRole("complementary", { name: "What happened in the apps" });
    expect(within(panel).getByText("nadia.price@example.org")).toBeTruthy();
  });
});

describe("automation runs", () => {
  it("each automation keeps its own runs, across a visit to another page", async () => {
    render(<App />);
    await go("automation/meeting-replies");
    fireEvent.click(screen.getByRole("button", { name: "Run on Nadia Price: Coffee next week?" }));
    const run = { name: /Nadia Price: Coffee next week\?/ };
    await screen.findByRole("heading", run);
    await go("rules");
    await go("automation/meeting-replies");
    expect(screen.getByRole("heading", run)).toBeTruthy();
    // A different automation does not show this one's runs.
    await go("home");
    fireEvent.click(screen.getByRole("button", { name: "Turn support emails into Jira issues" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Turn on/ }));
    await screen.findByRole("button", { name: "Run on Jon Baker: Still waiting on my refund" });
    expect(screen.queryByRole("heading", run)).toBeNull();
  });
});

describe("the mortgage story", () => {
  it("plays three agents: the insurer share and the health record are blocked, offers wait for people", async () => {
    render(<App />);
    await go("mortgage");
    await waitFor(() => expect(screen.getByText(/What this shows/)).toBeTruthy());
    expect(screen.getAllByText("Blocked by policy")).toHaveLength(2);
    expect(screen.getByText(/Ruth Okafor \(senior underwriter\) approved/)).toBeTruthy();
    expect(screen.getByText(/at 4.1% over 25 years, accepted/)).toBeTruthy();
    expect(screen.queryAllByText(/✕/)).toHaveLength(0);
    expect(screen.getAllByText(/✓ What Alex and Northgate want/).length).toBeGreaterThan(5);
  });
});
