// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import type { JournalEntry } from "@jeswr/solid-journal";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JournalPage } from "../../src/apps/journal/components/journal-page";
import type { useJournal } from "../../src/apps/journal/state/journal-context";

vi.mock("../../src/apps/journal/state/journal-context", () => ({ useJournal: () => state }));
vi.mock("@/shell/app-frame", () => ({
  AppHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));
const entry: JournalEntry = {
  url: "https://pod.example/journal/one.ttl",
  etag: '"1"',
  title: "A good day",
  text: "[My notes](https://example.org/notes)",
  created: new Date("2026-11-11T12:00:00Z"),
};
let state: ReturnType<typeof useJournal>;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state = {
    entries: [entry],
    loading: false,
    error: false,
    saving: 0,
    failed: [],
    skipped: 0,
    needsPrivacy: false,
    privacyMessage: null,
    controller: { makePrivate: vi.fn(), discardFailed: vi.fn(), retryFailed: vi.fn() },
  } as unknown as ReturnType<typeof useJournal>;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<JournalPage />));
}
function button(name: string) {
  const value = [...document.querySelectorAll("button")].find((node) => node.textContent === name);
  if (!value) throw new Error(`Button missing: ${name}`);
  return value;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
it("explains privacy repair on the page error state and requires confirmation", async () => {
  state = { ...state, error: true, entries: [], needsPrivacy: true };
  await render();
  expect(host.textContent).toContain(
    "removes other people's access to the journal folder and its inherited entries",
  );
  await click("Make my journal private");
  expect(state.controller.makePrivate).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "removes other people's access",
  );
  await click("Cancel");
  expect(state.controller.makePrivate).not.toHaveBeenCalled();
  await click("Make my journal private");
  await click("Make private");
  expect(state.controller.makePrivate).toHaveBeenCalledOnce();
});
it("shows the actionable partial-scope explanation", async () => {
  state = {
    ...state,
    error: true,
    entries: [],
    privacyMessage:
      "The journal folder and its entries have different permissions. Review both in Drive before making your journal private.",
  };
  await render();
  expect(host.textContent).toContain("Review both in Drive");
});
it("offers Discard for a non-conflict failure and protects its rendered links", async () => {
  state.failed = [{ id: 7, key: entry.url, data: entry, existing: entry, conflict: false }];
  await render();
  const link = host.querySelector('a[href="https://example.org/notes"]');
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  await click("Discard mine");
  expect(state.controller.discardFailed).toHaveBeenCalledExactlyOnceWith(7);
});
it.each([
  "saved",
  "saving",
  "failed",
] as const)("protects reader links with %s edits", async (status) => {
  state.saving = status === "saving" ? 1 : 0;
  if (status === "failed")
    state.failed = [{ id: 7, key: entry.url, data: entry, existing: entry, conflict: true }];
  await render();
  await click("A good day");
  const link = document.querySelector('[role="dialog"] a[href="https://example.org/notes"]');
  expect(link?.getAttribute("target")).toBe(status === "saved" ? "_self" : "_blank");
  expect(link?.getAttribute("rel")).toBe(status === "saved" ? null : "noopener noreferrer");
});
it("protects editor preview links and the retained draft after closing the editor", async () => {
  await render();
  await click("New entry");
  const textarea = document.querySelector("textarea");
  if (!textarea) throw new Error("Missing editor");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      entry.text,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Preview");
  const link = document.querySelector('[aria-label="Markdown preview"] a');
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
  await click("Close");
  await click("A good day");
  expect(document.querySelector('[role="dialog"] a')?.getAttribute("target")).toBe("_blank");
});
