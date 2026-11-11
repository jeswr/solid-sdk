// AUTHORED-BY Codex (GPT-6.1 Sol)

import { EVENT_STATUS, type Invitation } from "@jeswr/solid-events";
import { expect, it, vi } from "vitest";
import { EventsController } from "../../src/apps/events/state/controller";

const event: Invitation = {
  url: "https://host.example/events/e/index.ttl",
  etag: '"one"',
  name: "Supper",
  startDate: new Date("2027-02-01T18:00:00Z"),
  organizer: "https://host.example/me",
  eventStatus: EVENT_STATUS.scheduled,
  visibility: "link",
  guestListVisible: false,
  publication: "published",
  created: new Date(),
  modified: new Date(),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const repository = {
    base: "https://host.example/events/",
    list: vi.fn().mockResolvedValue([event]),
    create: vi.fn().mockResolvedValue(event),
    update: vi.fn().mockResolvedValue(event),
    invitees: vi.fn(),
    notify: vi.fn(),
  };
  const failure = vi.fn();
  return { repository, failure, controller: new EventsController(repository, failure) };
}
it("loads and notifies subscribers; preserves known invitations on refresh failure", async () => {
  const { repository, controller } = fixture();
  const listener = vi.fn();
  const unsubscribe = controller.subscribe(listener);
  expect(controller.snapshot()).toMatchObject({ loading: true, events: [] });
  await controller.refresh();
  expect(controller.snapshot()).toMatchObject({ loading: false, error: false, events: [event] });
  repository.list.mockRejectedValueOnce(new Error("offline"));
  await controller.refresh();
  expect(controller.snapshot()).toMatchObject({ error: true, events: [event] });
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  await controller.refresh();
  expect(listener).toHaveBeenCalledTimes(2);
});
it("paints a new invitation before the pod returns and uses its stable URL", async () => {
  const { repository, controller } = fixture();
  repository.list.mockResolvedValue([]);
  await controller.refresh();
  const pending = deferred<Invitation>();
  repository.create.mockReturnValue(pending.promise);
  const url = controller.save(event);
  expect(controller.snapshot()).toMatchObject({ saving: 1, events: [{ name: event.name, url }] });
  const saved = { ...event, url, etag: '"saved"' };
  repository.list.mockResolvedValue([saved]);
  pending.resolve(saved);
  await controller.settled();
  await vi.waitFor(() =>
    expect(controller.snapshot()).toMatchObject({ saving: 0, events: [saved] }),
  );
});
it("a failed earlier edit never erases a newer queued edit", async () => {
  const { repository, controller, failure } = fixture();
  await controller.refresh();
  const first = deferred<Invitation>();
  const second = deferred<Invitation>();
  repository.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  controller.save({ ...event, name: "First" }, [], event);
  await Promise.resolve();
  controller.save({ ...event, name: "Second" }, [], event);
  first.reject(new Error("failure"));
  await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
  expect(controller.snapshot().events[0]?.name).toBe("Second");
  const final = { ...event, name: "Second", etag: '"two"' };
  repository.list.mockResolvedValue([final]);
  second.resolve(final);
  await controller.settled();
  expect(controller.snapshot()).toMatchObject({ saving: 0, events: [final] });
});
it("serialises edits using the confirmed version and ignores stale refreshes", async () => {
  const { repository, controller } = fixture();
  await controller.refresh();
  const oldRead = deferred<Invitation[]>();
  repository.list.mockReturnValueOnce(oldRead.promise);
  const reading = controller.refresh();
  const updated = { ...event, name: "New", etag: '"two"' };
  repository.update
    .mockResolvedValueOnce(updated)
    .mockResolvedValueOnce({ ...updated, name: "Newest" });
  controller.save(updated, [], event);
  controller.save({ ...updated, name: "Newest" }, [], event);
  repository.list.mockResolvedValue([{ ...updated, name: "Newest" }]);
  oldRead.resolve([event]);
  await reading;
  await controller.settled();
  expect(repository.update.mock.calls[1]?.[0].etag).toBe('"two"');
  expect(controller.snapshot().events[0]?.name).toBe("Newest");
});
it("fences disposed account reads while completing queued writes", async () => {
  const { repository, controller, failure } = fixture();
  const loading = deferred<Invitation[]>();
  repository.list.mockReturnValue(loading.promise);
  const pending = controller.refresh();
  const listener = vi.fn();
  controller.subscribe(listener);
  controller.save(event);
  controller.dispose();
  loading.resolve([event]);
  await pending;
  await controller.settled();
  expect(repository.create).toHaveBeenCalledOnce();
  expect(failure).not.toHaveBeenCalled();
  expect(listener).toHaveBeenCalledTimes(1);
  controller.activate();
  repository.list.mockResolvedValue([event]);
  await controller.refresh();
  expect(controller.snapshot().events).toEqual([event]);
});

it("can update a supplied invitation before the initial list has returned", async () => {
  const { repository, controller } = fixture();
  controller.save({ ...event, name: "Revised" }, [], event);
  await controller.settled();
  expect(repository.update).toHaveBeenCalledWith(
    event,
    expect.objectContaining({ name: "Revised" }),
  );
});
it.each([
  "resolve",
  "reject",
] as const)("ignores an in-flight write that %ss after disposal", async (outcome) => {
  const { repository, controller, failure } = fixture();
  const pending = deferred<Invitation>();
  repository.create.mockReturnValue(pending.promise);
  controller.save(event);
  await vi.waitFor(() => expect(repository.create).toHaveBeenCalledOnce());
  controller.dispose();
  if (outcome === "resolve") pending.resolve(event);
  else pending.reject(new Error("offline"));
  await controller.settled();
  expect(failure).toHaveBeenCalledTimes(outcome === "reject" ? 1 : 0);
  expect(repository.list).not.toHaveBeenCalled();
});
it("ignores stale or disposed read errors while completing saves after disposal", async () => {
  const { repository, controller } = fixture();
  const old = deferred<Invitation[]>();
  repository.list.mockReturnValueOnce(old.promise);
  const first = controller.refresh();
  await controller.refresh();
  old.reject(new Error("old failure"));
  await first;
  expect(controller.snapshot().error).toBe(false);
  const disposed = deferred<Invitation[]>();
  repository.list.mockReturnValueOnce(disposed.promise);
  const second = controller.refresh();
  controller.dispose();
  disposed.reject(new Error("late failure"));
  await second;
  controller.save(event);
  await controller.settled();
  expect(repository.create).toHaveBeenCalledOnce();
});

it("finishes both queued saves after unmount, uses the confirmed ETag and reports late failures", async () => {
  const { repository, controller, failure } = fixture();
  await controller.refresh();
  const first = deferred<Invitation>();
  repository.update.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("offline"));
  controller.save({ ...event, name: "One" }, [], event);
  controller.save({ ...event, name: "Two" }, [], event);
  const listener = vi.fn();
  controller.subscribe(listener);
  controller.dispose();
  first.resolve({ ...event, name: "One", etag: '"two"' });
  await controller.settled();
  expect(repository.update).toHaveBeenCalledTimes(2);
  expect(repository.update.mock.calls[1]?.[0].etag).toBe('"two"');
  expect(failure).toHaveBeenCalledOnce();
  expect(listener).not.toHaveBeenCalled();
});
