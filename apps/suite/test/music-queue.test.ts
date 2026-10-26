// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { MusicQueueError } from "../src/apps/music/lib/queue/errors";
import type { PlayQueue, QueueAction } from "../src/apps/music/lib/queue/queue";
import { createPlayQueue, reducePlayQueue } from "../src/apps/music/lib/queue/queue";

const tracks = ["a", "b", "c", "d", "e"].map((id) => ({
  id,
  url: `https://example.org/${id}.mp3`,
}));
const ids = (queue: PlayQueue) => queue.entries.map((entry) => entry.id);
const initial = () => createPlayQueue(tracks);
const dispatch = (state: PlayQueue, action: unknown) =>
  reducePlayQueue(state, action as QueueAction);
function fails(run: () => unknown, code: string) {
  expect(run).toThrow(MusicQueueError);
  expect(run).toThrow(expect.objectContaining({ code }));
}

describe("play queue edits", () => {
  it("copies arrays, preserves payloads, and supports empty queues and repeated tracks", () => {
    const queue = initial();
    expect(queue.entries).not.toBe(tracks);
    expect(queue.entries[0]).toBe(tracks[0]);
    expect(queue.currentId).toBe("a");
    expect(createPlayQueue([]).currentId).toBeNull();
    expect(
      createPlayQueue([
        { id: "1", trackId: "same" },
        { id: "2", trackId: "same" },
      ]).entries,
    ).toHaveLength(2);
  });
  it("inserts play-next blocks in order and appends without changing current", () => {
    const queue = Object.freeze({ ...initial(), entries: Object.freeze([...tracks]) });
    const extra = [{ id: "x" }, { id: "y" }];
    expect(ids(reducePlayQueue(queue, { type: "play-next", entries: extra }))).toEqual([
      "a",
      "x",
      "y",
      "b",
      "c",
      "d",
      "e",
    ]);
    const result = reducePlayQueue(queue, { type: "add-to-end", entries: extra });
    expect(ids(result)).toEqual(["a", "b", "c", "d", "e", "x", "y"]);
    expect(result.currentId).toBe("a");
    expect(ids(queue)).toEqual(["a", "b", "c", "d", "e"]);
    for (const type of ["play-next", "add-to-end"] as const) {
      const empty = reducePlayQueue(createPlayQueue([]), { type, entries: extra });
      expect(ids(empty)).toEqual(["x", "y"]);
      expect(empty.currentId).toBeNull();
      expect(reducePlayQueue(queue, { type, entries: [] })).toEqual(queue);
    }
  });
  it("removes before/after current and chooses successor, predecessor, or nothing", () => {
    const queue = { ...initial(), currentId: "c" };
    expect(reducePlayQueue(queue, { type: "remove", id: "a" }).currentId).toBe("c");
    expect(reducePlayQueue(queue, { type: "remove", id: "e" }).currentId).toBe("c");
    expect(reducePlayQueue(queue, { type: "remove", id: "c" }).currentId).toBe("d");
    expect(
      reducePlayQueue({ ...queue, currentId: "e" }, { type: "remove", id: "e" }).currentId,
    ).toBe("d");
    expect(
      reducePlayQueue(createPlayQueue([{ id: "a" }]), { type: "remove", id: "a" }).currentId,
    ).toBeNull();
  });
  it("moves in either direction using final indexes and retains current identity", () => {
    const queue = initial();
    const moved = reducePlayQueue(queue, { type: "move", id: "a", toIndex: 4 });
    expect(ids(moved)).toEqual(["b", "c", "d", "e", "a"]);
    expect(moved.currentId).toBe("a");
    expect(ids(reducePlayQueue(moved, { type: "move", id: "a", toIndex: 0 }))).toEqual(ids(queue));
    expect(reducePlayQueue(queue, { type: "move", id: "c", toIndex: 2 })).toEqual(queue);
  });
});

describe("navigation and repeat", () => {
  it("skips forward and stops at the end, then can start again", () => {
    let queue: PlayQueue = initial();
    for (const id of ["b", "c", "d", "e", null, "a"]) {
      queue = reducePlayQueue(queue, { type: "skip" });
      expect(queue.currentId).toBe(id);
    }
    expect(
      reducePlayQueue({ ...initial(), currentId: "e" }, { type: "ended" }).currentId,
    ).toBeNull();
    expect(
      reducePlayQueue({ ...initial(), currentId: null }, { type: "ended" }).currentId,
    ).toBeNull();
  });
  it("wraps repeat-all in both directions, with singleton and empty queues", () => {
    const queue = reducePlayQueue(initial(), { type: "repeat", mode: "all" });
    expect(reducePlayQueue({ ...queue, currentId: "e" }, { type: "skip" }).currentId).toBe("a");
    expect(reducePlayQueue({ ...queue, currentId: "e" }, { type: "ended" }).currentId).toBe("a");
    expect(reducePlayQueue(queue, { type: "previous", elapsedSeconds: 0 }).currentId).toBe("e");
    const singleton = { ...createPlayQueue([{ id: "a" }]), repeat: "all" as const };
    expect(reducePlayQueue(singleton, { type: "skip" }).currentId).toBe("a");
    for (const repeat of ["off", "all", "one"] as const) {
      const empty = { ...createPlayQueue([]), repeat };
      expect(reducePlayQueue(empty, { type: "skip" }).currentId).toBeNull();
      expect(reducePlayQueue(empty, { type: "ended" }).currentId).toBeNull();
      expect(reducePlayQueue(empty, { type: "previous", elapsedSeconds: 0 }).currentId).toBeNull();
    }
  });
  it("uses repeat-one only on natural completion", () => {
    const queue = reducePlayQueue(
      { ...initial(), currentId: "c" },
      { type: "repeat", mode: "one" },
    );
    expect(reducePlayQueue(queue, { type: "ended" }).currentId).toBe("c");
    expect(reducePlayQueue(queue, { type: "skip" }).currentId).toBe("d");
    expect(reducePlayQueue(queue, { type: "previous", elapsedSeconds: 1 }).currentId).toBe("b");
    expect(reducePlayQueue(queue, { type: "repeat", mode: "off" }).repeat).toBe("off");
  });
  it("restarts at exactly three seconds, goes back below, and handles boundaries", () => {
    const queue = { ...initial(), currentId: "c" };
    for (const elapsedSeconds of [3, 3.001, 100]) {
      expect(reducePlayQueue(queue, { type: "previous", elapsedSeconds }).currentId).toBe("c");
    }
    for (const elapsedSeconds of [0, 2.999]) {
      expect(reducePlayQueue(queue, { type: "previous", elapsedSeconds }).currentId).toBe("b");
    }
    expect(reducePlayQueue(initial(), { type: "previous", elapsedSeconds: 0 }).currentId).toBe("a");
    expect(
      reducePlayQueue({ ...queue, currentId: null }, { type: "previous", elapsedSeconds: 5 })
        .currentId,
    ).toBe("e");
  });
});

describe("seeded Fisher-Yates shuffle", () => {
  const shuffle = (queue: PlayQueue, seed = 42) =>
    reducePlayQueue(queue, { type: "shuffle", enabled: true, seed });
  const restore = (queue: PlayQueue) =>
    reducePlayQueue(queue, { type: "shuffle", enabled: false, seed: 0 });
  it("has a fixed known permutation, pins current at any index and restores order after navigation", () => {
    const queue = { ...initial(), currentId: "c" };
    const shuffled = shuffle(queue);
    expect(ids(shuffled)).toEqual(["d", "e", "c", "a", "b"]);
    expect(shuffle(queue)).toEqual(shuffled);
    expect(shuffle(queue, 0)).not.toEqual(shuffled);
    expect(shuffle(queue, 0xffffffff).unshuffledOrder).toEqual(ids(queue));
    expect(shuffle(shuffled, 123)).toEqual(shuffled);
    expect(restore(queue)).toEqual(queue);
    const navigated = reducePlayQueue(shuffled, { type: "skip" });
    const restored = restore(navigated);
    expect(ids(restored)).toEqual(ids(queue));
    expect(restored.currentId).toBe(navigated.currentId);
    for (const currentId of ["a", "e", null]) {
      const input = { ...queue, currentId };
      const result = shuffle(input);
      if (currentId !== null)
        expect(ids(result).indexOf(currentId)).toBe(ids(input).indexOf(currentId));
      expect([...ids(result)].sort()).toEqual(ids(queue));
      expect(restore(result)).toEqual(input);
    }
    for (const input of [createPlayQueue([]), createPlayQueue([{ id: "a" }])]) {
      expect(restore(shuffle(input))).toEqual(input);
    }
  });
  it("maintains the saved order through additions and removals; moves are temporary", () => {
    let queue = shuffle({ ...initial(), currentId: "c" });
    queue = reducePlayQueue(queue, { type: "play-next", entries: [{ id: "x" }, { id: "y" }] });
    expect(ids(queue).slice(2, 5)).toEqual(["c", "x", "y"]);
    queue = reducePlayQueue(queue, { type: "add-to-end", entries: [{ id: "z" }] });
    queue = reducePlayQueue(queue, { type: "remove", id: "b" });
    queue = reducePlayQueue(queue, { type: "move", id: "a", toIndex: 0 });
    expect(ids(restore(queue))).toEqual(["a", "c", "x", "y", "d", "e", "z"]);
    const stopped = shuffle({ ...initial(), currentId: null });
    expect(
      ids(restore(reducePlayQueue(stopped, { type: "play-next", entries: [{ id: "x" }] })))[0],
    ).toBe("x");
  });
});

describe("typed input rejection", () => {
  it("rejects malformed entries and states without echoing data", () => {
    for (const entries of [
      null,
      {},
      [null],
      [{}],
      [{ id: 1 }],
      [{ id: " " }],
      [{ id: "a" }, { id: "a" }],
    ]) {
      fails(() => createPlayQueue(entries as never), "invalid-entry");
    }
    for (const state of [
      null,
      "bad",
      { ...initial(), repeat: "bad" },
      { ...initial(), currentId: "missing" },
      { ...initial(), unshuffledOrder: {} },
      { ...initial(), unshuffledOrder: [] },
      { ...initial(), unshuffledOrder: ["a", "a", "b", "c", "d"] },
      { ...initial(), unshuffledOrder: ["a", "b", "c", "d", "unknown"] },
    ]) {
      fails(() => dispatch(state as PlayQueue, { type: "skip" }), "invalid-queue");
    }
    expect(new MusicQueueError("invalid-url").message).toBe("Music queue: invalid-url");
  });
  it("rejects unknown actions, missing IDs, invalid indexes, repeats, time, seeds and duplicates", () => {
    const actions = [
      null,
      "skip",
      {},
      { type: "unknown" },
      { type: "remove", id: "missing" },
      { type: "move", id: "missing", toIndex: 0 },
      ...[-1, 5, 0.5, NaN].map((toIndex) => ({ type: "move", id: "a", toIndex })),
      { type: "repeat", mode: "bad" },
      ...[-1, Infinity, NaN, "3"].map((elapsedSeconds) => ({ type: "previous", elapsedSeconds })),
      ...[-1, 0x100000000, 0.5, NaN, "42"].map((seed) => ({
        type: "shuffle",
        enabled: true,
        seed,
      })),
      { type: "shuffle", enabled: "yes", seed: 1 },
    ];
    for (const action of actions) fails(() => dispatch(initial(), action), "invalid-action");
    for (const type of ["play-next", "add-to-end"]) {
      fails(() => dispatch(initial(), { type, entries: [{ id: "a" }] }), "invalid-entry");
    }
  });
});
