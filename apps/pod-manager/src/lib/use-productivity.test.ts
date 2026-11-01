// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataFactory } from "n3";
import {
  createMemoryPod,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "@jeswr/pod-connectors/testing";
import { useSession } from "@/components/session-provider";
import { useStore } from "@/components/use-productivity";
import { readProfile } from "./profile.js";
import type { ProductivityStore } from "./productivity-store.js";
import { TypeIndexDataset, typeIndexLinks } from "./type-index.js";
import { notesStore, NOTE_CLASS } from "./notes.js";
import { calendarStore, EVENT_CLASS } from "./calendar.js";
import { contactsStore, CONTACT_CLASS } from "./contacts.js";
import { issuesStore, ISSUE_CLASS } from "./issues.js";
import { tasksStore, TASK_CLASS } from "./tasks.js";
import { scheduleStore, POLL_CLASS } from "./schedule.js";
import { groupsStore, GROUP_CLASS } from "./social.js";
import { bookmarksStore, BOOKMARK_CLASS } from "./bookmarks.js";

vi.mock("@/components/session-provider", () => ({ useSession: vi.fn() }));

const PROFILE_URL = "https://profiles.example/alice/card?view=public";
const INDEX_URL = `${TEST_POD_ROOT}settings/privateTypeIndex.ttl`;

function sessionStore<T>(
  factory: (opts: {
    podRoot: string;
    webId: string;
    profileDocumentUrl: string;
  }) => ProductivityStore<T>,
): ProductivityStore<T> | undefined {
  let store: ProductivityStore<T> | undefined;
  function Harness() {
    store = useStore(factory);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return store;
}

const cases = [
  {
    name: "notes",
    forClass: NOTE_CLASS,
    create: () => sessionStore(notesStore)!.create({ title: "Note", text: "Body" }),
  },
  {
    name: "calendar",
    forClass: EVENT_CLASS,
    create: () =>
      sessionStore(calendarStore)!.create({
        name: "Meeting",
        start: new Date("2026-10-25T12:00:00Z"),
      }),
  },
  {
    name: "contacts",
    forClass: CONTACT_CLASS,
    create: () => sessionStore(contactsStore)!.create({ fn: "Alice" }),
  },
  {
    name: "issues",
    forClass: ISSUE_CLASS,
    create: () => sessionStore(issuesStore)!.create({ title: "Issue", state: "open" }),
  },
  {
    name: "tasks",
    forClass: TASK_CLASS,
    create: () =>
      sessionStore(tasksStore)!.create({ title: "Task", completed: false, priority: "none" }),
  },
  {
    name: "schedule",
    forClass: POLL_CLASS,
    create: () =>
      sessionStore(scheduleStore)!.create({ name: "Poll", options: [], rsvps: [], invitees: [] }),
  },
  {
    name: "groups",
    forClass: GROUP_CLASS,
    create: () => sessionStore(groupsStore)!.create({ name: "Group", members: [] }),
  },
  {
    name: "bookmarks",
    forClass: BOOKMARK_CLASS,
    create: () =>
      sessionStore(bookmarksStore)!.create({
        title: "Bookmark",
        url: "https://example.org/",
        tags: [],
      }),
  },
];

describe("productivity stores with a redirected WebID", () => {
  let pod: ReturnType<typeof createMemoryPod>;
  let podFetch: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    pod = createMemoryPod();
    await pod.fetch(PROFILE_URL, { method: "PUT", body: pod.get(TEST_PROFILE_DOC) });
    const profile = {
      ...readProfile(TEST_WEBID, pod.dataset(PROFILE_URL)),
      profileDocumentUrl: PROFILE_URL,
    };
    podFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).split("#")[0] === TEST_PROFILE_DOC) {
        return new Response(null, { status: 302, headers: { location: PROFILE_URL } });
      }
      return pod.fetch(input, init);
    });
    vi.stubGlobal("fetch", podFetch);
    vi.mocked(useSession).mockReturnValue({
      status: "logged-in",
      webId: TEST_WEBID,
      activeStorage: TEST_POD_ROOT,
      profile,
      sourceFetch: pod.fetch,
      podFetch,
      recentAccounts: [],
      login: vi.fn(),
      loginWithIssuer: vi.fn(),
      cancelLogin: vi.fn(),
      logout: vi.fn(),
      setActiveStorage: vi.fn(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(
    cases,
  )("creates $name through the session's resolved profile and reuses its index", async ({
    create,
    forClass,
  }) => {
    const first = await create();
    expect(first.etag).toBeTruthy();
    expect(pod.get(first.url)).toBeDefined();
    expect(typeIndexLinks(TEST_WEBID, pod.dataset(PROFILE_URL)).privateIndex).toBe(INDEX_URL);
    expect(typeIndexLinks(TEST_WEBID, pod.dataset(TEST_PROFILE_DOC)).privateIndex).toBeUndefined();
    const index = new TypeIndexDataset(pod.dataset(INDEX_URL), DataFactory);
    expect(index.locate(forClass)).toEqual([
      {
        forClass,
        instance: undefined,
        container: first.url.slice(0, first.url.lastIndexOf("/") + 1),
      },
    ]);

    const second = await create();
    expect(pod.get(second.url)).toBeDefined();
    const profileCalls = podFetch.mock.calls.filter(([input]) => String(input) === PROFILE_URL);
    expect(profileCalls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
    expect(new Headers(profileCalls[1][1]?.headers).get("if-match")).toBe('"v1"');
    const registrationCalls = podFetch.mock.calls.filter(([input]) =>
      [PROFILE_URL, INDEX_URL].includes(String(input)),
    );
    expect(registrationCalls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(podFetch.mock.calls.map(([input]) => String(input).split("#")[0])).not.toContain(
      TEST_PROFILE_DOC,
    );
    expect(
      podFetch.mock.calls.filter(
        ([input, init]) => String(input) === INDEX_URL && init?.method === "PUT",
      ),
    ).toHaveLength(2);
  });

  it.each([
    "profile-read",
    "profile-write",
    "index-read",
    "index-create",
    "index-update",
  ])("refuses an authenticated %s redirect before saving the item", async (target) => {
    if (target === "index-read" || target === "index-update") {
      await sessionStore(contactsStore)!.ensureRegistered();
    }
    podFetch.mockClear();
    const redirectFrom = target.startsWith("profile") ? PROFILE_URL : INDEX_URL;
    const method = target.endsWith("read") ? "GET" : "PUT";
    const redirectTo = `${TEST_POD_ROOT}other.ttl`;
    const before = pod.get(redirectFrom);
    podFetch.mockImplementation(async (input, init) => {
      if (String(input) === redirectFrom && (init?.method ?? "GET") === method) {
        return new Response(null, { status: 307, headers: { location: redirectTo } });
      }
      return pod.fetch(input, init);
    });

    await expect(
      sessionStore(notesStore)!.create({ title: "Note", text: "Body" }),
    ).rejects.toThrow();
    expect(pod.get(redirectFrom)).toBe(before);
    expect(
      podFetch.mock.calls.some(
        ([input, init]) =>
          String(input) === redirectFrom &&
          (init?.method ?? "GET") === method &&
          init?.redirect === "manual",
      ),
    ).toBe(true);
    expect(podFetch.mock.calls.map(([input]) => String(input))).not.toContain(redirectTo);
    expect(
      podFetch.mock.calls.some(([input]) => String(input).startsWith(`${TEST_POD_ROOT}notes/`)),
    ).toBe(false);
  });

  it("waits for the session profile before constructing a store", () => {
    vi.mocked(useSession).mockReturnValue({ ...useSession(), profile: undefined });
    expect(sessionStore(notesStore)).toBeUndefined();
    expect(podFetch).not.toHaveBeenCalled();
  });
});
