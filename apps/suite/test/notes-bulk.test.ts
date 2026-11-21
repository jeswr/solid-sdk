// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import {
  applyNotesBulk,
  bulkActionLabels,
  bulkFailureMessage,
  bulkNeedsConnection,
  type NotesBulkAction,
  type NotesBulkPaths,
  notesBulkActions,
} from "../src/apps/notes/lib/bulk";
import type { StoredNote } from "../src/apps/notes/lib/model/store";

const note = (rest: Partial<StoredNote> = {}): StoredNote => ({
  url: "https://pod.example/notes/one.ttl",
  title: "One",
  body: "",
  labels: ["Keep", "Work"],
  format: "text/html",
  location: "active",
  revisions: [],
  etag: '"v1"',
  ...rest,
});
const paths = (): NotesBulkPaths => ({
  move: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
  deleteForever: vi.fn(async () => {}),
  pin: vi.fn(),
  colour: vi.fn(),
  prefs: { pinned: [], colours: {}, view: "grid" },
});

it("offers only actions valid for the selected folders and permission hints", () => {
  expect(notesBulkActions([])).toEqual([]);
  expect(notesBulkActions([note({ readOnly: true })])).toEqual([]);
  expect(
    notesBulkActions([note({ etag: null, url: "https://pod.example/notes/pending-one.ttl" })]),
  ).toEqual([]);
  expect(notesBulkActions([note({ etag: null })])).toContain("archive");
  expect(notesBulkActions([note({ location: "trashed" })])).toEqual(["restore", "deleteForever"]);
  expect(notesBulkActions([note(), note({ location: "trashed" })])).toEqual([]);
  expect(notesBulkActions([note()])).toEqual([
    "archive",
    "trash",
    "colour",
    "addLabel",
    "removeLabel",
    "pin",
    "unpin",
  ]);
  expect(notesBulkActions([note({ location: "archived" })])).toEqual([
    "unarchive",
    "trash",
    "colour",
    "addLabel",
    "removeLabel",
  ]);
  expect(notesBulkActions([note(), note({ location: "archived" })])).toEqual([
    "archive",
    "unarchive",
    "trash",
    "colour",
    "addLabel",
    "removeLabel",
  ]);
});

it("keeps successful writes and retries only failed notes with their current ETag", async () => {
  const first = note();
  const second = note({ url: "https://pod.example/notes/two.ttl" });
  const api = paths();
  const conflict = new Error("412");
  api.move = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(conflict)
    .mockResolvedValueOnce({});
  const result = await applyNotesBulk([first, second], { type: "archive" }, api);
  expect(result).toEqual({ succeeded: [first], failed: [{ note: second, error: conflict }] });
  expect(bulkFailureMessage(1, 2, { type: "archive" })).toBe("1 of 2 notes couldn't be archived");
  const fresh = { ...second, etag: '"v2"' };
  expect(await applyNotesBulk([fresh], { type: "archive" }, api)).toEqual({
    succeeded: [fresh],
    failed: [],
  });
  expect(api.move).toHaveBeenNthCalledWith(3, fresh, "archive");
});

it.each([
  "archive",
  "unarchive",
  "trash",
  "restore",
] as const)("delegates %s to the single-note move path", async (type) => {
  const saved = note({
    location: type === "restore" ? "trashed" : type === "unarchive" ? "archived" : "active",
  });
  const api = paths();
  expect((await applyNotesBulk([saved], { type }, api)).failed).toEqual([]);
  expect(api.move).toHaveBeenCalledExactlyOnceWith(saved, type);
});

it("counts already archived or active destinations as successful without moving again", async () => {
  const api = paths();
  for (const [location, type] of [
    ["archived", "archive"],
    ["active", "unarchive"],
  ] as const) {
    const saved = note({ location });
    expect(await applyNotesBulk([saved], { type }, api)).toEqual({
      succeeded: [saved],
      failed: [],
    });
  }
  expect(api.move).not.toHaveBeenCalled();
});

it("rejects invalid transitions, read-only notes and pending captures per note", async () => {
  const api = paths();
  const notes = [
    note({ location: "trashed" }),
    note({ readOnly: true, location: "archived" }),
    note({ etag: null, url: "https://pod.example/notes/pending-x.ttl" }),
  ];
  const result = await applyNotesBulk(notes, { type: "archive" }, api);
  expect(result.succeeded).toEqual([]);
  expect(result.failed.map(({ note }) => note)).toEqual(notes);
  expect(api.move).not.toHaveBeenCalled();
});

it("adds and removes a label without replacing unrelated labels", async () => {
  const api = paths();
  const saved = note();
  await applyNotesBulk([saved], { type: "addLabel", label: "Home" }, api);
  expect(api.save).toHaveBeenLastCalledWith(saved, { labels: ["Keep", "Work", "Home"] });
  await applyNotesBulk([saved], { type: "addLabel", label: "Work" }, api);
  expect(api.save).toHaveBeenLastCalledWith(saved, { labels: ["Keep", "Work"] });
  await applyNotesBulk([saved], { type: "removeLabel", label: "Work" }, api);
  expect(api.save).toHaveBeenLastCalledWith(saved, { labels: ["Keep"] });
});

it("delegates permanent deletion, colour and idempotent pin/unpin through existing paths", async () => {
  const api = paths();
  const saved = note();
  await applyNotesBulk([saved], { type: "colour", value: "yellow" }, api);
  expect(api.colour).toHaveBeenCalledExactlyOnceWith(saved.url, "yellow");
  const trash = note({ location: "trashed" });
  await applyNotesBulk([trash], { type: "deleteForever" }, api);
  expect(api.deleteForever).toHaveBeenCalledExactlyOnceWith(trash);
  await applyNotesBulk([saved], { type: "unpin" }, api);
  expect(api.pin).not.toHaveBeenCalled();
  await applyNotesBulk([saved], { type: "pin" }, api);
  expect(api.pin).toHaveBeenCalledTimes(1);
  api.prefs.pinned = [saved.url];
  await applyNotesBulk([saved], { type: "pin" }, api);
  expect(api.pin).toHaveBeenCalledTimes(1);
  await applyNotesBulk([saved], { type: "unpin" }, api);
  expect(api.pin).toHaveBeenCalledTimes(2);
});

it("requires a connection only for pod writes and describes every action's failures", () => {
  for (const type of Object.keys(bulkActionLabels) as NotesBulkAction["type"][]) {
    expect(bulkNeedsConnection(type)).toBe(!["pin", "unpin", "colour"].includes(type));
    expect(bulkFailureMessage(2, 5, { type } as NotesBulkAction)).toMatch(
      /^2 of 5 notes couldn't be /,
    );
  }
});
