// @vitest-environment jsdom
// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { TooltipProvider } from "@jeswr/suite-ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentList } from "../src/apps/docs/components/document-list";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { useDocument } from "../src/apps/docs/hooks/use-document";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
  usePathname: () => "/docs/new",
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ children }: { children: ReactNode }) => children,
}));
const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.params = new URLSearchParams();
  window.history.replaceState({}, "", "/docs/new");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function session(): Promise<PodSession> {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  return {
    mode: "demo",
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
}
it("lists separate orphaned drafts with links that resume their own URL identities", async () => {
  const account = await session();
  for (const id of ["first", "second"]) {
    const draft = new DocumentPersistence(account, id);
    await draft.open();
    draft.online = false;
    draft.rename(`Draft ${id}`);
    await vi.waitFor(async () => expect(await draft.local?.get("pending")).toBe(1));
    await draft.destroy();
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(TooltipProvider, null, createElement(DocumentList, { session: account })),
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('[aria-label="Unsaved documents on this device"]')).not.toBeNull();
    });
    expect(
      Array.from(host.querySelectorAll('a[href^="/docs/new?draft="]')).map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["Resume Draft first", "/docs/new?draft=first"],
      ["Resume Draft second", "/docs/new?draft=second"],
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps the URL draft on rerender and opens a fresh draft on New or account switch", async () => {
  const account = await session();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let runtime: DocumentPersistence | null = null;
  function Harness({ session }: { session: PodSession }) {
    runtime = useDocument(session, undefined).runtime;
    return createElement("p", null, runtime?.draftId ?? "opening");
  }
  const waitForOpen = () =>
    vi.waitFor(async () => {
      await act(async () => {});
      expect(runtime).not.toBeNull();
    });
  try {
    await act(async () => root.render(createElement(Harness, { session: account })));
    await waitForOpen();
    const first = runtime as unknown as DocumentPersistence;
    expect(new URL(window.location.href).searchParams.get("draft")).toBe(first.draftId);
    navigation.params = new URLSearchParams(window.location.search);
    await act(async () => root.render(createElement(Harness, { session: account })));
    expect(runtime).toBe(first);
    navigation.params = new URLSearchParams();
    window.history.replaceState({}, "", "/docs/new");
    await act(async () => root.render(createElement(Harness, { session: account })));
    await waitForOpen();
    const next = runtime as unknown as DocumentPersistence;
    expect(next.draftId).not.toBe(first.draftId);
    navigation.params = new URLSearchParams(window.location.search);
    const other = { ...account, webId: "https://another.test/#me" };
    await act(async () => root.render(createElement(Harness, { session: other })));
    await waitForOpen();
    const switched = runtime as unknown as DocumentPersistence;
    expect(switched.session.webId).toBe(other.webId);
    expect(switched.local?.name).not.toBe(next.local?.name);
  } finally {
    await act(async () => root.unmount());
  }
});

it("hides the previous account's draft titles while the next account's list loads", async () => {
  const account = await session();
  const draft = new DocumentPersistence(account, "private-draft");
  await draft.open();
  draft.online = false;
  draft.rename("Private title");
  await vi.waitFor(async () => expect(await draft.local?.get("pending")).toBe(1));
  await draft.destroy();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const renderList = (session: PodSession) =>
    root.render(createElement(TooltipProvider, null, createElement(DocumentList, { session })));
  let finish: ((databases: IDBDatabaseInfo[]) => void) | undefined;
  try {
    await act(async () => renderList(account));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.textContent).toContain("Resume Private title");
    });
    vi.spyOn(indexedDB, "databases").mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    await act(async () => renderList({ ...account, webId: "https://another.test/#me" }));
    expect(host.textContent).not.toContain("Private title");
  } finally {
    await act(async () => finish?.([]));
    await act(async () => root.unmount());
  }
});
