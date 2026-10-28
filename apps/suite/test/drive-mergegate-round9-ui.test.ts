// AUTHORED-BY Codex
import { fetchRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { beforeEach, expect, it, vi } from "vitest";
import {
  TypeIndexDataset,
  TypeIndexDocument,
  TypeRegistration,
} from "../src/apps/docs/lib/model/type-index";
import { DRIVE_ROOT_CLASS } from "../src/apps/drive/lib/constants";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";
import { aclBody, DRIVE, OWNER, ROOT, turtle, WacFields, wacPod } from "./drive-wac-pod";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams({ q: "report" }) }));
vi.mock(
  "@/apps/docs/lib/model/type-index",
  async () => import("../src/apps/docs/lib/model/type-index"),
);
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock(
  "@/components/interim-shell/suite-frame",
  async () => import("../src/components/interim-shell/suite-frame"),
);
vi.mock("@/lib/session/pod-session", () => ({
  PodSessionProvider: ({ children }: { children: import("react").ReactNode }) => children,
  usePodSessionState: () => ({ status: "ready", session }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/drive/my",
  useSearchParams: () => navigation.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Toaster: () => null,
}));

import { DriveApp } from "../src/apps/drive/components/drive-app";
import { FolderView, RecentView, SearchView } from "../src/apps/drive/components/views";
import { DriveProvider, useDrive } from "../src/apps/drive/state/drive-context";
import { DriveUiProvider } from "../src/apps/drive/state/ui";

const SOLID = "http://www.w3.org/ns/solid/terms#";
const PRIVATE_INDEX = `${ROOT}settings/privateTypeIndex.ttl`;
const PUBLIC_INDEX = `${ROOT}settings/publicTypeIndex.ttl`;
const DOCUMENTS = `${ROOT}Documents/`;
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  return null;
}

async function fixture(registered?: "public" | "private") {
  const pod = await wacPod();
  const put = async (url: string, body: string, contentType = "text/turtle") => {
    const response = await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": contentType, "if-none-match": "*" },
      body,
    });
    expect(response.ok).toBe(true);
  };
  const profile = new Store();
  const me = new WacFields(OWNER, profile, DataFactory);
  me.iris(`${SOLID}publicTypeIndex`).add(PUBLIC_INDEX);
  me.iris(`${SOLID}privateTypeIndex`).add(PRIVATE_INDEX);
  await put(OWNER.split("#")[0] as string, await turtle(profile));
  for (const [kind, url] of [
    ["public", PUBLIC_INDEX],
    ["private", PRIVATE_INDEX],
  ] as const) {
    const index = new Store();
    new TypeIndexDocument(url, index, DataFactory).markUnlistedIndex();
    if (registered === kind) {
      const registration = new TypeRegistration(DataFactory.blankNode(), index, DataFactory);
      registration.markRegistration();
      registration.forClass = DRIVE_ROOT_CLASS;
      registration.instanceContainer = DOCUMENTS;
    }
    await put(url, await turtle(index));
  }
  // The selected private index really has owner-only WAC, even though the storage is public.
  pod.policies.set(`${PRIVATE_INDEX}.policy`, await aclBody(PRIVATE_INDEX));
  if (registered) await put(`${DOCUMENTS}report.txt`, "Existing report", "text/plain");
  session = {
    mode: "demo",
    webId: OWNER,
    displayName: "Owner",
    storageUrl: ROOT,
    fetch: pod.fetch,
    subscribe: () => () => {},
    reset: vi.fn(),
  };
  pod.calls.length = 0;
  return pod;
}

function tree(view: ReturnType<typeof h> = h(FolderView)) {
  return h(DriveProvider, {
    session,
    children: h(DriveUiProvider, null, h(Probe), view),
  });
}

async function roots(pod: Awaited<ReturnType<typeof fixture>>) {
  const locations = [];
  for (const url of [PUBLIC_INDEX, PRIVATE_INDEX]) {
    const { dataset } = await fetchRdf(url, { fetch: pod.fetch });
    locations.push(...new TypeIndexDataset(dataset, DataFactory).locate(DRIVE_ROOT_CLASS));
  }
  return locations;
}

async function removeFallback(pod: Awaited<ReturnType<typeof fixture>>) {
  for (const path of ["private/secret", "private/", "public/placeholder", "public/", ""]) {
    expect((await pod.pod.fetch(`${DRIVE}${path}`, { method: "DELETE" })).ok).toBe(true);
  }
}

beforeEach(() => localStorage.clear());

it.each([
  "public",
  "private",
] as const)("uses the existing %s DriveRoot registration in My Drive, Recent and search without registering again", async (index) => {
  const pod = await fixture(index);
  const view = await mount(tree());
  expect(drive.driveRoot).toBe(DOCUMENTS);
  for (const body of [FolderView, RecentView, SearchView]) {
    await view.render(tree(h(body)));
    expect(view.host.querySelector(`[data-url="${DOCUMENTS}report.txt"]`)).not.toBeNull();
    expect(view.host.textContent).not.toContain("Your Drive is empty");
  }
  expect(pod.calls.filter((call) => call.method === "PUT")).toEqual([]);
  expect(await roots(pod)).toHaveLength(1);
});

it("chooses the first DriveRoot container in public-then-private order, including legacy classes", async () => {
  const pod = await fixture("private");
  const { dataset, etag } = await fetchRdf(PUBLIC_INDEX, { fetch: pod.fetch });
  const publicIndex = new Store([...dataset]);
  const first = `${ROOT}First/`;
  for (const [id, forClass, container, instance] of [
    ["unrelated", "https://example.org/Other", `${ROOT}Other/`, undefined],
    ["resource", DRIVE_ROOT_CLASS, undefined, `${ROOT}resource.ttl`],
    ["legacy", "https://w3id.org/jeswr/pod-drive#DriveRoot", first, undefined],
    ["second", DRIVE_ROOT_CLASS, `${ROOT}Second/`, undefined],
  ] as const) {
    const reg = new TypeRegistration(`${PUBLIC_INDEX}#${id}`, publicIndex, DataFactory);
    reg.markRegistration();
    reg.forClass = forClass;
    reg.instanceContainer = container;
    reg.instance = instance;
  }
  expect(
    (
      await pod.fetch(PUBLIC_INDEX, {
        method: "PUT",
        headers: { "content-type": "text/turtle", "if-match": etag as string },
        body: await turtle(publicIndex),
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await pod.fetch(`${first}report.txt`, {
        method: "PUT",
        headers: { "content-type": "text/plain", "if-none-match": "*" },
        body: "First registered report",
      })
    ).ok,
  ).toBe(true);
  pod.calls.length = 0;
  const view = await mount(tree());
  expect(drive.driveRoot).toBe(first);
  expect(view.host.querySelector(`[data-url="${first}report.txt"]`)).not.toBeNull();
  expect(pod.calls.filter((call) => call.method === "PUT")).toEqual([]);
});

it("creates the fallback and registers it once when neither type index has a DriveRoot", async () => {
  const pod = await fixture();
  // Start with a genuinely missing fallback, rather than the WAC fixture's default tree.
  await removeFallback(pod);
  const view = await mount(tree());
  expect(drive.driveRoot).toBe(DRIVE);
  expect(view.host.textContent).toContain("Your Drive is empty");
  expect(await roots(pod)).toEqual([
    expect.objectContaining({ forClass: DRIVE_ROOT_CLASS, container: DRIVE }),
  ]);
  await view.unmount();
  await mount(tree());
  expect(
    pod.calls.filter((call) => call.method === "PUT" && call.url === PRIVATE_INDEX),
  ).toHaveLength(1);
});

it("concurrent first-run tabs converge on one registration after an If-Match conflict", async () => {
  const pod = await fixture();
  await removeFallback(pod);
  expect((await pod.pod.fetch(PRIVATE_INDEX, { method: "DELETE" })).ok).toBe(true);
  const gates = { create: deferred<void>(), update: deferred<void>() };
  const writes = { create: 0, update: 0 };
  const outcomes: Record<"create" | "update", number[]> = { create: [], update: [] };
  pod.intercept(async (url, init) => {
    if (url !== PRIVATE_INDEX || init?.method !== "PUT") return;
    const headers = new Headers(init.headers);
    const phase = headers.get("if-none-match") === "*" ? "create" : "update";
    if (phase === "update") expect(headers.has("if-match")).toBe(true);
    writes[phase]++;
    if (writes[phase] === 2) gates[phase].resolve();
    await gates[phase].promise;
    const response = await pod.pod.fetch(url, init);
    outcomes[phase].push(response.status);
    return response;
  });
  const first = await mount(tree());
  const second = await mount(tree());
  await act(async () => {
    await gates.update.promise;
  });
  expect(first.host.textContent).not.toContain("Loading…");
  expect(second.host.textContent).not.toContain("Loading…");
  expect(drive.driveRoot).toBe(DRIVE);
  for (const statuses of Object.values(outcomes)) {
    expect(statuses.filter((status) => status >= 200 && status < 300)).toHaveLength(1);
    expect(statuses).toContain(412);
  }
  expect(await roots(pod)).toHaveLength(1);
});

it.each([
  PUBLIC_INDEX,
  PRIVATE_INDEX,
])("an unreadable type index %s shows a clear error without creating or registering a fallback", async (url) => {
  const pod = await fixture(url === PUBLIC_INDEX ? "private" : "public");
  pod.intercept(async (target, init) =>
    target === url && !init?.method ? new Response(null, { status: 403 }) : undefined,
  );
  const view = await mount(h(DriveApp, null, h(FolderView)));
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
    "Can't read your Drive type index",
  );
  expect(pod.calls.filter((call) => call.method === "PUT")).toEqual([]);
});
