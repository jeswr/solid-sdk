// @vitest-environment jsdom
// AUTHORED-BY Codex
import { TooltipProvider } from "@jeswr/suite-ui";
import { getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
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
  SuiteFrame: ({
    children,
    context,
    actions,
  }: {
    children: ReactNode;
    context: ReactNode;
    actions: ReactNode;
  }) => createElement("div", null, context, actions, children),
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

async function mountEditor(initial?: JSONContent) {
  const session = {
    storageUrl: "https://pod.test/",
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
  } as unknown as PodSession;
  const doc = initial
    ? prosemirrorJSONToYDoc(getSchema(baseExtensions(session.fetch)), initial)
    : new Doc();
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

it.each([
  "ctrlKey",
  "metaKey",
])("round34 %s+F refocuses the open Find field without clearing its query", async (modifier) => {
  const view = await mountEditor();
  const shortcut = () =>
    view.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  try {
    await act(async () => {
      shortcut();
    });
    const input = view.host.querySelector<HTMLInputElement>(
      ".docs-find-bar input",
    ) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "kept query",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      view.body.focus();
    });
    expect(document.activeElement).toBe(view.body);
    await act(async () => {
      shortcut();
    });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("kept query");
    expect(view.body.textContent).toBe("");
  } finally {
    await view.close();
  }
});

async function menuItem(trigger: HTMLElement, label: string) {
  await act(async () =>
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
  );
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (node) => node.textContent?.startsWith(label),
  );
  expect(item).toBeDefined();
  await act(async () => {
    item?.focus();
    item?.click();
  });
}

it("round36 toolbar Find keeps typing focus and never edits the document", async () => {
  const view = await mountEditor();
  try {
    await menuItem(
      view.host.querySelector('[aria-label="More formatting"]') as HTMLElement,
      "Find and replace",
    );
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    const input = view.host.querySelector<HTMLInputElement>(
      ".docs-find-bar input",
    ) as HTMLInputElement;
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    await act(async () => {
      const focused = document.activeElement as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        focused,
        "settings",
      );
      focused.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("settings");
    expect(view.body.textContent).toBe("");
    expect(mocks.runtime?.change).not.toHaveBeenCalled();
  } finally {
    await view.close();
  }
});

it.each([
  "Link",
  "Insert image",
  "Word count",
])("round36 toolbar %s opens its control after the menu closes", async (label) => {
  const view = await mountEditor();
  try {
    await menuItem(view.host.querySelector('[aria-label="More formatting"]') as HTMLElement, label);
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    if (label === "Insert image") {
      const input = view.host.querySelector('input[type="file"]') as HTMLInputElement;
      await act(async () => {
        Object.defineProperty(input, "files", {
          value: [new File(["image"], "image.png", { type: "image/png" })],
        });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await vi.waitFor(() =>
      expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull(),
    );
    expect(view.body.textContent).toBe("");
    expect(mocks.runtime?.change).not.toHaveBeenCalled();
  } finally {
    await view.close();
  }
});

it("round36 the dynamic Alt text menu action preserves its control's focus", async () => {
  const view = await mountEditor({
    type: "doc",
    content: [
      { type: "image", attrs: { src: "https://pod.test/image.png", alt: "Existing image" } },
    ],
  });
  try {
    await menuItem(
      view.host.querySelector('[aria-label="More formatting"]') as HTMLElement,
      "Alt text",
    );
    await vi.waitFor(() =>
      expect(document.activeElement?.closest('[aria-label="Image alt text"]')).not.toBeNull(),
    );
  } finally {
    await view.close();
  }
});

it("round36 cancelling menu-opened Import restores the File menu trigger", async () => {
  const view = await mountEditor();
  try {
    const trigger = view.host.querySelector('[aria-label="File menu"]') as HTMLElement;
    await menuItem(trigger, "Import to replace…");
    await vi.waitFor(() =>
      expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull(),
    );
    const cancel = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ).find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  } finally {
    await view.close();
  }
});
