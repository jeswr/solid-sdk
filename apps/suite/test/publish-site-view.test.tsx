// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import type { StoredPage, StoredSite } from "@jeswr/solid-publish";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SiteView } from "../src/apps/publish/components/site-view";

const seam = vi.hoisted(() => ({ reorder: vi.fn() }));
vi.mock("../src/apps/publish/state/publish-context", () => ({
  usePublish: () => ({
    workspace: { reorder: seam.reorder },
    repository: {},
    snapshot: { sites: [] },
    session: { displayName: "Writer" },
  }),
}));
vi.mock("@/shell/app-frame", () => ({
  AppHeading: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));
vi.mock("@/shell/sync/requires-online", () => ({
  RequiresOnline: ({ children }: { children: ReactNode }) => children,
}));

it("moves only pages and disables the first/last page controls despite interleaved posts", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const at = new Date();
  const site: StoredSite = {
    url: "https://pod.example/publish/site/site.ttl",
    etag: '"1"',
    data: {
      name: "Site",
      description: "",
      author: "Writer",
      theme: "paper",
      inLanguage: "en",
      created: at,
      modified: at,
    },
  };
  const pages: StoredPage[] = ["post", "page", "post", "page", "post"].map((kind, position) => ({
    url: `https://pod.example/publish/site/pages/item-${position}.ttl`,
    etag: '"1"',
    data: {
      title: `Item ${position}`,
      slug: `item-${position}`,
      kind: kind as "page" | "post",
      position,
      status: "draft",
      body: "",
      summary: "",
      modified: at,
    },
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SiteView site={site} pages={pages} openPage={() => {}} />));
    const button = (label: string) =>
      host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button("Move Item 1 up")?.getAttribute("aria-disabled")).toBe("true");
    expect(button("Move Item 3 down")?.getAttribute("aria-disabled")).toBe("true");
    expect(button("Move Item 1 down")?.getAttribute("aria-disabled")).toBeNull();
    await act(async () => button("Move Item 1 down")?.click());
    expect(seam.reorder).toHaveBeenCalledWith(site.url, [pages[3]?.url, pages[1]?.url]);
    expect(button("Move Item 0 up")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
