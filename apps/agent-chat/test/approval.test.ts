// @vitest-environment jsdom
// AUTHORED-BY Codex GPT-6
import { webcrypto } from "node:crypto";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { ApprovalSheet } from "../src/ui/approval.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function button(name: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent) === name,
  );
  if (!match) throw new Error(`Button not found: ${name}`);
  return match;
}

function hold(name: string) {
  act(() => {
    button(`${name} (press and hold)`).dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
  });
  expect(button(`${name} (press and hold)`).textContent).toBe("Keep holding…");
}

describe("approval holds", () => {
  it.each([
    { terms: "share selection", start: "Share 3", edit: "Share Employer", updated: "Share 2" },
    {
      terms: "limit draft",
      start: "Hold to set limit",
      edit: "Allowance",
      updated: "Hold to set limit",
    },
  ])("requires a fresh hold after the $terms changes", async ({ terms, start, edit, updated }) => {
    const engine = new Engine({ pace: 0, demoMode: true });
    await engine.ready;
    const chatId = engine.getState().activeChat;
    const sharing = terms === "share selection";
    const action = sharing ? engine.mortgageApply(chatId) : engine.buy(chatId, "p:socks");
    try {
      const request = await vi.waitFor(() => {
        const request = engine.getState().pending?.request;
        if (!request) throw new Error("Approval has not opened");
        return request;
      });
      act(() =>
        root.render(
          createElement(ApprovalSheet, { request, engine, products: [], onClose: vi.fn() }),
        ),
      );
      if (!sharing) act(() => button("Set a spending limit").click());
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      hold(start);
      act(() => vi.advanceTimersByTime(600));
      act(() => button(edit).click());
      act(() => vi.advanceTimersByTime(1200));
      expect(container.querySelector('[aria-label="Confirm it is you"]')).toBeNull();
      expect(button(`${updated} (press and hold)`).textContent).toBe(updated);

      hold(updated);
      act(() => vi.advanceTimersByTime(1200));
      expect(container.querySelector('[aria-label="Confirm it is you"]')).not.toBeNull();
    } finally {
      engine.stop();
      await action.catch(() => undefined);
    }
  });
});
