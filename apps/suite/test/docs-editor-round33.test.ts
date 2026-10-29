// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({
  runtime: null as DocumentPersistence | null,
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/docs/new",
}));
vi.mock("../src/apps/docs/hooks/use-document", () => ({
  useDocument: () => ({ runtime: mocks.runtime, error: null, recover: vi.fn() }),
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children, context }: { children: ReactNode; context: ReactNode }) =>
    createElement("div", null, context, children),
}));

import { DocumentEditor } from "../src/apps/docs/components/document-editor";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window.Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [new DOMRect()],
  });
  Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mountEditor() {
  const doc = new Doc();
  const session = { storageUrl: "https://pod.test/", fetch: vi.fn() } as unknown as PodSession;
  mocks.runtime = {
    doc,
    session,
    title: "Plan",
    state: "saved",
    localState: "saved",
    online: true,
    lastSaved: Date.now(),
    readOnly: false,
    capture: vi.fn(),
    flush: vi.fn(),
    change: vi.fn(),
    forceSave: vi.fn(),
  } as unknown as DocumentPersistence;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(DocumentEditor, { session, resource: undefined }),
      ),
    ),
  );
  const body = await vi.waitFor(() => {
    const body = host.querySelector<HTMLElement>('[aria-label="Document body"]');
    expect(body).not.toBeNull();
    return body as HTMLElement;
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(body));
  return {
    host,
    body,
    async close() {
      await act(async () => root.unmount());
      doc.destroy();
    },
  };
}

it.each([
  "Bold",
  "Italic",
  "Underline",
])("round33 empty-caret %s stored marks immediately update toolbar feedback", async (label) => {
  const view = await mountEditor();
  try {
    const button = view.host.querySelector<HTMLButtonElement>(
      `[role="toolbar"] [aria-label="${label}"]`,
    ) as HTMLButtonElement;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => button.click());
    expect(view.body.textContent).toBe("");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(mocks.runtime?.change).not.toHaveBeenCalled();
  } finally {
    await view.close();
  }
});

it("round33 shortcut-opened help restores editor focus after Close", async () => {
  const view = await mountEditor();
  try {
    await act(async () => {
      view.body.focus();
      view.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Keyboard shortcuts");
    await vi.waitFor(() =>
      expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull(),
    );
    await act(async () => {
      (document.querySelector('[role="dialog"] button') as HTMLButtonElement).click();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(view.body));
  } finally {
    await view.close();
  }
});
