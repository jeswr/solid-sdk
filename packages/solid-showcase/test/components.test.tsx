// AUTHORED-BY Claude Fable 5
// @vitest-environment jsdom
/**
 * Walkthrough UI building blocks: keyboard stepper, try-live honest degradation,
 * launcher placeholder-link pattern, ecosystem-map selection, persona-card copy actions.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ChapterPlayer } from "../src/components/chapter-player.js";
import { DemoIdentityCard } from "../src/components/demo-identity-card.js";
import { EcosystemMap } from "../src/components/ecosystem-map.js";
import { Launcher } from "../src/components/launcher.js";
import { TryLiveButton } from "../src/components/try-live.js";
import { exampleWalkthrough } from "./support/example-document.js";

const registry = exampleWalkthrough.registry;
const firstChapter = exampleWalkthrough.chapters[0];
if (firstChapter === undefined) throw new Error("fixture drift");

function stubFetch(handler: (path: string) => Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => handler(String(input))),
  );
}

const live = () => Promise.resolve(Response.json({ ok: true, service: "x", simulated: true }));
const down = () => Promise.reject(new Error("unreachable"));
const forever = () => new Promise<Response>(() => {});

beforeEach(() => {
  stubFetch(down);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChapterPlayer — keyboard stepper", () => {
  test("advances with next/previous controls and step dots", () => {
    const { container } = render(<ChapterPlayer chapter={firstChapter} registry={registry} />);
    expect(container.querySelector("[data-chapter-player='pack-the-vault']")).not.toBeNull();
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Open the vault");

    fireEvent.click(screen.getByRole("button", { name: "Next step →" }));
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next step →" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "← Previous step" }));
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();

    const dot2 = screen.getByRole("button", { name: "Step 2: Grant the permit desk access" });
    fireEvent.click(dot2);
    expect(dot2.getAttribute("aria-current")).toBe("step");
  });

  test("arrow keys drive the stepper", () => {
    render(<ChapterPlayer chapter={firstChapter} registry={registry} />);
    const stepper = screen.getByRole("navigation", { name: "Steps in this chapter" });
    fireEvent.keyDown(stepper, { key: "ArrowRight" });
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
    fireEvent.keyDown(stepper, { key: "ArrowLeft" });
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();
  });

  test("renders the underneath panel when present", () => {
    const { container } = render(<ChapterPlayer chapter={firstChapter} registry={registry} />);
    const panel = container.querySelector("[data-underneath-panel]");
    expect(panel?.textContent).toContain("What just happened underneath");
    expect(panel?.textContent).toContain("signed receipt");
  });
});

describe("TryLiveButton — honest degradation", () => {
  test("live zone renders a real deep link", async () => {
    stubFetch(live);
    const { container } = render(
      <TryLiveButton app="vault" label="Open the Traveller Vault" registry={registry} />,
    );
    await waitFor(() => {
      const anchor = container.querySelector("a[data-try-live='vault']");
      expect(anchor?.getAttribute("href")).toBe("/vault");
    });
    expect(container.querySelector("[data-try-live-disabled]")).toBeNull();
  });

  test("while checking, the control is a visible placeholder link", () => {
    stubFetch(forever);
    const { container } = render(
      <TryLiveButton app="vault" label="Open the Traveller Vault" registry={registry} />,
    );
    const anchor = container.querySelector("a[data-try-live='vault']");
    expect(anchor?.getAttribute("href")).toBeNull();
    expect(anchor?.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Checking whether this app is deployed…");
  });

  test("an undeployed zone stays visible, disabled, and explained — never navigable", async () => {
    stubFetch(down);
    const { container } = render(
      <TryLiveButton app="vault" label="Open the Traveller Vault" registry={registry} />,
    );
    await waitFor(() => {
      expect(container.textContent).toContain(
        "Traveller Vault is not deployed in this environment",
      );
    });
    const anchor = container.querySelector("a[data-try-live='vault']");
    expect(anchor?.getAttribute("href")).toBeNull();
    expect(anchor?.getAttribute("aria-disabled")).toBe("true");
    expect(anchor?.hasAttribute("data-try-live-disabled")).toBe(true);
  });
});

describe("Launcher — placeholder-link pattern", () => {
  test("lists every launcherOrder app; undeployed entries are placeholder links", async () => {
    stubFetch((path) => (path === "/api/health" ? live() : down()));
    const { container } = render(<Launcher registry={registry} />);
    fireEvent.click(screen.getByRole("button", { name: "Apps" }));

    const dock = container.querySelector("[data-launcher]");
    expect(dock).not.toBeNull();
    const entries = [...(dock?.querySelectorAll("[data-launcher-app]") ?? [])];
    expect(entries.map((entry) => entry.getAttribute("data-launcher-app"))).toEqual([
      "atlas",
      "vault",
      "permits",
      "outfitter",
      "advisory",
    ]);

    // atlas + advisory probe /api/health (live); zone apps are down → placeholder links.
    await waitFor(() => {
      const atlas = dock?.querySelector("[data-launcher-app='atlas']");
      expect(atlas?.getAttribute("href")).toBe("/");
    });
    const vault = dock?.querySelector("[data-launcher-app='vault']");
    expect(vault?.getAttribute("href")).toBeNull();
    expect(vault?.getAttribute("aria-disabled")).toBe("true");
    expect(dock?.textContent).toContain(
      "Zones marked “Not deployed” are not wired in this environment.",
    );
  });
});

describe("EcosystemMap — selection", () => {
  test("centre is selected by default; clicking a seat updates the detail panel", () => {
    const { container } = render(<EcosystemMap registry={registry} />);
    const centre = container.querySelector("[data-map-center]");
    expect(centre?.getAttribute("aria-pressed")).toBe("true");
    const detail = container.querySelector("[data-map-detail]");
    expect(detail?.textContent).toContain("Traveller");
    expect(detail?.textContent).toContain("modelled on Cairn Cooperative");

    const permitNode = container.querySelector("[data-map-node='permit-authority']");
    if (permitNode === null) throw new Error("missing map node");
    fireEvent.click(permitNode);
    expect(permitNode.getAttribute("aria-pressed")).toBe("true");
    expect(centre?.getAttribute("aria-pressed")).toBe("false");
    expect(detail?.textContent).toContain("Role 1 · Permit authority");
    expect(detail?.textContent).toContain("Issues day permits");
    expect(detail?.querySelector("[data-try-live='permits']")).not.toBeNull();
  });

  test("a mapped-but-unbuilt seat says so honestly", () => {
    const { container } = render(<EcosystemMap registry={registry} />);
    const stewards = container.querySelector("[data-map-node='stewards']");
    if (stewards === null) throw new Error("missing map node");
    expect(stewards.textContent).toContain("Mapped seat — no app in this demo");
    fireEvent.click(stewards);
    const detail = container.querySelector("[data-map-detail]");
    expect(detail?.querySelector("[data-map-no-app]")?.textContent).toContain(
      "no application in this demo",
    );
  });
});

describe("DemoIdentityCard — copy actions", () => {
  test("copies a field value and confirms; non-copyable fields render no button", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { container } = render(<DemoIdentityCard persona={exampleWalkthrough.persona} />);
    expect(container.querySelector("[data-demo-identity-card]")).not.toBeNull();
    expect(container.textContent).toContain("Fictional persona — every value is simulated.");
    expect(container.textContent).toContain(
      "Values are pinned to the walkthrough's scripted checks.",
    );

    const buttons = screen.getAllByRole("button", { name: "Copy" });
    // Three fields, one of which (Emergency contact) is copyable: false.
    expect(buttons).toHaveLength(2);
    const first = buttons[0];
    if (first === undefined) throw new Error("missing copy button");
    fireEvent.click(first);
    expect(writeText).toHaveBeenCalledWith("Rowan Vale");
    await waitFor(() => {
      expect(first.textContent).toBe("Copied");
    });

    const contactRow = within(container as HTMLElement).getByText("Emergency contact");
    expect(contactRow.parentElement?.parentElement?.querySelector("button")).toBeNull();
  });
});
