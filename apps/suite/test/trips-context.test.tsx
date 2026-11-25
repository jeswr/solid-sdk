// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openTrips } from "../src/apps/trips/lib/data/open";
import { TripsProvider, useTrips } from "../src/apps/trips/state/trips-context";
import type { PodSession } from "../src/lib/session/pod-session";

vi.mock("../src/apps/trips/lib/data/open", () => ({ openTrips: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({ toast: { error: vi.fn() } }));
const host = document.createElement("div");
document.body.append(host);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = undefined;
  vi.clearAllMocks();
});
const session = {
  mode: "demo",
  webId: "https://pod.example/card#me",
  storageUrl: "https://pod.example/",
  fetch: globalThis.fetch,
  subscribe: () => () => {},
  reset: async () => {},
  displayName: "Example",
} as PodSession;
const store = { load: vi.fn(async () => ({ trips: [], reservations: [] })) } as unknown as Awaited<
  ReturnType<typeof openTrips>
>["store"];
function Consumer() {
  const value = useTrips();
  return (
    <p>
      {value.session.webId}: {value.trips.length} trips
    </p>
  );
}
function Fixture({ account = session }: { account?: PodSession }) {
  return (
    <TripsProvider
      session={account}
      fallback={(error, retry) => (
        <button type="button" onClick={retry}>
          {error ? "Retry" : "Loading"}
        </button>
      )}
    >
      <Consumer />
    </TripsProvider>
  );
}
describe("Trips session context", () => {
  it("loads a session and ignores late results after account replacement", async () => {
    let resolve: (value: Awaited<ReturnType<typeof openTrips>>) => void = () => {};
    vi.mocked(openTrips)
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ store, snapshot: { trips: [], reservations: [] } });
    root = createRoot(host);
    await act(() => root?.render(<Fixture />));
    expect(host.textContent).toBe("Loading");
    const other = { ...session, webId: "https://other.example/card#me" };
    await act(() => root?.render(<Fixture account={other} />));
    expect(host.textContent).toContain(other.webId);
    await act(() => resolve({ store, snapshot: { trips: [], reservations: [] } }));
    expect(host.textContent).toContain(other.webId);
  });
  it("reports failure and retries without leaking a previous account", async () => {
    vi.mocked(openTrips)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ store, snapshot: { trips: [], reservations: [] } });
    root = createRoot(host);
    await act(() => root?.render(<Fixture />));
    expect(host.textContent).toBe("Retry");
    await act(() => host.querySelector("button")?.click());
    expect(host.textContent).toContain("0 trips");
  });
});

it("ignores a late session-opening rejection after unmount", async () => {
  let reject: (reason: Error) => void = () => {};
  vi.mocked(openTrips).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  root = createRoot(host);
  await act(() => root?.render(<Fixture />));
  await act(() => root?.unmount());
  root = undefined;
  await act(() => reject(new Error("offline")));
  expect(host.textContent).toBe("");
});
it("requires its provider and reports asynchronous write failures through toast", async () => {
  expect(() => renderToString(<Consumer />)).toThrow("Trips provider is required");
  root = createRoot(host);
  const failedStore = {
    ...store,
    saveTrip: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
  vi.mocked(openTrips).mockResolvedValue({
    store: failedStore,
    snapshot: { trips: [], reservations: [] },
  });
  function Add() {
    const value = useTrips();
    return (
      <button
        type="button"
        onClick={() =>
          value.state.add({
            id: "pending:new",
            name: "Example",
            startDate: "2026-12-01",
            endDate: "2026-12-02",
            reservations: [],
          })
        }
      >
        Add
      </button>
    );
  }
  await act(() =>
    root?.render(
      <TripsProvider session={session} fallback={() => null}>
        <Add />
      </TripsProvider>,
    ),
  );
  await act(() => host.querySelector("button")?.click());
  const { toast } = await import("@jeswr/suite-ui");
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"));
});
