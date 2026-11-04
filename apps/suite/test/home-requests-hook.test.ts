// AUTHORED-BY Claude Opus 5.5
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Writer } from "n3";
import { beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  session: undefined as unknown as PodSession,
  list: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => mocks.session }));
vi.mock("@jeswr/pod-access/requests-solid", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listRequests: mocks.list,
  decide: mocks.decide,
}));

import type { AccessRequestEntry } from "@jeswr/pod-access/requests-solid";
import { type RequestCard, requestCards } from "../src/apps/home/lib/requests/model";
import {
  FOCUS_REFRESH_MS,
  type RequestsBinding,
  requestOptions,
  summarizeCards,
  useCardSummaries,
  useRequestCaps,
  useRequests,
} from "../src/apps/home/state/requests";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { ACTIVITY_CLASS } from "../src/lib/demo-pod/seed-requests";

const ROOT = "https://pod.test/";
const NOW = Date.now();
const pending: AccessRequestEntry = {
  id: `${ROOT}inbox/1.ttl`,
  status: "pending",
  requester: "https://coach.example/card#me",
  dataTypes: [ACTIVITY_CLASS],
  modes: ["read"],
  modesByType: { [ACTIVITY_CLASS]: ["read"] },
  created: new Date(NOW - 1000).toISOString(),
};
const decided: AccessRequestEntry = {
  ...pending,
  id: `${ROOT}inbox/2.ttl`,
  status: "approved",
  decidedAt: new Date(NOW - 86_400_000).toISOString(),
};

let binding: RequestsBinding;
function Probe() {
  binding = useRequests();
  return null;
}
function session(overrides: Partial<PodSession> = {}): PodSession {
  return {
    mode: "demo",
    webId: `${ROOT}profile#me`,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch: vi.fn<typeof fetch>(),
    subscribe: () => () => {},
    reset: async () => {},
    ...overrides,
  } as PodSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = session();
  mocks.list.mockResolvedValue([pending, decided, { id: `${ROOT}inbox/x`, status: "unreadable" }]);
});

it("lists with the session's fetch and splits pending, decided and unreadable", async () => {
  await mount(h(Probe));
  expect(binding.status).toBe("ready");
  expect(binding.pending).toEqual([pending]);
  expect(binding.decided).toEqual([decided]);
  expect(binding.unreadable).toEqual([{ id: `${ROOT}inbox/x`, status: "unreadable" }]);
  expect(mocks.list).toHaveBeenCalledWith({
    fetch: mocks.session.fetch,
    webId: `${ROOT}profile#me`,
    storage: ROOT,
  });
});

it("passes an extension session's unauthenticated fetch for public reads", () => {
  const publicFetch = vi.fn<typeof fetch>();
  const extension = session({ mode: "extension", publicFetch } as Partial<PodSession>);
  expect(requestOptions(extension)).toMatchObject({ publicFetch });
});

it("shares one listing between mounted surfaces and supersedes a stale one on refresh", async () => {
  const first = deferred<AccessRequestEntry[]>();
  mocks.list.mockReturnValueOnce(first.promise);
  const views: RequestsBinding[] = [];
  const Both = () => {
    views[0] = useRequests();
    views[1] = useRequests();
    return null;
  };
  await mount(h(Both));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(views[0]?.status).toBe("loading");
  mocks.list.mockResolvedValueOnce([]);
  await act(() => views[0]?.refresh());
  expect(views[1]?.pending).toEqual([]);
  await act(async () => first.resolve([pending]));
  expect(views[0]?.pending).toEqual([]);
  expect(views[1]?.status).toBe("ready");
});

it("shows an error until a retry succeeds, and keeps shown requests when a refresh fails", async () => {
  mocks.list.mockRejectedValueOnce(new Error("offline"));
  await mount(h(Probe));
  expect(binding.status).toBe("error");
  await act(() => binding.refresh());
  expect(binding.status).toBe("ready");
  mocks.list.mockRejectedValueOnce(new Error("flaky"));
  await act(() => binding.refresh());
  expect(binding.status).toBe("ready");
  expect(binding.pending).toEqual([pending]);
});

it("decides through the SDK in one call and re-lists whatever the outcome", async () => {
  await mount(h(Probe));
  const result = {
    status: "approved",
    receiptUrl: `${ROOT}r`,
    notified: false,
    expiryEnforced: false,
  };
  mocks.decide.mockResolvedValueOnce(result);
  mocks.list.mockResolvedValue([
    { ...pending, status: "approved", decidedAt: new Date().toISOString() },
  ]);
  const readable = binding.pending[0] as Exclude<AccessRequestEntry, { status: "unreadable" }>;
  let outcome: unknown;
  await act(async () => {
    outcome = await binding.decide(readable, { approve: true, dataTypes: [ACTIVITY_CLASS] });
  });
  expect(outcome).toBe(result);
  expect(mocks.decide).toHaveBeenCalledWith(
    readable,
    { approve: true, dataTypes: [ACTIVITY_CLASS] },
    { fetch: mocks.session.fetch, webId: `${ROOT}profile#me`, storage: ROOT },
  );
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(binding.pending).toEqual([]);
  mocks.decide.mockRejectedValueOnce(new Error("refused"));
  await act(async () => {
    await expect(binding.decide(readable, { approve: false })).rejects.toThrow("refused");
  });
  expect(mocks.list).toHaveBeenCalledTimes(3);
});

it("drops a decided request from Pending at once, while the re-list runs and after it fails", async () => {
  await mount(h(Probe));
  const relist = deferred<AccessRequestEntry[]>();
  mocks.list.mockReturnValueOnce(relist.promise);
  mocks.decide.mockResolvedValue({
    status: "denied",
    receiptUrl: `${ROOT}r`,
    notified: false,
    expiryEnforced: false,
  });
  const readable = binding.pending[0] as Exclude<AccessRequestEntry, { status: "unreadable" }>;
  await act(async () => {
    await binding.decide(readable, { approve: false });
  });
  // The re-list is still running and the last listing still says pending; it is gone all the same.
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(binding.pending).toEqual([]);
  await act(async () => relist.reject(new Error("offline")));
  expect(binding.pending).toEqual([]);
  // A later listing that still shows it pending (a stale cache) doesn't bring it back.
  mocks.list.mockResolvedValueOnce([pending]);
  await act(() => binding.refresh());
  expect(binding.pending).toEqual([]);
  // Unreadable requests leave the same way; a failed decision leaves the list as it was.
  const unreadable: AccessRequestEntry = { id: `${ROOT}inbox/x`, status: "unreadable" };
  mocks.list.mockResolvedValue([pending, unreadable]);
  await act(() => binding.refresh());
  expect(binding.unreadable).toEqual([unreadable]);
  mocks.decide.mockRejectedValueOnce(new Error("Unreadable access request"));
  await act(async () => {
    await expect(binding.decide(unreadable, { approve: false })).rejects.toThrow();
  });
  expect(binding.unreadable).toEqual([unreadable]);
  await act(async () => {
    await binding.decide(unreadable, { approve: false });
  });
  expect(binding.unreadable).toEqual([]);
});

it("remembers a dismissed unreadable-items note for the session, across surfaces", async () => {
  const views: RequestsBinding[] = [];
  const Both = () => {
    views[0] = useRequests();
    views[1] = useRequests();
    return null;
  };
  const view = await mount(h(Both));
  expect(views[0]?.unreadable).toHaveLength(1);
  expect(views[0]?.unreadableDismissed).toBe(false);
  await act(async () => views[0]?.dismissUnreadable());
  expect(views[1]?.unreadableDismissed).toBe(true);
  await view.unmount();
  await mount(h(Probe));
  expect(binding.unreadableDismissed).toBe(true);
  // Another session starts with the note shown again.
  mocks.session = session({ fetch: vi.fn<typeof fetch>() });
  await mount(h(Probe));
  expect(binding.unreadableDismissed).toBe(false);
});

it("refreshes on focus at most once a minute", async () => {
  await mount(h(Probe));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(mocks.list).toHaveBeenCalledTimes(1);
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + FOCUS_REFRESH_MS + 1);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(mocks.list).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it("defaults capabilities to no requests and no expiry", async () => {
  let caps: ReturnType<typeof useRequestCaps> | undefined;
  const Caps = () => {
    caps = useRequestCaps();
    return null;
  };
  await mount(h(Caps));
  expect(caps).toEqual({ accessRequests: false, grantExpiry: false });
});

async function stravaRun(): Promise<string> {
  const { namedNode, quad } = DataFactory;
  const run = namedNode(`${DEMO_ROOT}integrations/strava/run.ttl#it`);
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([
    quad(run, namedNode(`${NS.RDF}type`), namedNode(ACTIVITY_CLASS)),
    quad(run, namedNode(`${NS.SCHEMA}url`), namedNode("https://www.strava.com/activities/1")),
  ]);
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}

it("counts each card's items and connected sources from the Home model", async () => {
  const seed = await buildDemoSeed(NOW);
  seed.push({
    path: "integrations/strava/run.ttl",
    body: await stravaRun(),
    contentType: "text/turtle",
  });
  const pod = createDemoPod({ root: DEMO_ROOT, seed });
  const cards = requestCards({
    dataTypes: [ACTIVITY_CLASS, "https://vocab.example/Thing"],
    modesByType: {},
  });
  const demo = { fetch: pod.fetch, webId: DEMO_WEBID, storageUrl: DEMO_ROOT };
  expect(await summarizeCards(demo, cards)).toEqual({
    activity: { count: 2, sources: ["Strava"] },
  });
  expect(await summarizeCards(demo, cards.slice(1))).toEqual({});
  // A profile outside storage is not read with the pod's credentials; known folders still count.
  expect(
    await summarizeCards({ ...demo, webId: "https://elsewhere.example/card#me" }, cards),
  ).toEqual({ activity: { count: 2, sources: ["Strava"] } });
  // A domain whose discovery failed has no reliable count.
  const failing: typeof fetch = async (input, init) =>
    String(input).startsWith(`${DEMO_ROOT}health/`)
      ? new Response(null, { status: 500 })
      : pod.fetch(input, init);
  expect(await summarizeCards({ ...demo, fetch: failing }, cards)).toEqual({});
});

it("exposes summaries to the open review and tolerates failures", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
  mocks.session = session({ fetch: pod.fetch, webId: DEMO_WEBID, storageUrl: DEMO_ROOT });
  const cards: RequestCard[] = requestCards({ dataTypes: [ACTIVITY_CLASS], modesByType: {} });
  let summaries: ReturnType<typeof useCardSummaries> = {};
  const Summary = () => {
    summaries = useCardSummaries(cards);
    return null;
  };
  const view = await mount(h(Summary));
  await vi.waitFor(() => expect(summaries).toEqual({ activity: { count: 1, sources: [] } }));
  await view.unmount();
  mocks.session = session({
    fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 403 })),
  });
  const broken = await mount(h(Summary));
  await act(async () => {});
  expect(summaries).toEqual({});
  await broken.unmount();
});
