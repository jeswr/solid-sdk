// AUTHORED-BY GPT-5.6 Codex
import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_SHARE_STAGING_LIMITS,
  type ShareStagingPlugin,
  shareFiles,
  stageFile,
} from "./index.js";

const id = "12345678-1234-1234-1234-123456789abc";
const uri = `file:///cache/share-out/${id}/file.txt`;
const blob = new Blob(["hello"], { type: "text/plain" });
const file = { blob, name: "file.txt" };
function plugin() {
  return {
    begin: vi.fn<ShareStagingPlugin["begin"]>().mockResolvedValue({ stagingId: id }),
    writeChunk: vi.fn<ShareStagingPlugin["writeChunk"]>().mockResolvedValue(),
    commit: vi.fn<ShareStagingPlugin["commit"]>().mockResolvedValue({ uri }),
    abort: vi.fn<ShareStagingPlugin["abort"]>().mockResolvedValue(),
  };
}

describe("stageFile", () => {
  test("sanitises names and sends bounded base64 chunks at contiguous byte offsets", async () => {
    const p = plugin();
    expect(await stageFile(blob, { name: "../file.txt" }, p, { chunkBytes: 2 })).toBe(uri);
    expect(p.begin).toHaveBeenCalledWith({ name: "_file.txt", mimeType: "text/plain", size: 5 });
    expect(p.writeChunk.mock.calls.map(([c]) => [c.offset, atob(c.data)])).toEqual([
      [0, "he"],
      [2, "ll"],
      [4, "o"],
    ]);
    expect(p.abort).not.toHaveBeenCalled();
  });

  test("never reads the entire Blob and defaults to 512 KiB slices", async () => {
    const bytes = new Uint8Array(512 * 1024 + 1).fill(255);
    const large = new Blob([bytes]);
    vi.spyOn(large, "arrayBuffer").mockRejectedValue(new Error("whole Blob read"));
    const p = plugin();
    await stageFile(large, file, p);
    expect(p.writeChunk.mock.calls.map(([c]) => atob(c.data).length)).toEqual([512 * 1024, 1]);
    expect(p.begin).toHaveBeenCalledWith({
      name: file.name,
      mimeType: "application/octet-stream",
      size: bytes.length,
    });
  });

  test("supports zero bytes and MIME overrides", async () => {
    const p = plugin();
    await stageFile(new Blob(), { name: "", mimeType: "IMAGE/PNG" }, p);
    expect(p.begin).toHaveBeenCalledWith({ name: "shared-file", mimeType: "image/png", size: 0 });
    expect(p.writeChunk).not.toHaveBeenCalled();
  });

  test.each([
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    512 * 1024 + 1,
  ])("rejects chunk limit %s", async (chunkBytes) => {
    await expect(stageFile(blob, file, plugin(), { chunkBytes })).rejects.toThrow("limits");
  });
  test.each([
    0,
    -1,
    0.5,
    Number.NaN,
    100 * 1024 * 1024 + 1,
  ])("rejects file limit %s", async (maxFileBytes) => {
    await expect(stageFile(blob, file, plugin(), { maxFileBytes })).rejects.toThrow("limits");
  });
  test.each([
    "bad",
    "text/plain; charset=utf8",
    "text/plain\n",
    "a".repeat(256),
    7,
  ])("rejects MIME %s", async (mimeType) => {
    await expect(
      stageFile(blob, { name: "f", mimeType: mimeType as string }, plugin()),
    ).rejects.toThrow("MIME");
  });
  test("rejects invalid Blobs and file sizes before begin", async () => {
    const p = plugin();
    for (const value of [
      { size: 1 },
      Object.defineProperty(new Blob(), "size", { value: -1 }),
      Object.defineProperty(new Blob(), "size", { value: 0.5 }),
      Object.defineProperty(new Blob(), "size", {
        value: DEFAULT_SHARE_STAGING_LIMITS.maxFileBytes + 1,
      }),
    ]) {
      await expect(stageFile(value as Blob, file, p)).rejects.toThrow("size limit");
    }
    await expect(stageFile(blob, file, p, { maxFileBytes: 4 })).rejects.toThrow("size limit");
    expect(p.begin).not.toHaveBeenCalled();
  });
  test.each([
    undefined,
    {},
    { stagingId: 1 },
    { stagingId: "../escape" },
    { stagingId: `${id}\n` },
    { stagingId: "0".repeat(36) },
  ])("rejects malformed begin %j", async (value) => {
    const p = plugin();
    p.begin.mockResolvedValue(value as { stagingId: string });
    await expect(stageFile(blob, file, p)).rejects.toThrow("staging id");
    expect(p.abort).not.toHaveBeenCalled();
  });
  test("propagates begin failures", async () => {
    const p = plugin();
    p.begin.mockRejectedValue(new Error("begin failed"));
    await expect(stageFile(blob, file, p)).rejects.toThrow("begin failed");
    expect(p.abort).not.toHaveBeenCalled();
  });
  test.each([
    "read",
    "write",
    "commit",
    "size",
  ])("aborts on %s failure and preserves the error even if abort fails", async (failure) => {
    const p = plugin();
    const input = new Blob(["hello"]);
    if (failure === "read")
      vi.spyOn(input, "slice").mockImplementation(() => {
        throw new Error("read failed");
      });
    if (failure === "size") vi.spyOn(input, "slice").mockReturnValue(new Blob());
    if (failure === "write") p.writeChunk.mockRejectedValue(new Error("write failed"));
    if (failure === "commit") p.commit.mockRejectedValue(new Error("commit failed"));
    p.abort.mockRejectedValue(new Error("abort failed"));
    await expect(stageFile(input, file, p)).rejects.toThrow(
      failure === "size" ? "size changed" : `${failure} failed`,
    );
    expect(p.abort).toHaveBeenCalledExactlyOnceWith({ stagingId: id });
  });
  test.each([
    undefined,
    {},
    { uri: 7 },
    ...[
      "content://files/a",
      "file://host/a",
      "file:///a",
      `file:///share-out/${id}/`,
      `${uri}?x=1`,
      `${uri}#x`,
      `${uri}%00`,
      `file:///share-out/${id}/%2Ebad`,
      `file:///share-out/${id}/%2Fbad`,
      `file:///share-out/${id}/%`,
      `file:///share-out/${id}/back%5Cslash`,
      `file:///share-out/${id}/%20bad`,
    ].map((uri) => ({ uri })),
  ])("aborts on malformed commit %j", async (value) => {
    const p = plugin();
    p.commit.mockResolvedValue(value as { uri: string });
    await expect(stageFile(blob, file, p)).rejects.toThrow();
    expect(p.abort).toHaveBeenCalledWith({ stagingId: id });
  });
  test("accepts an escaped Unicode filename", async () => {
    const p = plugin();
    p.commit.mockResolvedValue({ uri: `file:///tmp/share-out/${id}/caf%C3%A9.txt` });
    expect(await stageFile(blob, file, p)).toContain("caf%C3%A9");
  });
});

describe("shareFiles", () => {
  function targets() {
    return {
      staging: plugin(),
      native: {
        canShare: vi.fn().mockResolvedValue({ value: true }),
        share: vi.fn().mockResolvedValue({ activityType: "mail" }),
      },
    };
  }
  test("stages files then calls the existing share seam", async () => {
    const t = targets();
    expect(await shareFiles([file, file], { title: "From my pod" }, t)).toEqual({
      completed: true,
      activityType: "mail",
    });
    expect(t.native.share).toHaveBeenCalledWith({ title: "From my pod", files: [uri, uri] });
    expect(t.staging.abort).not.toHaveBeenCalled();
  });
  test("pins the files already staged for the same share", async () => {
    const t = targets();
    const ids = ["1", "2", "3"].map((n) => `${n.repeat(8)}-1234-1234-1234-123456789abc`);
    const uriFor = (stagingId: string) => `file:///cache/share-out/${stagingId}/file.txt`;
    for (const stagingId of ids) t.staging.begin.mockResolvedValueOnce({ stagingId });
    t.staging.commit.mockImplementation(async ({ stagingId }) => ({ uri: uriFor(stagingId) }));
    await shareFiles([file, file, file], {}, t);
    expect(t.staging.begin.mock.calls.map(([options]) => options.keep)).toEqual([
      undefined,
      [ids[0]],
      [ids[0], ids[1]],
    ]);
    expect(t.native.share).toHaveBeenCalledWith({ files: ids.map(uriFor) });
  });
  test("retains files after the sheet is dismissed", async () => {
    const t = targets();
    t.native.share.mockRejectedValue(new Error("Share canceled"));
    expect(await shareFiles([file], {}, t)).toEqual({ completed: false });
    expect(t.staging.abort).not.toHaveBeenCalled();
  });
  test.each([null, [], Array(21).fill(file)])("rejects invalid file collections", async (files) => {
    const t = targets();
    await expect(shareFiles(files as (typeof file)[], {}, t)).rejects.toThrow("1 and 20");
    expect(t.staging.begin).not.toHaveBeenCalled();
  });
  test("preflights total bytes so staging cannot evict an earlier file in this share", async () => {
    const large = Object.defineProperty(new Blob(), "size", { value: 60 * 1024 * 1024 });
    const t = targets();
    await expect(
      shareFiles(
        [
          { ...file, blob: large },
          { ...file, blob: large },
        ],
        {},
        t,
      ),
    ).rejects.toThrow("cache size");
    expect(t.staging.begin).not.toHaveBeenCalled();
  });
  test("a staging failure never opens the sheet", async () => {
    const t = targets();
    t.staging.writeChunk.mockRejectedValue(new Error("disk full"));
    await expect(shareFiles([file], {}, t)).rejects.toThrow("disk full");
    expect(t.native.share).not.toHaveBeenCalled();
  });
});
