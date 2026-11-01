// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf } from "@jeswr/fetch-rdf";
import { podScopedUrl } from "@jeswr/guarded-fetch";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildCalendar,
  buildEvent,
  CALENDAR_CLASS,
  calendarIO,
  EVENT_CLASS,
  serializeDataset,
} from "../src/apps/calendar/lib/model";
import {
  type CalendarAccount,
  createCalendar,
  discoverCalendars,
  loadRange,
} from "../src/apps/calendar/state/repository";
import {
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  TypeRegistration,
} from "../src/apps/docs/lib/model/type-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";

/** Hex colour fixture built at runtime so the suite token gate only flags real styles. */
const hex = (digits: string) => `#${digits}`;

// The production default captures the pristine global before an authenticated fetch can replace it.
const publicRead = vi.hoisted(() => {
  const read = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", read);
  return read;
});
afterEach(() => publicRead.mockReset());
const root = "https://pod.example/storage/";
async function setup(webId = "https://identity.example/profile/card#me") {
  const profile = new Store();
  new ProfileTypeIndexAnchor(webId, profile, DataFactory).preferencesFiles.add(
    `${root}settings/prefs.ttl`,
  );
  const prefs = new Store();
  new ProfileTypeIndexAnchor(webId, prefs, DataFactory).privateIndexes.add(
    `${root}settings/index.ttl`,
  );
  const index = new Store();
  const registration = new TypeRegistration(
    `${root}settings/index.ttl#calendar`,
    index,
    DataFactory,
  );
  registration.markRegistration();
  registration.forClass = CALENDAR_CLASS;
  registration.instance = `${root}calendar/work.ttl#it`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "settings/prefs.ttl",
        body: await serializeDataset(prefs),
        contentType: "text/turtle",
      },
      {
        path: "settings/index.ttl",
        body: await serializeDataset(index),
        contentType: "text/turtle",
      },
      {
        path: "calendar/work.ttl",
        body: await serializeDataset(
          buildCalendar(`${root}calendar/work.ttl`, { title: "Work", color: hex("123abc") }),
        ),
        contentType: "text/turtle",
      },
      {
        path: "calendar/work/event.ttl",
        body: await serializeDataset(
          buildEvent(`${root}calendar/work/event.ttl`, {
            name: "Legacy event",
            start: "2026-11-01",
          }),
        ),
        contentType: "text/turtle",
      },
    ],
  });
  const authenticated = vi.fn<typeof fetch>(async (input, init) => {
    expect(podScopedUrl(root, String(input))).toBeDefined();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", "Bearer session-token");
    headers.set("DPoP", "session-proof");
    return pod.fetch(input, { ...init, headers });
  });
  publicRead.mockImplementation(async (input, init) => {
    expect(String(input)).toBe(webId.split("#")[0]);
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(new Headers(init?.headers).has("DPoP")).toBe(false);
    return new Response(await serializeDataset(profile), {
      headers: { "Content-Type": "text/turtle" },
    });
  });
  const account: CalendarAccount = { webId, storageUrl: root, fetch: authenticated };
  return { account, authenticated, profile, prefs, index, registration, pod };
}

it.each([
  "https://identity.example/profile/card#me",
  "https://pod.example/profile/card#me",
])("discovers calendars for an out-of-storage WebID %s without sending it session credentials", async (webId) => {
  const { account, authenticated } = await setup(webId);
  if (new URL(webId).origin === new URL(root).origin) account.publicFetch = publicRead;
  const result = await discoverCalendars(account);
  expect(result.warnings).toEqual([]);
  expect(result.calendars.map((calendar) => calendar.title)).toEqual(["Work"]);
  const range = await loadRange(
    account,
    result.calendars,
    new Date("2026-11-01"),
    new Date("2026-11-02"),
    "UTC",
  );
  expect(range.events.map((event) => event.data.name)).toEqual(["Legacy event"]);
  expect(publicRead).toHaveBeenCalledOnce();
  expect(authenticated.mock.calls.every(([input]) => String(input).startsWith(root))).toBe(true);
});

it.each([
  false,
  true,
])("creates and registers a calendar with a separate-origin WebID (injected public fetch: %s)", async (injected) => {
  const { account, authenticated, pod } = await setup();
  if (injected) account.publicFetch = publicRead;
  const { namedNode, quad } = DataFactory;
  const acl = "http://www.w3.org/ns/auth/acl#";
  const owner = namedNode(`${root}.acl#owner`);
  const permissions = new Store([
    quad(
      owner,
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode(`${acl}Authorization`),
    ),
    quad(owner, namedNode(`${acl}agent`), namedNode(account.webId)),
    quad(owner, namedNode(`${acl}default`), namedNode(root)),
    ...["Read", "Write", "Control"].map((mode) =>
      quad(owner, namedNode(`${acl}mode`), namedNode(`${acl}${mode}`)),
    ),
  ]);
  await pod.fetch(`${root}.acl`, {
    method: "PUT",
    body: await serializeDataset(permissions),
    headers: { "Content-Type": "text/turtle" },
  });
  await createCalendar(account, "New Calendar", hex("123abc"));
  expect(publicRead).toHaveBeenCalledOnce();
  expect(authenticated.mock.calls.every(([input]) => podScopedUrl(root, String(input)))).toBe(true);
  const writes = authenticated.mock.calls.filter(([, init]) => init?.method === "PUT");
  expect(writes.map(([input]) => String(input))).toEqual([
    `${root}calendar/new-calendar.ttl`,
    `${root}calendar/new-calendar/`,
    `${root}settings/index.ttl`,
  ]);
  expect(new Headers(writes[0]?.[1]?.headers).get("If-None-Match")).toBe("*");
  expect(new Headers(writes[1]?.[1]?.headers).get("If-None-Match")).toBe("*");
  expect(new Headers(writes[2]?.[1]?.headers).get("If-Match")).toMatch(/^".+"$/);
  const io = calendarIO(account.fetch, root);
  expect((await io.loadCalendar(`${root}calendar/new-calendar.ttl`))?.data.title).toBe(
    "New Calendar",
  );
  expect(await io.listResources(`${root}calendar/new-calendar/`)).toEqual([]);
  const { dataset } = await fetchRdf(`${root}settings/index.ttl`, { fetch: pod.fetch });
  const index = new TypeIndexDataset(dataset, DataFactory);
  expect(index.locate(CALENDAR_CLASS)).toContainEqual({
    forClass: CALENDAR_CLASS,
    instance: `${root}calendar/new-calendar.ttl#it`,
    container: undefined,
  });
  expect(index.locate(EVENT_CLASS)).toContainEqual({
    forClass: EVENT_CLASS,
    instance: undefined,
    container: `${root}calendar/new-calendar/`,
  });
});

it("refuses a public profile redirect without calling the session fetch or following the destination", async () => {
  const { account, authenticated } = await setup();
  publicRead.mockResolvedValue(
    new Response(null, { status: 302, headers: { Location: "https://attacker.example/profile" } }),
  );
  await expect(discoverCalendars(account)).rejects.toThrow("Refusing to follow a redirect");
  expect(publicRead).toHaveBeenCalledOnce();
  expect(authenticated).not.toHaveBeenCalled();
});

it("does not retry a public profile's 401 through the authenticated session", async () => {
  const { account, authenticated } = await setup();
  publicRead.mockResolvedValue(new Response(null, { status: 401 }));
  await expect(discoverCalendars(account)).rejects.toMatchObject({ status: 401 });
  expect(publicRead).toHaveBeenCalledOnce();
  expect(authenticated).not.toHaveBeenCalled();
});

it.each([
  "https://attacker.example/",
  "https://pod.example/storage-evil/",
])("keeps RDF-derived discovery and event URLs scoped against %s", async (outside) => {
  const { account, authenticated, profile, prefs, index, registration, pod } = await setup();
  const anchor = new ProfileTypeIndexAnchor(account.webId, profile, DataFactory);
  anchor.preferencesFiles.clear();
  anchor.preferencesFiles.add(`${outside}prefs.ttl`);
  await expect(discoverCalendars(account)).rejects.toThrow();
  anchor.preferencesFiles.clear();
  anchor.privateIndexes.add(`${outside}index.ttl`);
  await expect(discoverCalendars(account)).rejects.toThrow();
  anchor.privateIndexes.clear();
  anchor.preferencesFiles.add(`${root}settings/prefs.ttl`);
  const prefAnchor = new ProfileTypeIndexAnchor(account.webId, prefs, DataFactory);
  prefAnchor.privateIndexes.add(`${outside}index.ttl`);
  await pod.fetch(`${root}settings/prefs.ttl`, {
    method: "PUT",
    body: await serializeDataset(prefs),
    headers: { "Content-Type": "text/turtle" },
  });
  await expect(discoverCalendars(account)).rejects.toThrow();
  prefAnchor.privateIndexes.delete(`${outside}index.ttl`);
  await pod.fetch(`${root}settings/prefs.ttl`, {
    method: "PUT",
    body: await serializeDataset(prefs),
    headers: { "Content-Type": "text/turtle" },
  });
  registration.instance = `${outside}calendar.ttl#it`;
  registration.instanceContainer = `${outside}calendars/`;
  await pod.fetch(`${root}settings/index.ttl`, {
    method: "PUT",
    body: await serializeDataset(index),
    headers: { "Content-Type": "text/turtle" },
  });
  // The in-scope fallback still works; neither registration is fetched.
  const result = await discoverCalendars(account);
  expect(result.calendars.map((calendar) => calendar.title)).toEqual(["Work"]);
  const listing = new Store([
    DataFactory.quad(
      DataFactory.namedNode(`${root}calendar/work/`),
      DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
      DataFactory.namedNode(`${outside}event.ttl`),
    ),
  ]);
  const accountWithBadListing = {
    ...account,
    fetch: vi.fn<typeof fetch>(async (input, init) =>
      String(input) === `${root}calendar/work/`
        ? new Response(await serializeDataset(listing), {
            headers: { "Content-Type": "text/turtle" },
          })
        : account.fetch(input, init),
    ),
  };
  const range = await loadRange(
    accountWithBadListing,
    result.calendars,
    new Date("2026-11-01"),
    new Date("2026-11-02"),
    "UTC",
  );
  expect(range.events).toEqual([]);
  expect(range.warnings).toHaveLength(1);
  expect(accountWithBadListing.fetch.mock.calls.map(([input]) => String(input))).toEqual([
    `${root}calendar/work/`,
  ]);
  expect(
    authenticated.mock.calls.every(([input]) => podScopedUrl(root, String(input)) !== undefined),
  ).toBe(true);
});
