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
const PREFERENCES = `${ROOT}settings/preferences.ttl`;
const EXTENDED_PROFILE = `${ROOT}extended-profile.ttl`;
const CUSTOM_INDEX = `${ROOT}settings/existing-drive-index.ttl`;
const DOCUMENTS = `${ROOT}Documents/`;
const DISCOVERY_PATHS = [
  "public",
  "private",
  "pim preferences",
  "space preferences",
  "seeAlso public",
  "seeAlso private",
  "seeAlso preferences",
  "isPrimaryTopicOf public",
  "isPrimaryTopicOf private",
  "isPrimaryTopicOf preferences",
] as const;
type DiscoveryPath = (typeof DISCOVERY_PATHS)[number];
let session: PodSession;
let drive: ReturnType<typeof useDrive>;
function Probe() {
  drive = useDrive();
  return null;
}

async function fixture(registered?: DiscoveryPath, register = true, instance = false) {
  const pod = await wacPod();
  const privateIndex =
    registered && registered !== "public" && registered !== "private"
      ? CUSTOM_INDEX
      : PRIVATE_INDEX;
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
  const extended = new Store();
  const extendedLink = registered?.startsWith("seeAlso")
    ? "http://www.w3.org/2000/01/rdf-schema#seeAlso"
    : registered?.startsWith("isPrimaryTopicOf")
      ? "http://xmlns.com/foaf/0.1/isPrimaryTopicOf"
      : undefined;
  const anchor = extendedLink ? new WacFields(OWNER, extended, DataFactory) : me;
  if (extendedLink) me.iris(extendedLink).add(EXTENDED_PROFILE);
  anchor.iris(`${SOLID}publicTypeIndex`).add(PUBLIC_INDEX);
  if (registered?.endsWith("preferences")) {
    anchor.iris("http://www.w3.org/ns/pim/space#preferencesFile").add(PREFERENCES);
    const preferences = new Store();
    new WacFields(OWNER, preferences, DataFactory)
      .iris(`${SOLID}privateTypeIndex`)
      .add(privateIndex);
    await put(PREFERENCES, await turtle(preferences));
    pod.policies.set(`${PREFERENCES}.policy`, await aclBody(PREFERENCES));
  } else anchor.iris(`${SOLID}privateTypeIndex`).add(privateIndex);
  if (extendedLink) await put(EXTENDED_PROFILE, await turtle(extended));
  await put(OWNER.split("#")[0] as string, await turtle(profile));
  for (const [kind, url] of [
    ["public", PUBLIC_INDEX],
    ["private", privateIndex],
  ] as const) {
    const index = new Store();
    new TypeIndexDocument(url, index, DataFactory).markUnlistedIndex();
    if (
      register &&
      registered &&
      (registered.endsWith("public") ? kind === "public" : kind === "private")
    ) {
      const registration = new TypeRegistration(DataFactory.blankNode(), index, DataFactory);
      registration.markRegistration();
      registration.forClass = DRIVE_ROOT_CLASS;
      if (instance) registration.instance = DOCUMENTS;
      else registration.instanceContainer = DOCUMENTS;
    }
    await put(url, await turtle(index));
  }
  // The selected private index really has owner-only WAC, even though the storage is public.
  pod.policies.set(`${privateIndex}.policy`, await aclBody(privateIndex));
  if (registered && register) await put(`${DOCUMENTS}report.txt`, "Existing report", "text/plain");
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
  return { ...pod, privateIndex };
}

function tree(view: ReturnType<typeof h> = h(FolderView)) {
  return h(DriveProvider, {
    session,
    children: h(DriveUiProvider, null, h(Probe), view),
  });
}

async function roots(pod: Awaited<ReturnType<typeof fixture>>) {
  const locations = [];
  for (const url of [PUBLIC_INDEX, pod.privateIndex]) {
    const { dataset } = await fetchRdf(url, { fetch: pod.fetch });
    locations.push(...new TypeIndexDataset(dataset, DataFactory).locate(DRIVE_ROOT_CLASS));
  }
  return locations;
}

async function waitForDriveRoot() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.rootError).toBeUndefined();
    expect(drive.driveRoot).toBe(DRIVE);
  });
}

async function removeFallback(pod: Awaited<ReturnType<typeof fixture>>) {
  for (const path of ["private/secret", "private/", "public/placeholder", "public/", ""]) {
    expect((await pod.pod.fetch(`${DRIVE}${path}`, { method: "DELETE" })).ok).toBe(true);
  }
}

beforeEach(() => localStorage.clear());

it.each([
  ["pim preferences", PREFERENCES],
  ["seeAlso private", EXTENDED_PROFILE],
] as const)("an unreadable %s document prevents fallback creation", async (path, url) => {
  const pod = await fixture(path);
  pod.intercept(async (target, init) =>
    target === url && !init?.method ? new Response(null, { status: 403 }) : undefined,
  );
  const view = await mount(h(DriveApp, null, h(FolderView)));
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
    "Can't read your Drive type index",
  );
  expect(pod.calls.filter((call) => call.method === "PUT")).toEqual([]);
});

it.each(
  DISCOVERY_PATHS,
)("uses the existing %s DriveRoot registration in My Drive, Recent and search without registering again", async (index) => {
  const pod = await fixture(index);
  const view = await mount(tree());
  expect(drive.driveRoot).toBe(DOCUMENTS);
  for (const body of [FolderView, RecentView, SearchView]) {
    await view.render(tree(h(body)));
    expect(view.host.querySelector(`[data-url="${DOCUMENTS}report.txt"]`)).not.toBeNull();
    expect(view.host.textContent).not.toContain("Your Drive is empty");
  }
  expect(pod.calls.filter((call) => call.method === "PUT")).toEqual([]);
  expect(pod.calls.some((call) => call.url.startsWith(DRIVE))).toBe(false);
  expect(await roots(pod)).toHaveLength(1);
});

it.each(
  DISCOVERY_PATHS,
)("uses a solid:instance DriveRoot container via %s without creating a fallback", async (path) => {
  const pod = await fixture(path, true, true);
  const view = await mount(tree());
  expect(drive.driveRoot).toBe(DOCUMENTS);
  expect(view.host.querySelector(`[data-url="${DOCUMENTS}report.txt"]`)).not.toBeNull();
  expect(pod.calls.filter((call) => call.method === "PUT")).toEqual([]);
});

it.each(
  DISCOVERY_PATHS,
)("registers a missing DriveRoot in the existing private index via %s", async (path) => {
  const pod = await fixture(path, false);
  await removeFallback(pod);
  await mount(tree());
  await waitForDriveRoot();
  expect(drive.driveRoot).toBe(DRIVE);
  expect(await roots(pod)).toEqual([expect.objectContaining({ container: DRIVE })]);
  expect(pod.calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([
    DRIVE,
    pod.privateIndex,
  ]);
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
  await waitForDriveRoot();
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

it.each([
  false,
  true,
])("concurrent first-run tabs never rebase a registration write (index initially absent: %s)", async (absent) => {
  const pod = await fixture();
  await removeFallback(pod);
  if (absent) expect((await pod.pod.fetch(PRIVATE_INDEX, { method: "DELETE" })).ok).toBe(true);
  const gate = deferred<void>();
  const writes = { create: 0, update: 0 };
  const outcomes: Record<"create" | "update", number[]> = { create: [], update: [] };
  pod.intercept(async (url, init) => {
    if (url !== PRIVATE_INDEX || init?.method !== "PUT") return;
    const headers = new Headers(init.headers);
    const phase = headers.get("if-none-match") === "*" ? "create" : "update";
    if (phase === "update") expect(headers.has("if-match")).toBe(true);
    writes[phase]++;
    if (writes[absent ? "create" : "update"] === 2) gate.resolve();
    await gate.promise;
    const response = await pod.pod.fetch(url, init);
    outcomes[phase].push(response.status);
    response.headers.set("link", `<${PRIVATE_INDEX}.policy>; rel="acl"`);
    response.headers.delete("x-solid-demo-access-control");
    return response;
  });
  const states: ReturnType<typeof useDrive>[] = [];
  function Tab({ index }: { index: number }) {
    states[index] = useDrive();
    return null;
  }
  const tab = (index: number) => h(DriveProvider, { session, children: h(Tab, { index }) });
  const first = await mount(tab(0));
  const second = await mount(tab(1));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(outcomes[absent ? "create" : "update"]).toHaveLength(2);
    expect(
      states.filter((state) => state.driveRoot === DRIVE),
      JSON.stringify(
        states.map(({ rootError }) => rootError),
        ["name", "message", "cause", "url", "status"],
      ),
    ).toHaveLength(absent ? 1 : 2);
    expect(states.filter((state) => state.rootError)).toHaveLength(absent ? 1 : 0);
  });
  expect(
    outcomes[absent ? "create" : "update"].filter((status) => status >= 200 && status < 300),
  ).toHaveLength(1);
  expect(outcomes[absent ? "create" : "update"]).toContain(412);
  expect(writes).toEqual(absent ? { create: 2, update: 1 } : { create: 0, update: 2 });
  expect(await roots(pod)).toHaveLength(1);
  await first.unmount();
  await second.unmount();
  await mount(tree());
  await waitForDriveRoot();
  expect(writes).toEqual(absent ? { create: 2, update: 1 } : { create: 0, update: 2 });
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
