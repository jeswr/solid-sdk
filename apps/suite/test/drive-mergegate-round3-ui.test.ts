// AUTHORED-BY Codex
import { expect, it, vi } from "vitest";
import {
  createSolidDriveClient,
  type DriveClient,
  type DriveItem,
} from "../src/apps/drive/lib/client/client";
import { act, deferred, h, mount } from "./drive-ui-dom";
import { OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: mocks.toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("../src/apps/drive/state/drive-context", () => ({ useDrive: () => drive }));

import { DetailsPane } from "../src/apps/drive/components/details";
import { DriveUiProvider, useDriveActions } from "../src/apps/drive/state/ui";

const drive = {
  client: undefined as unknown as DriveClient,
  driveRoot: `${ROOT}drive/`,
  session: { webId: OWNER, storageUrl: ROOT, fetch: vi.fn<typeof fetch>() as typeof fetch },
  prefs: { starred: [] },
  changes: { subscribe: vi.fn(() => () => {}) },
  updatePrefs: vi.fn(),
  invalidate: vi.fn(),
};
let actions: ReturnType<typeof useDriveActions>;
function Probe() {
  actions = useDriveActions();
  return null;
}
function tree(item: DriveItem) {
  return h(DriveUiProvider, null, h(DetailsPane, { items: [item], onClose: vi.fn() }), h(Probe));
}

it.each([
  "Details",
  "copied link",
])("%s reports unknown for a public file outside the session storage", async (surface) => {
  const f = await wacPod();
  const storageUrl = "https://alice.test/";
  const url = `${PUBLIC}placeholder`;
  expect((await f.anonymous(url)).status).toBe(200);
  drive.client = createSolidDriveClient({ storageUrl, fetch: f.fetch });
  drive.session = { webId: `${storageUrl}profile#me`, storageUrl, fetch: f.fetch };
  const item = await drive.client.stat(url);
  const view = await mount(tree(item));
  if (surface === "Details") {
    expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Access unknown");
    return;
  }
  vi.stubGlobal("location", window.location);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  await act(async () => actions.copyLink(item));
  expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenLastCalledWith("Link copied", { description: "Access unknown" });
});

it.each([
  "Details",
  "copied link",
])("%s reports public effective access after an explicitly confirmed move", async (surface) => {
  const f = await wacPod();
  drive.client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    confirmAccess: async () => "move",
  });
  drive.session = { webId: OWNER, storageUrl: ROOT, fetch: f.fetch };
  const to = `${PUBLIC}secret`;
  await drive.client.move(`${PRIVATE}secret`, to, { kind: "confirm-move" });
  expect((await f.anonymous(to)).status).toBe(200);
  const view = await mount(tree(await drive.client.stat(to)));
  if (surface === "Details") {
    expect(view.host.querySelector(".drv-access-line")?.textContent).toContain(
      "Anyone with the link",
    );
    expect(view.host.querySelector(".drv-access-line")?.getAttribute("role")).toBe("status");
    return;
  }
  vi.stubGlobal("location", window.location);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  await act(async () => actions.copyLink(await drive.client.stat(to)));
  expect(mocks.toast).toHaveBeenCalledWith("Link copied", { description: "Anyone with the link" });
});

it.each([
  "private",
  "people",
  "missing-link",
  "unreadable",
  "acp",
  "demo",
])("Details and copied link summarize %s access without claiming unverified privacy", async (mode) => {
  const f = await wacPod();
  const url = `${PRIVATE}secret`;
  const { aclBody, ACL, WacFields, turtle } = await import("./drive-wac-pod");
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const { DataFactory } = await import("n3");
  if (mode === "people") {
    const data = await parseRdf(await aclBody(url), "text/turtle");
    const rule = new WacFields(DataFactory.blankNode(), data, DataFactory);
    rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
    rule.iris(`${ACL}accessTo`).add(url);
    rule.iris(`${ACL}agent`).add("https://bob.test/#me");
    rule.iris(`${ACL}mode`).add(`${ACL}Read`);
    f.policies.set(`${url}.policy`, await turtle(data));
  }
  if (mode === "unreadable")
    f.intercept(async (target) =>
      target === `${url}.policy` ? new Response(null, { status: 403 }) : undefined,
    );
  f.after(async (target, method, response) => {
    if (target !== url || method !== "HEAD") return response;
    const headers = new Headers(response.headers);
    if (mode === "missing-link") headers.delete("link");
    if (mode === "acp")
      headers.set("link", `<policy>; rel="http://www.w3.org/ns/solid/acp#accessControl"`);
    if (mode === "demo") headers.set("x-solid-demo-access-control", "none");
    return new Response(response.body, { status: response.status, headers });
  });
  drive.client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  drive.session = { webId: OWNER, storageUrl: ROOT, fetch: f.fetch };
  const item = await drive.client.stat(url);
  const view = await mount(tree(item));
  const label =
    mode === "private"
      ? "Only you"
      : mode === "people"
        ? "People you've shared with: 1"
        : mode === "demo"
          ? "Only you (demo pod)"
          : "Access unknown";
  expect(view.host.querySelector(".drv-access-line")?.textContent).toBe(label);
  vi.stubGlobal("location", window.location);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
  await act(async () => actions.copyLink(item));
  expect(mocks.toast).toHaveBeenLastCalledWith("Link copied", { description: label });
});

it("Details clears stale private access on selection and ignores a late policy response", async () => {
  const f = await wacPod();
  drive.client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  drive.session = { webId: OWNER, storageUrl: ROOT, fetch: f.fetch };
  const privateItem = await drive.client.stat(`${PRIVATE}secret`);
  const publicItem = await drive.client.stat(`${PUBLIC}placeholder`);
  const view = await mount(tree(privateItem));
  expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you");
  const pending = deferred<Response>();
  f.intercept(async (url, init) =>
    url === publicItem.url && init?.method === "HEAD" ? pending.promise : undefined,
  );
  await view.render(tree(publicItem));
  expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Access unknown");
  await view.render(tree(privateItem));
  expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you");
  await act(async () => pending.resolve(new Response(null)));
  expect(view.host.querySelector(".drv-access-line")?.textContent).toBe("Only you");
});

it("Trash with unknown own access offers Delete forever and retains the source", async () => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  drive.client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  drive.session = { webId: OWNER, storageUrl: ROOT, fetch: f.fetch };
  const item = await drive.client.stat(from);
  f.after(async (url, method, response) => {
    if (url !== from || method !== "GET") return response;
    const headers = new Headers(response.headers);
    headers.delete("link");
    return new Response(response.body, { status: response.status, headers });
  });
  await mount(tree(item));
  await act(async () => actions.trash([item]));
  expect(mocks.toast.error).toHaveBeenCalledWith(
    expect.stringContaining("can't confirm who can access"),
    expect.objectContaining({ action: expect.objectContaining({ label: "Delete forever" }) }),
  );
  expect(f.pod.has(from)).toBe(true);
});
