// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { PlaceData, PlacesRepository, PlacesSnapshot } from "@jeswr/solid-places";
import { describe, expect, it, vi } from "vitest";
import { sampleWeek } from "../src/apps/places/demo/sample";
import { placesController } from "../src/apps/places/state/controller";

const place = {
  url: "https://pod.example/places/places/1.ttl",
  etag: '"1"',
  data: {
    name: "Park",
    category: "outdoors",
    saved: false,
    latitude: 50,
    longitude: -1,
  } satisfies PlaceData,
};
const initial = (): PlacesSnapshot => ({
  places: [structuredClone(place)],
  visits: [],
  journeys: [],
});
function setup(demo = false) {
  const repo = {
    base: "https://pod.example/places/",
    initialize: vi.fn(async () => {}),
    load: vi.fn(async () => initial()),
    savePlace: vi.fn(async (before, patch) => ({
      ...before,
      data: { ...before.data, ...patch },
      etag: '"2"',
    })),
    importTimeline: vi.fn<PlacesRepository["importTimeline"]>(async () => {}),
  } satisfies PlacesRepository;
  const failed = vi.fn();
  const controller = placesController(repo, demo, failed);
  return { repo, failed, controller };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
it("opens, publishes, unsubscribes and fences a superseded read", async () => {
  const { controller, repo } = setup();
  expect(controller.getSnapshot().status).toBe("loading");
  const listener = vi.fn();
  const stop = controller.subscribe(listener);
  await controller.open();
  expect(controller.getSnapshot().status).toBe("ready");
  expect(listener).toHaveBeenCalled();
  stop();
  listener.mockClear();
  const slow = deferred<PlacesSnapshot>();
  repo.load.mockReturnValueOnce(slow.promise);
  const first = controller.refresh();
  await controller.refresh();
  slow.resolve({ ...initial(), places: [] });
  await first;
  expect(controller.getSnapshot().snapshot.places).toHaveLength(1);
  expect(listener).not.toHaveBeenCalled();
});
it("seeds a realistic week only for demo sessions", async () => {
  const { controller, repo } = setup(true);
  await controller.open();
  expect(repo.importTimeline).toHaveBeenCalledWith(sampleWeek());
  const real = setup();
  await real.controller.open();
  expect(real.repo.importTimeline).not.toHaveBeenCalled();
  expect(sampleWeek().visits).toHaveLength(15);
  expect(sampleWeek().journeys).toHaveLength(7);
});
it("hides stale data after failed privacy checks or refreshes and can retry", async () => {
  const { controller, repo } = setup();
  repo.initialize.mockRejectedValueOnce(new Error("Shared"));
  await controller.open();
  expect(controller.getSnapshot()).toMatchObject({ status: "error", snapshot: { places: [] } });
  await controller.open();
  repo.load.mockRejectedValueOnce(new Error("Forbidden"));
  await controller.refresh();
  expect(controller.getSnapshot().status).toBe("error");
  expect(controller.getSnapshot().snapshot.places).toEqual([]);
});
it("shows edits immediately and persists against the confirmed version", async () => {
  const { controller, repo } = setup();
  await controller.open();
  const pending = deferred<typeof place>();
  repo.savePlace.mockReturnValueOnce(pending.promise);
  const saving = controller.save(place, { name: "My park" });
  expect(controller.getSnapshot().snapshot.places[0]?.data.name).toBe("My park");
  expect(controller.getSnapshot().saving).toBe(1);
  await controller.refresh();
  expect(repo.load).toHaveBeenCalledTimes(1);
  pending.resolve({ ...place, data: { ...place.data, name: "My park" }, etag: '"2"' });
  await saving;
  expect(controller.getSnapshot().saving).toBe(0);
  expect(controller.getSnapshot().snapshot.places[0]?.etag).toBe('"2"');
});
it("rolls back a failed edit while retaining a newer patch to another field", async () => {
  const { controller, repo, failed } = setup();
  await controller.open();
  const pending = deferred<typeof place>();
  repo.savePlace.mockReturnValueOnce(pending.promise);
  const first = controller.save(place, { name: "Failed name" });
  const second = controller.save(place, { notes: "Kept note" });
  pending.reject(new Error("Offline"));
  await Promise.all([first, second]);
  expect(failed).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().snapshot.places[0]?.data).toMatchObject({
    name: "Park",
    notes: "Kept note",
  });
});
it("does not resurrect two failed edits or write no-ops", async () => {
  const { controller, repo } = setup();
  await controller.open();
  repo.savePlace.mockRejectedValue(new Error("Offline"));
  await Promise.all([
    controller.save(place, { name: "One" }),
    controller.save(place, { name: "Two" }),
  ]);
  expect(controller.getSnapshot().snapshot.places[0]?.data.name).toBe("Park");
  repo.savePlace.mockClear();
  await controller.save(place, { name: "Park" });
  expect(repo.savePlace).not.toHaveBeenCalled();
});
it("imports with progress and reconciles partial failures", async () => {
  const { controller, repo } = setup();
  await controller.open();
  await controller.importTimeline(sampleWeek());
  expect(repo.importTimeline).toHaveBeenLastCalledWith(
    sampleWeek(),
    expect.any(Function),
    expect.any(AbortSignal),
  );
  expect(controller.getSnapshot().import.stage).toBe("done");
  expect(repo.load).toHaveBeenCalledTimes(2);
  repo.importTimeline.mockRejectedValueOnce(new Error("Partial"));
  await expect(controller.importTimeline(sampleWeek())).rejects.toThrow("Partial");
  expect(controller.getSnapshot().saving).toBe(0);
  expect(repo.load).toHaveBeenCalledTimes(3);
});
it("drops late responses and queued writes after disposal", async () => {
  const { controller, repo } = setup();
  const slow = deferred<PlacesSnapshot>();
  repo.load.mockReturnValue(slow.promise);
  const opening = controller.open();
  controller.dispose();
  slow.resolve(initial());
  await opening;
  expect(controller.getSnapshot().status).toBe("loading");
  const other = setup();
  await other.controller.open();
  const saving = other.controller.save(place, { name: "Gone" });
  other.controller.dispose();
  await saving;
  expect(other.repo.savePlace).not.toHaveBeenCalled();
});
it("ignores obsolete opening failures after a newer retry succeeds", async () => {
  const { controller, repo } = setup();
  const delayed = deferred<void>();
  repo.initialize.mockReturnValueOnce(delayed.promise);
  const obsolete = controller.open();
  await controller.open();
  delayed.reject(new Error("Old error"));
  await obsolete;
  expect(controller.getSnapshot().status).toBe("ready");
});
it("ignores obsolete refresh failures after a newer refresh succeeds", async () => {
  const { controller, repo } = setup();
  await controller.open();
  const delayed = deferred<PlacesSnapshot>();
  repo.load.mockReturnValueOnce(delayed.promise);
  const obsolete = controller.refresh();
  await controller.refresh();
  delayed.reject(new Error("Old error"));
  await obsolete;
  expect(controller.getSnapshot().status).toBe("ready");
});
it("handles a removed place without discarding unrelated confirmed places", async () => {
  const { controller, repo, failed } = setup();
  const second = { ...place, url: place.url + "2" };
  repo.load.mockResolvedValueOnce({ ...initial(), places: [place, second] });
  await controller.open();
  await controller.save(place, { name: "Updated" });
  expect(controller.getSnapshot().snapshot.places[1]).toEqual(second);
  await controller.save({ ...place, url: place.url + "missing" }, { name: "Missing" });
  expect(failed).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().snapshot.places).toHaveLength(2);
});
it("suppresses late save errors after the selected account closes", async () => {
  const { controller, repo, failed } = setup();
  await controller.open();
  const delayed = deferred<typeof place>();
  repo.savePlace.mockReturnValueOnce(delayed.promise);
  const pending = controller.save(place, { name: "Pending" });
  await Promise.resolve();
  controller.dispose();
  delayed.reject(new Error("Late failure"));
  await pending;
  expect(failed).not.toHaveBeenCalled();
});
it("keeps account-owned imports and progress when subscribers leave and return", async () => {
  const { controller, repo } = setup();
  await controller.open();
  const done = deferred<void>();
  let active!: AbortSignal;
  vi.mocked(repo.importTimeline).mockImplementationOnce(async (_input, progress, signal) => {
    active = signal!;
    progress!(2, 26);
    await done.promise;
  });
  const unsubscribe = controller.subscribe(vi.fn());
  const importing = controller.importTimeline(sampleWeek());
  await Promise.resolve();
  unsubscribe();
  expect(active.aborted).toBe(false);
  expect(controller.getSnapshot().import).toMatchObject({
    stage: "saving",
    progress: { done: 2, total: 26 },
  });
  const changed = vi.fn();
  controller.subscribe(changed);
  done.resolve();
  await importing;
  expect(controller.getSnapshot().import.stage).toBe("done");
  expect(changed).toHaveBeenCalled();
});
it.each([
  "cancel",
  "dispose",
])("only explicit %s aborts an import, keeping partial records resumable", async (action) => {
  const { controller, repo } = setup();
  await controller.open();
  let active!: AbortSignal;
  const done = deferred<void>();
  vi.mocked(repo.importTimeline).mockImplementationOnce(async (_input, _progress, signal) => {
    active = signal!;
    await done.promise;
    active.throwIfAborted();
  });
  const importing = controller.importTimeline(sampleWeek());
  await Promise.resolve();
  if (action === "cancel") controller.cancelImport();
  else controller.dispose();
  expect(active.aborted).toBe(true);
  done.resolve();
  await expect(importing).rejects.toMatchObject({ name: "AbortError" });
  if (action === "cancel")
    expect(controller.getSnapshot().import.error).toContain("already saved are kept");
});
it("retains skipped-record counts from the repository", async () => {
  const { controller, repo } = setup();
  repo.load.mockResolvedValueOnce({ ...initial(), skipped: 3 });
  await controller.open();
  expect(controller.getSnapshot().snapshot.skipped).toBe(3);
});
