// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { beforeEach, describe, expect, it } from "vitest";
import { JeswrEmptyState } from "../src/components/empty-state.js";
import { JeswrErrorState } from "../src/components/error-state.js";
import { JeswrLoading } from "../src/components/loading.js";
import { JeswrSavingIndicator } from "../src/components/saving-indicator.js";

async function mount<T extends HTMLElement>(tag: string, attrs: Record<string, string> = {}) {
  const el = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("<jeswr-empty-state>", () => {
  it("registers", () => {
    expect(customElements.get("jeswr-empty-state")).toBe(JeswrEmptyState);
  });
  it("renders the heading + description props", async () => {
    const el = await mount<JeswrEmptyState>("jeswr-empty-state", {
      heading: "No files yet",
      description: "Upload something to begin.",
    });
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("No files yet");
    expect(el.shadowRoot?.querySelector(".desc")?.textContent).toBe("Upload something to begin.");
  });
  it("exposes named slots for icon/title/description/action", async () => {
    const el = await mount<JeswrEmptyState>("jeswr-empty-state");
    const slotNames = Array.from(el.shadowRoot?.querySelectorAll("slot") ?? []).map((s) =>
      s.getAttribute("name"),
    );
    expect(slotNames).toEqual(expect.arrayContaining(["icon", "title", "description", "action"]));
  });
});

describe("<jeswr-error-state>", () => {
  it("registers", () => {
    expect(customElements.get("jeswr-error-state")).toBe(JeswrErrorState);
  });
  it("has role=alert and a default destructive icon", async () => {
    const el = await mount<JeswrErrorState>("jeswr-error-state", { heading: "Something failed" });
    expect(el.shadowRoot?.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Something failed");
    // Default icon present when no icon slot supplied.
    expect(el.shadowRoot?.querySelector(".default-icon")).not.toBeNull();
  });
  it("references the destructive token in its styles", () => {
    const cssText = JeswrErrorState.styles
      .map((s) => (s as { cssText?: string }).cssText ?? "")
      .join("\n");
    expect(cssText).toContain("--jeswr-destructive");
  });
});

describe("<jeswr-loading>", () => {
  it("registers", () => {
    expect(customElements.get("jeswr-loading")).toBe(JeswrLoading);
  });
  it("renders a spinner and a role=status with the label as accessible name", async () => {
    const el = await mount<JeswrLoading>("jeswr-loading", { label: "Loading files" });
    expect(el.shadowRoot?.querySelector(".spinner")).not.toBeNull();
    const status = el.shadowRoot?.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Loading files");
  });
  it("respects prefers-reduced-motion in its styles", () => {
    const cssText = JeswrLoading.styles
      .map((s) => (s as { cssText?: string }).cssText ?? "")
      .join("\n");
    expect(cssText).toContain("prefers-reduced-motion: reduce");
  });
});

describe("<jeswr-saving-indicator>", () => {
  it("registers", () => {
    expect(customElements.get("jeswr-saving-indicator")).toBe(JeswrSavingIndicator);
  });
  it("idle renders no visible label", async () => {
    const el = await mount<JeswrSavingIndicator>("jeswr-saving-indicator", { state: "idle" });
    expect(el.shadowRoot?.querySelector(".status.error")).toBeNull();
    // No spinner / glyph / label content in the idle state (the only rendered
    // node is an empty polite live region). Asserting on the absence of the
    // content parts avoids jsdom folding the <style> text into `textContent`.
    expect(el.shadowRoot?.querySelector('[part="label"]')).toBeNull();
    expect(el.shadowRoot?.querySelector(".spinner")).toBeNull();
    expect(el.shadowRoot?.querySelector('[part="glyph"]')).toBeNull();
  });
  it("saving shows a spinner + Saving…", async () => {
    const el = await mount<JeswrSavingIndicator>("jeswr-saving-indicator", { state: "saving" });
    expect(el.shadowRoot?.querySelector(".spinner")).not.toBeNull();
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe("Saving…");
  });
  it("saved shows a check + Saved", async () => {
    const el = await mount<JeswrSavingIndicator>("jeswr-saving-indicator", { state: "saved" });
    expect(el.shadowRoot?.querySelector('[part="glyph"]')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe("Saved");
  });
  it("error shows the destructive style + Error", async () => {
    const el = await mount<JeswrSavingIndicator>("jeswr-saving-indicator", { state: "error" });
    expect(el.shadowRoot?.querySelector(".status.error")).not.toBeNull();
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe("Error");
  });
  it("allows custom labels", async () => {
    const el = await mount<JeswrSavingIndicator>("jeswr-saving-indicator", {
      state: "saving",
      "saving-label": "Syncing…",
    });
    expect(el.shadowRoot?.querySelector('[part="label"]')?.textContent).toBe("Syncing…");
  });
  it("treats an unknown state as idle (fail-safe)", async () => {
    const el = await mount<JeswrSavingIndicator>("jeswr-saving-indicator", { state: "weird" });
    expect(el.shadowRoot?.querySelector('[part="label"]')).toBeNull();
    expect(el.shadowRoot?.querySelector(".spinner")).toBeNull();
  });
});
