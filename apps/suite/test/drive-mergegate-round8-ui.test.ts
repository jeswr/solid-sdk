// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { click, h, key, mount } from "./drive-ui-dom";
import { OWNER, PUBLIC, ROOT, turtle, wacPod } from "./drive-wac-pod";

const route = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("@/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: vi.fn(async () => []),
  ensureTypeRegistrations: vi.fn(),
}));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  usePathname: () => "/drive/my",
  useSearchParams: () => route.params,
  useRouter: () => ({
    push: vi.fn(),
    replace: (url: string) => {
      route.params = new URL(url, "https://suite.example").searchParams;
    },
  }),
}));

import { DetailsPane } from "../src/apps/drive/components/details";
import { PreviewDialog } from "../src/apps/drive/components/preview";
import { FolderView } from "../src/apps/drive/components/views";
import { DriveProvider } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider, useDriveUi } from "../src/apps/drive/state/ui";

function Details() {
  const ui = useDriveUi();
  return ui.detailsOpen ? h(DetailsPane, { onClose: () => ui.setDetailsOpen(false) }) : null;
}

class Fields extends TermWrapper {
  terms(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself);
  }
}

beforeEach(() => {
  localStorage.clear();
  route.params = new URLSearchParams();
});

it.each([
  false,
  true,
])("Documents keeps a dct:format-only listing row, details and preview (hidden Link: %s)", async (hiddenLink) => {
  const pod = await wacPod();
  const url = `${PUBLIC}placeholder`;
  pod.after(async (target, method, response) => {
    const headers = new Headers(response.headers);
    if (hiddenLink) headers.delete("link");
    let body = response.body;
    if (target === PUBLIC && method === "GET") {
      const data = new Store(await parseRdf(await response.text(), "text/turtle"));
      const resource = new Fields(url, data, DataFactory);
      resource.terms("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").clear();
      resource.terms("http://purl.org/dc/terms/format").add(DataFactory.literal("text/plain"));
      body = new Response(await turtle(data)).body;
    }
    return new Response(body, { status: response.status, headers });
  });
  const head = await pod.fetch(url, { method: "HEAD" });
  expect(head.headers.get("content-type")).toBe("text/plain");
  expect(head.headers.has("link")).toBe(!hiddenLink);
  const session: PodSession = {
    mode: "demo",
    storageUrl: ROOT,
    webId: OWNER,
    displayName: "Owner",
    fetch: pod.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  const tree = () =>
    h(DriveProvider, {
      session,
      children: h(
        DriveUiProvider,
        null,
        h(FolderView, { url: PUBLIC }),
        h(Details),
        h(PreviewDialog),
      ),
    });
  const view = await mount(tree());
  await key(view.host.querySelector(".drv-chips button") as Element, "ArrowDown");
  const option = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(
    (item) => item.textContent === "Documents",
  );
  expect(option).toBeDefined();
  await click(option as Element);
  await key(document.querySelector('[role="menu"]') as Element, "Escape");
  await view.render(tree());
  const row = view.host.querySelector(`[data-url="${url}"]`);
  expect(row, "dct:format text file remains visible with Documents selected").not.toBeNull();
  expect(view.host.textContent).not.toContain("No items match these filters");
  expect(row?.querySelector(".suite-file-icon")?.getAttribute("data-type")).toBe("text");
  // Filtering must use the listing itself, without a HEAD request per child.
  expect(pod.calls.filter((call) => call.url === url && call.method === "HEAD")).toHaveLength(1);
  await click(row as Element);
  await key(row as Element, "d");
  expect(view.host.querySelector(".drv-details")?.textContent).toContain("Text file");
  await key(row as Element, "Enter");
  expect(document.querySelector(".drv-preview-text")?.textContent).toBe("public");
});
