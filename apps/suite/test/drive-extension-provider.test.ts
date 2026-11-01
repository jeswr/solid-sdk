import { afterEach, expect, it, vi } from "vitest";
import { DRIVE_ROOT_CLASS } from "../src/apps/drive/lib/constants";
import { DriveProvider, useDrive, useFolder } from "../src/apps/drive/state/drive-context";
import { openExtensionSession, STORAGE_CLASS } from "../src/lib/session/extension-pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";
import { captureTimers } from "./session-timers";

const WEBID = "https://identity.example/card#me";
const PROFILE = "https://identity.example/card";
const PUBLIC = "https://identity.example/public.ttl";
const OFF_GRANT = "https://identity.example/private.ttl";
const STORAGE = "https://storage.example/alice/";
const PRIVATE = `${STORAGE}settings/private.ttl`;
const PREFERENCES = `${STORAGE}settings/prefs.ttl`;
const DRIVE = `${STORAGE}Documents/`;
const SOLID = "http://www.w3.org/ns/solid/terms#";
const LDP = "http://www.w3.org/ns/ldp#";
const link = (predicate: string, target: string) => `<${WEBID}> <${predicate}> <${target}>.`;
const registration = (root: string) => `
  <#drive> a <${SOLID}TypeRegistration>; <${SOLID}forClass> <${DRIVE_ROOT_CLASS}>;
    <${SOLID}instanceContainer> <${root}>.`;
const rdf = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/turtle", etag: '"v1"' },
  });

afterEach(() => vi.restoreAllMocks());

it.each([
  { index: "public", expected: DRIVE },
  { index: "private", expected: DRIVE },
  { index: "preferences", expected: DRIVE },
  { index: "outside-private", expected: STORAGE },
  { index: "outside-preferences", expected: STORAGE },
  { index: "outside-location", expected: STORAGE },
  { index: "missing", expected: STORAGE },
  { index: "unreadable", expected: STORAGE },
  { index: "profile-offline", expected: STORAGE },
])("Drive discovers $index data with a public profile on another origin", async ({
  index,
  expected,
}) => {
  const pageFetch = vi.fn<typeof fetch>(async (input, init) => {
    // Request inputs bypass inject.ts's string/URL auto-diversion to window.solid.fetch.
    expect(input).toBeInstanceOf(Request);
    const request = new Request(input, init);
    expect(request.credentials).toBe("omit");
    expect(request.method).toBe("GET");
    const url = request.url.split("#")[0];
    if (url === PROFILE) {
      if (index === "profile-offline") return rdf("", 503);
      if (index.includes("preferences"))
        return rdf(
          link(
            "http://www.w3.org/ns/pim/space#preferencesFile",
            index === "preferences" ? PREFERENCES : OFF_GRANT,
          ),
        );
      const target =
        index === "private" ? PRIVATE : index === "outside-private" ? OFF_GRANT : PUBLIC;
      return rdf(
        index === "missing"
          ? ""
          : link(
              `${SOLID}${index.includes("private") ? "privateTypeIndex" : "publicTypeIndex"}`,
              target,
            ),
      );
    }
    if (url === PUBLIC)
      return rdf(
        registration(index === "outside-location" ? "https://ungranted.example/files/" : DRIVE),
        index === "unreadable" ? 403 : 200,
      );
    throw new Error(`Unexpected public read ${request.url}`);
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(pageFetch);
  const storageFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(request.url.startsWith(STORAGE)).toBe(true);
    expect(request.method).toBe("GET");
    if (request.url === PREFERENCES) return rdf(link(`${SOLID}privateTypeIndex`, PRIVATE));
    if (request.url === PRIVATE) return rdf(registration(DRIVE));
    if (request.url === expected)
      return rdf(`<${expected}> a <${LDP}BasicContainer>; <${LDP}contains> <${expected}hello.txt>.
      <${expected}hello.txt> a <${LDP}Resource>.`);
    throw new Error(`Unexpected storage read ${request.url}`);
  });
  const api = {
    webId: WEBID,
    fetch: storageFetch,
    listGrants: async () => [
      {
        grantId: "storage",
        dataClass: STORAGE_CLASS,
        modes: ["read", "write"],
        purpose: null,
        expiresAt: Date.now() + 60_000,
        targets: [{ url: STORAGE, kind: "container" as const }],
      },
    ],
  };
  Object.defineProperty(window, "solid", { configurable: true, value: api });
  const session = await openExtensionSession(api);
  let drive!: ReturnType<typeof useDrive>;
  let folder!: ReturnType<typeof useFolder>;
  function Probe() {
    drive = useDrive();
    folder = useFolder(drive.driveRoot);
    return null;
  }
  await mount(h(DriveProvider, { session, children: h(Probe) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(drive.rootError).toBeUndefined();
    expect(drive.driveRoot).toBe(expected);
    expect(folder).toMatchObject({ status: "ready", items: [{ url: `${expected}hello.txt` }] });
  });
  expect(pageFetch.mock.calls.some(([input]) => new Request(input).url.startsWith(PROFILE))).toBe(
    true,
  );
  expect(storageFetch).toHaveBeenCalled();
  // Check the recorded attempts too: discovery deliberately catches transport errors.
  for (const [input, init] of pageFetch.mock.calls) {
    expect(input).toBeInstanceOf(Request);
    expect(new Request(input, init)).toMatchObject({ credentials: "omit", method: "GET" });
  }
  for (const [input, init] of storageFetch.mock.calls) {
    const request = new Request(input, init);
    expect(request.url.startsWith(STORAGE)).toBe(true);
    expect(request.method).toBe("GET");
  }
  if (index === "public")
    expect(pageFetch.mock.calls.some(([input]) => new Request(input).url === PUBLIC)).toBe(true);
  if (index === "private")
    expect(storageFetch.mock.calls.some(([input]) => String(input) === PRIVATE)).toBe(true);
});

it.each(
  ["profile", "public-index", "private-index", "preferences"].flatMap((phase) =>
    ["pending", "rejected", "unmounted"].map((outcome) => ({ phase, outcome })),
  ),
)("Drive falls back to its granted root when $phase is $outcome", async ({ phase, outcome }) => {
  const timers = captureTimers();
  const reached = deferred<void>();
  const response = deferred<Response>();
  const block = () => {
    reached.resolve();
    if (outcome === "rejected") throw new Error("Discovery offline");
    return response.promise;
  };
  const pageFetch = vi.fn<typeof fetch>(async (input) => {
    const url = new Request(input).url.split("#")[0];
    if (url === PROFILE) {
      if (phase === "profile") return block();
      if (phase === "public-index") return rdf(link(`${SOLID}publicTypeIndex`, PUBLIC));
      if (phase === "private-index") return rdf(link(`${SOLID}privateTypeIndex`, PRIVATE));
      return rdf(link("http://www.w3.org/ns/pim/space#preferencesFile", PREFERENCES));
    }
    if (url === PUBLIC) return block();
    throw new Error(`Unexpected public read ${url}`);
  });
  // Decoration succeeds; the next profile read belongs to Drive's discovery budget.
  pageFetch.mockResolvedValueOnce(rdf(""));
  vi.spyOn(globalThis, "fetch").mockImplementation(pageFetch);
  const storageFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(request.method).toBe("GET");
    if (request.url === PRIVATE || request.url === PREFERENCES) return block();
    if (request.url === STORAGE)
      return rdf(`<${STORAGE}> a <${LDP}BasicContainer>; <${LDP}contains> <${STORAGE}hello.txt>.`);
    throw new Error(`Unexpected storage read ${request.url}`);
  });
  const api = {
    webId: WEBID,
    fetch: storageFetch,
    listGrants: async () => [
      {
        grantId: "storage",
        dataClass: STORAGE_CLASS,
        modes: ["read", "write"],
        purpose: null,
        expiresAt: Date.now() + 60_000,
        targets: [{ url: STORAGE, kind: "container" as const }],
      },
    ],
  };
  Object.defineProperty(window, "solid", { configurable: true, value: api });
  const session = await openExtensionSession(api);
  let drive!: ReturnType<typeof useDrive>;
  function Probe() {
    drive = useDrive();
    useFolder(drive.driveRoot);
    return null;
  }
  const view = await mount(h(DriveProvider, { session, children: h(Probe) }));
  await act(() => reached.promise);
  if (outcome === "unmounted") {
    expect(timers.count(5000)).toBe(1);
    await view.unmount();
    expect(timers.count()).toBe(0);
    await act(() => response.resolve(rdf(registration(DRIVE))));
    expect(drive.driveRoot).toBeUndefined();
    expect(storageFetch.mock.calls.some(([input]) => new Request(input).url === STORAGE)).toBe(
      false,
    );
    return;
  }
  if (outcome === "pending") {
    expect(drive.driveRoot).toBeUndefined();
    expect(timers.count(5000)).toBe(1);
    expect(vi.mocked(window.setTimeout).mock.calls.filter(([, ms]) => ms === 5000)).toHaveLength(2);
    // One completed grant deadline above, and one overall discovery deadline, regardless of
    // how many profile/index requests have already completed.
    await act(() => timers.fire(5000));
  }
  expect(drive.driveRoot).toBe(STORAGE);
  expect(drive.rootError).toBeUndefined();
  expect(timers.count(5000)).toBe(0);
  expect(storageFetch.mock.calls.some(([input]) => new Request(input).url === STORAGE)).toBe(true);
  await act(() => response.resolve(rdf(registration(DRIVE))));
  expect(drive.driveRoot).toBe(STORAGE);
  await view.unmount();
  expect(timers.count()).toBe(0);
});
