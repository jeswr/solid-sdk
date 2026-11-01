// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  uploadQueueReducer as reduce,
  type UploadAction,
  type UploadItem,
  type UploadStatus,
  uploadSummary,
} from "../src/uploads/queue.js";

const file = { id: "a", name: "notes.txt", total: 100 };
const initial = () => reduce([], { type: "enqueue", files: [file] });
const uploading = () => reduce(initial(), { type: "start", id: "a" });
describe("upload queue transitions", () => {
  it("enqueues valid unique IDs and preserves display names", () => {
    expect(
      reduce(initial(), {
        type: "enqueue",
        files: [
          file,
          { ...file, id: "zero", total: 0 },
          { ...file, id: "bad", total: -1 },
          { ...file, id: "nan", total: Number.NaN },
          { ...file, id: "inf", total: Infinity },
        ],
      }),
    ).toEqual([
      { ...file, sent: 0, status: "queued", attempt: 0 },
      { ...file, id: "zero", total: 0, sent: 0, status: "queued", attempt: 0 },
    ]);
  });
  it("allows only three concurrent uploads, freeing a slot on pause/cancel/failure/completion", () => {
    for (const action of [
      { type: "pause" },
      { type: "cancel" },
      { type: "fail", attempt: 1, error: "quota" },
      { type: "complete", attempt: 1 },
    ] as const) {
      let items = reduce([], {
        type: "enqueue",
        files: ["a", "b", "c", "d"].map((id) => ({ ...file, id })),
      });
      for (const id of ["a", "b", "c", "d"]) items = reduce(items, { type: "start", id });
      expect(items.map((item) => item.status)).toEqual([
        "uploading",
        "uploading",
        "uploading",
        "queued",
      ]);
      items = reduce(items, { ...action, id: "a" });
      expect(reduce(items, { type: "start", id: "d" })[3]?.status).toBe("uploading");
    }
  });
  it("clamps monotonic progress, ignoring non-finite, unknown and stale updates", () => {
    let items = uploading();
    for (const sent of [50, 20, -1, NaN, Infinity])
      items = reduce(items, { type: "progress", id: "a", attempt: 1, sent });
    expect(items[0]?.sent).toBe(50);
    expect(reduce(items, { type: "progress", id: "a", attempt: 1, sent: 1000 })[0]?.sent).toBe(100);
    expect(reduce(items, { type: "progress", id: "a", attempt: 0, sent: 90 })).toEqual(items);
    expect(reduce(items, { type: "cancel", id: "missing" })).toEqual(items);
  });
  it("pauses, resumes and rejects callbacks from a previous attempt", () => {
    let items = reduce(uploading(), { type: "pause", id: "a" });
    expect(items[0]?.status).toBe("paused");
    expect(reduce(items, { type: "complete", id: "a", attempt: 1 })).toEqual(items);
    items = reduce(reduce(items, { type: "resume", id: "a" }), { type: "start", id: "a" });
    expect(items[0]?.attempt).toBe(2);
    expect(reduce(items, { type: "fail", id: "a", attempt: 1, error: "unknown" })).toEqual(items);
    expect(reduce(items, { type: "complete", id: "a", attempt: 1 })).toEqual(items);
    expect(reduce(items, { type: "complete", id: "a", attempt: 2 })[0]).toMatchObject({
      status: "done",
      sent: 100,
    });
  });
  it("retries failures without retaining error or previous bytes", () => {
    let items = reduce(uploading(), { type: "progress", id: "a", attempt: 1, sent: 60 });
    items = reduce(items, { type: "fail", id: "a", attempt: 1, error: "quota" });
    expect(items[0]).toMatchObject({ status: "failed", error: "quota", sent: 60 });
    items = reduce(items, { type: "retry", id: "a" });
    expect(items[0]).toEqual({ ...file, status: "queued", attempt: 1, sent: 0 });
  });
  it("waits for connection and can be resumed or paused", () => {
    const waiting = reduce(uploading(), { type: "wait", id: "a" });
    expect(waiting[0]?.status).toBe("waiting");
    expect(reduce(waiting, { type: "resume", id: "a" })[0]?.status).toBe("queued");
    expect(reduce(waiting, { type: "pause", id: "a" })[0]?.status).toBe("paused");
  });
  const statuses: UploadStatus[] = [
    "queued",
    "uploading",
    "paused",
    "waiting",
    "done",
    "failed",
    "skipped",
  ];
  const transitions = {
    start: { queued: "uploading" },
    pause: { queued: "paused", uploading: "paused", waiting: "paused" },
    resume: { paused: "queued", waiting: "queued" },
    cancel: {
      queued: "skipped",
      uploading: "skipped",
      paused: "skipped",
      waiting: "skipped",
      failed: "skipped",
    },
    retry: { failed: "queued" },
    wait: { queued: "waiting", uploading: "waiting" },
    progress: {},
    complete: { uploading: "done" },
    fail: { uploading: "failed" },
  };
  for (const status of statuses)
    for (const [type, allowed] of Object.entries(transitions)) {
      it(`${status} + ${type} follows the transition table`, () => {
        const item: UploadItem = { ...file, status, sent: 0, attempt: 1 };
        const action = { type, id: "a", sent: 10, attempt: 1, error: "unknown" } as UploadAction;
        expect(reduce([item], action)[0]?.status).toBe(
          (allowed as Record<string, UploadStatus>)[status] ?? status,
        );
      });
    }
  it("announces every status without announcing each progress tick", () => {
    const items = statuses.map((status, index) => ({
      ...file,
      id: String(index),
      status,
      sent: 0,
      attempt: 0,
    }));
    expect(uploadSummary(items)).toBe(
      "7 files · 1 uploaded · 1 uploading · 1 queued · 1 paused · 1 waiting · 1 failed · 1 cancelled",
    );
    expect(uploadSummary([])).toContain("0 files");
  });
});
