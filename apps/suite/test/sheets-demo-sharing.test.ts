// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { createElement as h, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "../../../packages/solid-offline/node_modules/fake-indexeddb";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { SheetsList } from "../src/apps/sheets/components/sheets-list";
import { workbookHref } from "../src/apps/sheets/components/sheets-sidebar";
import { WorkbookSharingAdapter } from "../src/apps/sheets/lib/sharing";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { WorkbookServiceProvider } from "../src/apps/sheets/state/service";
import { resetDemoPod } from "../src/lib/demo-pod/browser";
import { ABSENT } from "../src/lib/session/extension-session";
import { SessionContext } from "../src/lib/session/shell-pod-session";
import type { SessionState } from "../src/lib/session/types";
import { DemoBackend } from "../src/shell/session/demo-backend";

const PERSON = "https://bob.example/profile/card#me";
const signal = () => new AbortController().signal;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children }: { children: ReactNode }) => h("main", {}, children),
}));

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
});
afterEach(async () => {
  cleanup();
  await resetDemoPod();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function select(label: string, option: string) {
  const control = screen.getByRole("combobox", { name: label }) as HTMLButtonElement;
  await waitFor(() => expect(control.disabled).toBe(false));
  fireEvent.keyDown(control, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

it("persists people, roles and general access through the demo backend and copies the workbook link", async () => {
  const backend = new DemoBackend();
  const account = await backend.signIn();
  const fetch = backend.fetchFor();
  const session = {
    mode: "demo" as const,
    fetch,
    storageUrl: account.storageUrl,
    webId: account.webId,
    displayName: account.name,
    subscribe: () => () => {},
    reset: resetDemoPod,
  };
  const state: SessionState = {
    status: "ready",
    session,
    extension: ABSENT,
    connectExtension: async () => {},
  };
  const service = createWorkbookService({
    fetch,
    podRoot: account.storageUrl,
    webId: account.webId,
  });
  const book = await service.create({ title: "Demo sharing" });
  const rootAcl = await (await fetch(`${account.storageUrl}.acl`)).text();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const view = render(
    h(
      SessionContext.Provider,
      { value: state },
      // biome-ignore lint/correctness/noChildrenProp: The provider requires children in its props type.
      h(WorkbookServiceProvider, { session, children: h(SheetsList) }),
    ),
  );
  fireEvent.keyDown(await screen.findByRole("button", { name: "Actions for Demo sharing" }), {
    key: "ArrowDown",
  });
  const share = await screen.findByRole("menuitem", { name: "Share" });
  expect(share.getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.click(share);
  await screen.findByRole("heading", { name: "People with access" });
  expect(screen.getByRole("listitem", { name: account.webId }).textContent).toContain("Owner");
  expect(screen.queryByRole("combobox", { name: `Role for ${account.webId}` })).toBeNull();

  const picker = screen.getByRole("combobox", { name: "Add people" });
  fireEvent.change(picker, { target: { value: PERSON } });
  fireEvent.keyDown(picker, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByRole("listitem", { name: PERSON });
  const adapter = new WorkbookSharingAdapter(session);
  expect((await adapter.load(book.container, signal())).people).toContainEqual({
    webId: PERSON,
    role: "viewer",
  });
  await select(`Role for ${PERSON}`, "Editor");
  await waitFor(async () =>
    expect((await adapter.load(book.container, signal())).people).toContainEqual({
      webId: PERSON,
      role: "editor",
    }),
  );
  await select(`Role for ${PERSON}`, "Viewer");
  await waitFor(async () =>
    expect((await adapter.load(book.container, signal())).people).toContainEqual({
      webId: PERSON,
      role: "viewer",
    }),
  );
  await select("General access", "Anyone with the link");
  await screen.findByRole("combobox", { name: "General access role" });
  await select("General access role", "Editor");
  await waitFor(async () =>
    expect((await adapter.load(book.container, signal())).general).toEqual({
      mode: "link",
      role: "editor",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Link copied");
  expect(writeText).toHaveBeenCalledWith(new URL(workbookHref(book.container), location.href).href);

  // A new adapter reads durable ACL state, rather than dialog-local memory.
  const reloaded = new WorkbookSharingAdapter({ ...session, fetch: new DemoBackend().fetchFor() });
  expect(await reloaded.load(book.container, signal())).toMatchObject({
    people: [
      { webId: account.webId, role: "owner" },
      { webId: PERSON, role: "viewer" },
    ],
    general: { mode: "link", role: "editor" },
    canManage: true,
  });
  await select("General access role", "Viewer");
  await waitFor(async () =>
    expect((await reloaded.load(book.container, signal())).general).toEqual({
      mode: "link",
      role: "viewer",
    }),
  );
  await select("General access", "Restricted");
  await waitFor(() =>
    expect(screen.queryByRole("combobox", { name: "General access role" })).toBeNull(),
  );
  await select(`Role for ${PERSON}`, "Remove access");
  await waitFor(() => expect(screen.queryByRole("listitem", { name: PERSON })).toBeNull());
  view.unmount();
  expect(await reloaded.load(book.container, signal())).toEqual({
    people: [{ webId: account.webId, role: "owner" }],
    general: { mode: "restricted" },
    canManage: true,
  });
  expect(await (await fetch(`${account.storageUrl}.acl`)).text()).toBe(rootAcl);
});
