// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test, vi } from "vitest";
import { InvalidShareError } from "./errors.js";
import {
  createShareInbox,
  DEFAULT_SHARE_LIMITS,
  type ShareBatch,
  type ShareIntakePlugin,
  sanitiseFileName,
  validateShareBatch,
} from "./share-intake.js";

const batch = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "b-1",
  receivedAt: "2026-10-26T19:00:00Z",
  items,
  ...extra,
});
const file = (extra: Record<string, unknown> = {}) => ({
  kind: "file",
  name: "photo.jpg",
  mimeType: "image/jpeg",
  size: 3,
  ...extra,
});

describe("sanitiseFileName", () => {
  test.each([
    ["photo.jpg", "photo.jpg"],
    ["../../etc/passwd", "_.._etc_passwd"],
    ["a\\b/c", "a_b_c"],
    ["\u0000evil\u001f.txt", "_evil_.txt"],
    ["  .hidden ", "hidden"],
    ["", "shared-file"],
    [42, "shared-file"],
    ["...", "shared-file"],
  ])("%j → %j", (raw, expected) => {
    expect(sanitiseFileName(raw)).toBe(expected);
  });

  test("caps the length at 255 characters", () => {
    expect(sanitiseFileName("x".repeat(300))).toHaveLength(255);
  });
});

describe("validateShareBatch", () => {
  test("normalises a mixed batch", () => {
    expect(
      validateShareBatch(
        batch([
          file({ name: "../a.JPG", mimeType: "IMAGE/JPEG" }),
          file({ mimeType: "not a type" }),
          file({ mimeType: undefined }),
          { kind: "url", url: "https://example.org/x?y", title: "T".repeat(2000) },
          { kind: "url", url: "http://example.org" },
          { kind: "text", text: "hello" },
        ]),
      ),
    ).toEqual({
      id: "b-1",
      receivedAt: "2026-10-26T19:00:00.000Z",
      items: [
        { kind: "file", name: "_a.JPG", mimeType: "image/jpeg", size: 3 },
        { kind: "file", name: "photo.jpg", mimeType: "application/octet-stream", size: 3 },
        { kind: "file", name: "photo.jpg", mimeType: "application/octet-stream", size: 3 },
        { kind: "url", url: "https://example.org/x?y", title: "T".repeat(1000) },
        { kind: "url", url: "http://example.org/" },
        { kind: "text", text: "hello" },
      ],
    });
  });

  test.each([
    ["a non-object", "batch"],
    ["an array", []],
    ["null", null],
    ["a bad id", batch([file()], { id: "../x" })],
    ["a missing id", batch([file()], { id: undefined })],
    ["a bad date", batch([file()], { receivedAt: "yesterday" })],
    ["a missing date", batch([file()], { receivedAt: 5 })],
    ["no items", batch([])],
    ["items not an array", batch([], { items: "x" })],
    ["too many items", batch(Array.from({ length: 21 }, () => file()))],
    ["a non-object item", batch(["x"])],
    ["an unknown kind", batch([{ kind: "contact" }])],
    ["a negative size", batch([file({ size: -1 })])],
    ["a fractional size", batch([file({ size: 1.5 })])],
    ["a string size", batch([file({ size: "3" })])],
    ["an oversized file", batch([file({ size: DEFAULT_SHARE_LIMITS.maxFileBytes + 1 })])],
    ["a url without url", batch([{ kind: "url" }])],
    ["a malformed url", batch([{ kind: "url", url: "not a url" }])],
    ["a javascript url", batch([{ kind: "url", url: "javascript:alert(1)" }])],
    ["a file url", batch([{ kind: "url", url: "file:///etc/passwd" }])],
    ["a url with credentials", batch([{ kind: "url", url: "https://a:b@example.org" }])],
    ["text without text", batch([{ kind: "text" }])],
    ["text too long", batch([{ kind: "text", text: "x".repeat(100_001) }])],
  ])("rejects %s", (_, raw) => {
    expect(() => validateShareBatch(raw)).toThrow(InvalidShareError);
  });

  test("bounds the total bytes of a batch", () => {
    const big = file({ size: DEFAULT_SHARE_LIMITS.maxFileBytes });
    expect(() => validateShareBatch(batch([big, big]))).not.toThrow();
    expect(() => validateShareBatch(batch([big, big, file({ size: 1 })]))).toThrow(
      "batch is too large",
    );
  });

  test("honours custom limits", () => {
    const limits = { ...DEFAULT_SHARE_LIMITS, maxItems: 1 };
    expect(() => validateShareBatch(batch([file(), file()]), limits)).toThrow(InvalidShareError);
  });
});

function fakePlugin(bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
  let listener: ((raw: unknown) => void) | undefined;
  const remove = vi.fn(async () => undefined);
  const plugin = {
    getPending: vi.fn(async (): Promise<{ batches: unknown[] }> => ({ batches: [] })),
    readChunk: vi.fn(async ({ offset, length }: { offset: number; length: number }) => {
      const slice = bytes.slice(offset, offset + length);
      return {
        data: btoa(String.fromCharCode(...slice)),
        eof: offset + slice.length >= bytes.length,
      };
    }),
    acknowledge: vi.fn(async () => undefined),
    addListener: vi.fn(async (_event: "shareReceived", fn: (raw: unknown) => void) => {
      listener = fn;
      return { remove };
    }),
  };
  return { plugin, emit: (raw: unknown) => listener?.(raw), remove };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createShareInbox", () => {
  test("returns valid pending batches and acknowledges invalid ones", async () => {
    const { plugin } = fakePlugin();
    plugin.getPending.mockResolvedValue({
      batches: [batch([file()]), batch([], { id: "bad-1" }), { id: "../evil" }, 7],
    });
    const onInvalid = vi.fn();
    const inbox = createShareInbox(plugin, { onInvalid });
    const pending = await inbox.takePending();
    expect(pending.map((b) => b.id)).toEqual(["b-1"]);
    expect(onInvalid).toHaveBeenCalledTimes(3);
    expect(plugin.acknowledge).toHaveBeenCalledExactlyOnceWith({ batchId: "bad-1" });
  });

  test("ignores a malformed pending payload and acknowledge failures", async () => {
    const { plugin } = fakePlugin();
    plugin.getPending.mockResolvedValueOnce({ batches: "nope" as unknown as unknown[] });
    const inbox = createShareInbox(plugin);
    await expect(inbox.takePending()).resolves.toEqual([]);
    plugin.getPending.mockResolvedValueOnce({ batches: [batch([], { id: "bad-2" })] });
    plugin.acknowledge.mockRejectedValueOnce(new Error("gone"));
    await expect(inbox.takePending()).resolves.toEqual([]);
  });

  test("delivers validated live batches and unsubscribes", async () => {
    const { plugin, emit, remove } = fakePlugin();
    const inbox = createShareInbox(plugin);
    const handler = vi.fn();
    const unsubscribe = await inbox.onReceived(handler);
    emit(batch([{ kind: "text", text: "hi" }]));
    emit(batch([{ kind: "nope" }], { id: "bad-3" }));
    await flush();
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      id: "b-1",
      receivedAt: "2026-10-26T19:00:00.000Z",
      items: [{ kind: "text", text: "hi" }],
    });
    expect(plugin.acknowledge).toHaveBeenCalledWith({ batchId: "bad-3" });
    await unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
  });

  test("hands each batch out once until it is acknowledged", async () => {
    const { plugin, emit } = fakePlugin();
    const shared = batch([{ kind: "text", text: "hi" }]);
    plugin.getPending.mockResolvedValue({ batches: [shared] });
    const inbox = createShareInbox(plugin);
    const handler = vi.fn();
    await inbox.onReceived(handler);
    const [pending] = await inbox.takePending();
    emit(shared);
    await flush();
    expect(handler).not.toHaveBeenCalled();
    await inbox.acknowledge(pending as ShareBatch);
    emit(shared);
    emit(shared);
    await flush();
    expect(handler).toHaveBeenCalledOnce();
  });

  test("acknowledges a batch", async () => {
    const { plugin } = fakePlugin();
    await createShareInbox(plugin).acknowledge(validateShareBatch(batch([file()])));
    expect(plugin.acknowledge).toHaveBeenCalledWith({ batchId: "b-1" });
  });
});

describe("readFile", () => {
  const read = async (
    bytes: Uint8Array,
    size: number,
    override?: (plugin: ReturnType<typeof fakePlugin>["plugin"]) => void,
    chunkBytes = 2,
  ) => {
    const { plugin } = fakePlugin(bytes);
    override?.(plugin);
    const inbox = createShareInbox(plugin as ShareIntakePlugin, {
      limits: { ...DEFAULT_SHARE_LIMITS, chunkBytes },
    });
    const shared: ShareBatch = validateShareBatch(
      batch([file({ size }), { kind: "text", text: "t" }]),
    );
    return { blob: inbox.readFile(shared, 0), plugin, inbox, shared };
  };

  test("reads a file in chunks into a typed Blob", async () => {
    const { blob, plugin } = await read(new Uint8Array([1, 2, 3]), 3);
    const result = await blob;
    expect(result.type).toBe("image/jpeg");
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(plugin.readChunk.mock.calls.map(([o]) => [o.offset, o.length])).toEqual([
      [0, 2],
      [2, 1],
    ]);
  });

  test("reads an empty file", async () => {
    const { blob } = await read(new Uint8Array([]), 0);
    expect((await blob).size).toBe(0);
  });

  test("probes for end of file when the native side has not signalled it", async () => {
    const { blob, plugin } = await read(new Uint8Array([1, 2]), 2, (p) => {
      p.readChunk.mockImplementation(async ({ offset, length }) => ({
        data: btoa(String.fromCharCode(...new Uint8Array([1, 2]).slice(offset, offset + length))),
        eof: length === 0,
      }));
    });
    expect((await blob).size).toBe(2);
    expect(plugin.readChunk).toHaveBeenCalledTimes(2);
  });

  test("rejects a file longer than declared", async () => {
    const { blob } = await read(new Uint8Array([1, 2, 3]), 2, (p) => {
      p.readChunk.mockImplementation(async ({ length }) => ({
        data: btoa(length === 0 ? "\u0003" : "\u0001\u0002"),
        eof: false,
      }));
    });
    await expect(blob).rejects.toThrow("file longer than declared");
  });

  test("rejects a native side that never reaches end of file", async () => {
    const { blob } = await read(new Uint8Array([1, 2]), 2, (p) => {
      p.readChunk.mockImplementation(async ({ length }) => ({
        data: length === 0 ? "" : btoa("\u0001\u0002"),
        eof: false,
      }));
    });
    await expect(blob).rejects.toThrow("file longer than declared");
  });

  test("rejects a chunk longer than requested", async () => {
    const { blob } = await read(new Uint8Array([1, 2, 3]), 3, (p) => {
      p.readChunk.mockResolvedValue({ data: btoa("\u0001\u0002\u0003"), eof: true });
    });
    await expect(blob).rejects.toThrow("chunk longer than requested");
  });

  test("rejects an empty chunk before the end", async () => {
    const { blob } = await read(new Uint8Array([1, 2, 3]), 3, (p) => {
      p.readChunk.mockResolvedValue({ data: "", eof: false });
    });
    await expect(blob).rejects.toThrow("empty chunk before end of file");
  });

  test("rejects a file shorter than declared", async () => {
    const { blob } = await read(new Uint8Array([1]), 3);
    await expect(blob).rejects.toThrow("file size does not match");
  });

  test.each([
    ["non-string data", { data: 5, eof: true }],
    ["invalid base64", { data: "%%%", eof: true }],
    ["a missing chunk", undefined],
  ])("rejects %s", async (_, chunk) => {
    const { blob } = await read(new Uint8Array([1]), 1, (p) => {
      p.readChunk.mockResolvedValue(chunk as unknown as { data: string; eof: boolean });
    });
    await expect(blob).rejects.toBeInstanceOf(InvalidShareError);
  });

  test("only reads file items", async () => {
    const { inbox, shared } = await read(new Uint8Array([1]), 1);
    await expect(inbox.readFile(shared, 1)).rejects.toThrow(TypeError);
    await expect(inbox.readFile(shared, 9)).rejects.toThrow(TypeError);
  });
});
