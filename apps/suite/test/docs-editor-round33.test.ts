// @vitest-environment jsdom
// AUTHORED-BY Codex

import { File as NodeFile } from "node:buffer";
import { TooltipProvider } from "@jeswr/suite-ui";
import { getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { TitleConflictError } from "../src/apps/docs/lib/model";
import type { PodSession } from "../src/lib/session/pod-session";

const mocks = vi.hoisted(() => ({
  runtime: null as DocumentPersistence | null,
  router: { push: vi.fn(), replace: vi.fn() },
  remove: vi.fn(),
  restore: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@jeswr/suite-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
vi.mock("../src/apps/docs/editor/operations", () => ({
  deleteDocument: mocks.remove,
  restoreDocument: mocks.restore,
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

async function mountEditor(initial?: JSONContent, storedUrl?: string) {
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
    ...(storedUrl ? { stored: { url: storedUrl } } : {}),
  } as unknown as DocumentPersistence;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(DocumentEditor, { session, resource: undefined }),
      ),
    );
  await act(async () => render());
  const body = await vi.waitFor(() => {
    const body = host.querySelector<HTMLElement>('[aria-label="Document body"]');
    expect(body).not.toBeNull();
    return body as HTMLElement;
  });
  if (!storedUrl) await vi.waitFor(() => expect(document.activeElement).toBe(body));
  return {
    host,
    body,
    async refresh() {
      await act(async () => render());
    },
    async close() {
      await act(async () => root.unmount());
      doc.destroy();
    },
  };
}

it("round38 save-error dialog restores focus to its invoking Why button", async () => {
  const view = await mountEditor(undefined, "https://pod.test/docs/plan.ttl");
  try {
    const runtime = mocks.runtime as DocumentPersistence;
    runtime.state = "failed";
    await view.refresh();
    const why = Array.from(view.host.querySelectorAll("button")).find(
      (button) => button.textContent === "Why?",
    ) as HTMLButtonElement;
    await act(async () => {
      why.focus();
      why.click();
    });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Couldn't save");
    await act(async () =>
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(why));
  } finally {
    await view.close();
  }
});

it("round38 resolving a title-conflict dialog restores the previously focused editor", async () => {
  const view = await mountEditor(undefined, "https://pod.test/docs/plan.ttl");
  try {
    const runtime = mocks.runtime as DocumentPersistence;
    view.body.focus();
    runtime.conflict = new TitleConflictError("https://pod.test/docs/plan.ttl", "Mine", "Theirs");
    runtime.resolveTitle = vi.fn(async () => {
      runtime.conflict = undefined;
    });
    await view.refresh();
    const keep = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (button) => button.textContent === "Keep mine",
    ) as HTMLButtonElement;
    expect(keep).toBeDefined();
    await act(async () => keep.click());
    await view.refresh();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(view.body));
  } finally {
    await view.close();
  }
});

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

it.each([
  "no warnings",
  "Open document",
  "Escape",
])("round37 completed replacement keeps editor focus after %s teardown", async (completion) => {
  const view = await mountEditor();
  try {
    await menuItem(
      view.host.querySelector('[aria-label="File menu"]') as HTMLElement,
      "Import to replace…",
    );
    const input = document.querySelector('[role="dialog"] input[type="file"]') as HTMLInputElement;
    const source =
      completion === "no warnings"
        ? "Replacement"
        : "Replacement\n\n![Unsafe](data:image/png;base64,x)";
    await act(async () => {
      Object.defineProperty(input, "files", { value: [new NodeFile([source], "plan.md")] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const replace = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ).find((button) => button.textContent === "Replace contents");
    await act(async () => replace?.click());
    if (completion !== "no warnings") {
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Some items weren't imported",
      );
      await act(async () => {
        if (completion === "Escape")
          document.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          );
        else
          Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
            .find((button) => button.textContent === "Open document")
            ?.click();
      });
    }
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(view.body));
    expect(view.body.textContent).toContain("Replacement");
  } finally {
    await view.close();
  }
});

it("round37 editor Undo opens the restored document instead of a reused original URL", async () => {
  const url = "https://pod.test/docs/plan.ttl";
  const view = await mountEditor(undefined, url);
  const restoredUrl = "https://pod.test/docs/plan%20(restored).ttl";
  const entry = {
    url: "https://pod.test/drive/.trash/slot/plan.ttl",
    original: url,
    name: "plan.ttl",
    trashedAt: new Date(),
  };
  mocks.remove.mockResolvedValue({ done: [entry], failed: [] });
  mocks.restore.mockResolvedValue({
    done: [{ entry, url: restoredUrl, renamed: true }],
    failed: [],
  });
  try {
    await menuItem(
      view.host.querySelector('[aria-label="File menu"]') as HTMLElement,
      "Move to trash",
    );
    const confirm = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ).find((button) => button.textContent === "Move to trash");
    expect(confirm).toBeDefined();
    await act(async () => confirm?.click());
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    await act(async () => mocks.toast.mock.calls.at(-1)?.[1].action.onClick());
    const { encodeRef } = await import("../src/lib/refs");
    expect(mocks.router.push).toHaveBeenLastCalledWith(`/docs/d/${encodeRef(restoredUrl)}`);
  } finally {
    await view.close();
  }
});
