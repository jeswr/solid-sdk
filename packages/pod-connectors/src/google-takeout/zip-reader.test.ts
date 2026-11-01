// AUTHORED-BY Codex GPT-6.1-Sol
import { deflateSync, strToU8, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import type { ImportFile } from "../core/file-import.js";
import {
  InflationBudget,
  rangedChunks,
  readZip,
  readZipEntry,
  ZIP_PIECE_BYTES,
  zipDirectory,
} from "./zip-reader.js";

/** Sparse synthetic file: tests ZIP64 offsets above 4 GiB without allocating the gaps. */
function sparse(size: number, sections: [number, Uint8Array][]): ImportFile {
  const file: ImportFile = {
    name: "synthetic.zip",
    type: "application/zip",
    size,
    text: async () => {
      throw new Error("text forbidden");
    },
    slice(start, end) {
      expect(end - start).toBeLessThanOrEqual(ZIP_PIECE_BYTES);
      const bytes = new Uint8Array(end - start);
      for (const [offset, section] of sections) {
        const a = Math.max(start, offset),
          b = Math.min(end, offset + section.length);
        if (a < b) bytes.set(section.subarray(a - offset, b - offset), a - start);
      }
      return {
        stream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      };
    },
    stream: () => file.slice!(0, 4).stream(),
  };
  return file;
}
function memory(bytes: Uint8Array): ImportFile {
  return sparse(bytes.length, [[0, bytes]]);
}
function uints(length: number) {
  const bytes = new Uint8Array(length),
    view = new DataView(bytes.buffer);
  return {
    bytes,
    word: (at: number, n: number) => view.setUint16(at, n, true),
    int: (at: number, n: number) => view.setUint32(at, n, true),
    wide: (at: number, n: bigint) => view.setBigUint64(at, n, true),
  };
}
function fixture(
  options: {
    zip64?: boolean;
    offset?: number;
    data?: Uint8Array;
    compressed?: Uint8Array;
    declared?: number;
    method?: number;
    flags?: number;
    padding?: number;
    disk?: number;
  } = {},
) {
  const name = strToU8("Takeout/Drive/a.txt");
  const data = options.data ?? strToU8("synthetic");
  const method = options.method ?? 8;
  const compressed = options.compressed ?? (method === 8 ? deflateSync(data) : data);
  const offset = options.offset ?? 0;
  const extra = options.zip64 ? uints(32) : uints(0);
  if (options.zip64) {
    extra.word(0, 1);
    extra.word(2, 28);
    extra.wide(4, BigInt(options.declared ?? data.length));
    extra.wide(12, BigInt(compressed.length + (options.padding ?? 0)));
    extra.wide(20, BigInt(offset));
    extra.int(28, options.disk ?? 0);
  }
  const local = uints(30 + name.length);
  local.int(0, 0x04034b50);
  local.word(6, options.flags ?? 8);
  local.word(8, method);
  local.word(26, name.length);
  local.bytes.set(name, 30);
  const central = uints(46 + name.length + extra.bytes.length);
  central.int(0, 0x02014b50);
  central.word(8, options.flags ?? 8);
  central.word(10, method);
  const reference = zipSync({ a: data }, { level: 0 });
  central.int(16, new DataView(reference.buffer).getUint32(14, true));
  central.int(20, options.zip64 ? 0xffffffff : compressed.length + (options.padding ?? 0));
  central.int(24, options.zip64 ? 0xffffffff : (options.declared ?? data.length));
  central.word(28, name.length);
  central.word(30, extra.bytes.length);
  central.word(34, options.zip64 ? 0xffff : (options.disk ?? 0));
  central.int(42, options.zip64 ? 0xffffffff : offset);
  central.bytes.set(name, 46);
  central.bytes.set(extra.bytes, 46 + name.length);
  const start = offset + local.bytes.length + compressed.length + (options.padding ?? 0);
  const eocd = uints(22);
  eocd.int(0, 0x06054b50);
  eocd.word(8, options.zip64 ? 0xffff : 1);
  eocd.word(10, options.zip64 ? 0xffff : 1);
  eocd.int(12, central.bytes.length);
  eocd.int(16, options.zip64 ? 0xffffffff : start);
  const directoryEnd = start + central.bytes.length;
  const tail = uints(options.zip64 ? 76 : 0);
  if (options.zip64) {
    tail.int(0, 0x06064b50);
    tail.wide(4, 44n);
    tail.wide(24, 1n);
    tail.wide(32, 1n);
    tail.wide(40, BigInt(central.bytes.length));
    tail.wide(48, BigInt(start));
    tail.int(56, 0x07064b50);
    tail.wide(64, BigInt(directoryEnd));
    tail.int(72, 1);
  }
  const sections: [number, Uint8Array][] = [
    [offset, local.bytes],
    [offset + local.bytes.length, compressed],
    [start, central.bytes],
    [directoryEnd, tail.bytes],
    [directoryEnd + tail.bytes.length, eocd.bytes],
  ];
  const file = sparse(directoryEnd + tail.bytes.length + 22, sections);
  return { file, local, central, extra, tail, eocd, start, directoryEnd, sections };
}
const discard = () => ({ push: async () => {} });

it("aborts on decoder errors that follow internal output, without trying another entry", async () => {
  // A non-final stored block emits a byte internally, then reserved block type 3
  // throws before fflate invokes ondata for this push.
  const f = fixture({ data: strToU8("a"), compressed: new Uint8Array([0, 1, 0, 254, 255, 97, 7]) });
  const [first] = await zipDirectory(f.file);
  const push = vi.fn(async () => {});
  const entry = vi.fn(() => ({ push }));
  const skip = vi.fn();
  await expect(
    readZip(f.file, { entry, skip }, [first, { ...first, name: "next" }]),
  ).rejects.toThrow(/ZIP decoder failed; archive import aborted/);
  expect(entry).toHaveBeenCalledTimes(1);
  expect(push).not.toHaveBeenCalled();
  expect(skip).not.toHaveBeenCalled();
});

it.each([
  0, 6,
] as const)("charges actual output from underdeclared entries and stops the archive, level=%s", async (level) => {
  const bytes = zipSync(
    { a: new Uint8Array(16), b: new Uint8Array(16), c: new Uint8Array(16) },
    { level },
  );
  const view = new DataView(bytes.buffer);
  let offset = view.getUint32(bytes.length - 6, true);
  for (let i = 0; i < 3; i++) {
    view.setUint32(offset + 24, 1, true);
    offset += 46 + view.getUint16(offset + 28, true);
  }
  const skip = vi.fn();
  const entry = vi.fn(discard);
  await expect(readZip(memory(bytes), { entry, skip, maxTotalBytes: 20 })).rejects.toThrow(
    /total-inflated-cap-exceeded/,
  );
  expect(skip.mock.calls).toEqual([["a", "declared-size-mismatch"]]);
  expect(entry.mock.calls.map(([name]) => name)).toEqual(["a", "b"]);
});

it.each(["size", "crc", "boundary"])("charges output before a failed %s check", async (failure) => {
  const data = strToU8("synthetic output");
  const f = fixture({ data, padding: failure === "boundary" ? 1 : 0 });
  if (failure === "size") f.central.int(24, 1);
  if (failure === "crc") f.central.int(16, 0);
  const [entry] = await zipDirectory(f.file);
  const inflationBudget = new InflationBudget(100);
  await expect(readZipEntry(f.file, entry, discard(), { inflationBudget })).rejects.toThrow();
  expect(inflationBudget.remaining).toBe(100 - data.length);
});

it.each([
  false,
  true,
])("reads data descriptors without interpreting embedded ZIP signatures, deflated=%s", async (deflated) => {
  const content = strToU8("prefixPK\x03\x04fakePK\x07\x08descriptorPK\x01\x02centralPK\x05\x06end");
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, bytes) => {
    if (error) throw error;
    chunks.push(bytes);
  });
  const entry = deflated
    ? new ZipDeflate("Takeout/Drive/a")
    : new ZipPassThrough("Takeout/Drive/a");
  zip.add(entry);
  entry.push(content, true);
  zip.end();
  const combined = new Uint8Array(chunks.reduce((n, bytes) => n + bytes.length, 0));
  let offset = 0;
  for (const bytes of chunks) {
    combined.set(bytes, offset);
    offset += bytes.length;
  }
  const received: number[] = [],
    names: string[] = [],
    skip = vi.fn();
  await readZip(memory(combined), {
    entry(name) {
      names.push(name);
      return {
        async push(bytes) {
          received.push(...bytes);
        },
      };
    },
    skip,
  });
  expect(names).toEqual(["Takeout/Drive/a"]);
  expect(new Uint8Array(received)).toEqual(content);
  expect(skip).not.toHaveBeenCalled();
});

it("reads ZIP64 sizes, disks and offsets above 4 GiB", async () => {
  const { file } = fixture({ zip64: true, offset: 2 ** 32 + 123 });
  const entries = await zipDirectory(file);
  expect(entries[0].offset).toBe(2 ** 32 + 123);
  const push = vi.fn(async () => {}),
    skip = vi.fn();
  await readZip(file, { entry: () => ({ push }), skip }, entries);
  expect(skip).not.toHaveBeenCalled();
  expect(push).toHaveBeenLastCalledWith(new Uint8Array(), true);
});

it("rejects overlapping entries before dispatching either", async () => {
  const bytes = zipSync(
    { "Takeout/Drive/a": strToU8("a"), "Takeout/Drive/b": strToU8("b") },
    { level: 0 },
  );
  const view = new DataView(bytes.buffer);
  const start = view.getUint32(bytes.length - 6, true);
  view.setUint32(start + 20, 45, true);
  const skip = vi.fn(),
    entry = vi.fn(discard);
  await readZip(memory(bytes), { entry, skip });
  expect(entry).not.toHaveBeenCalled();
  expect(skip).toHaveBeenCalledTimes(2);
});

it.each([
  ["crc-mismatch", (f: ReturnType<typeof fixture>) => f.central.int(16, 0)],
  ["declared-size-mismatch", (f: ReturnType<typeof fixture>) => f.central.int(24, 1)],
  ["declared-size-mismatch", (f: ReturnType<typeof fixture>) => f.central.int(24, 100)],
])("withholds completion after %s", async (reason, mutate) => {
  const f = fixture();
  mutate(f);
  const push = vi.fn(async () => {}),
    skip = vi.fn();
  await readZip(f.file, { entry: () => ({ push }), skip });
  expect(skip).toHaveBeenCalledWith("Takeout/Drive/a.txt", reason);
  expect(push.mock.calls.some((call) => call[1])).toBe(false);
});

it("stops a completed inflater at its first piece instead of retaining trailing compressed input", async () => {
  const f = fixture({ data: new Uint8Array(), padding: 60 * 1024 * 1024 });
  const entries = await zipDirectory(f.file);
  const slice = vi.spyOn(f.file, "slice"),
    skip = vi.fn();
  await readZip(f.file, { entry: discard, skip }, entries);
  expect(skip).toHaveBeenCalledWith("Takeout/Drive/a.txt", "invalid-deflate-boundary");
  expect(slice).toHaveBeenCalledTimes(1);
});

it("rejects truncated DEFLATE even when the caller supplied a final chunk", async () => {
  const f = fixture({ data: new Uint8Array(), compressed: new Uint8Array() });
  const skip = vi.fn();
  await readZip(f.file, { entry: discard, skip });
  expect(skip).toHaveBeenCalledWith("Takeout/Drive/a.txt", "incomplete-deflate-entry");
});

it("bounds emitted inflation and propagates sink failures", async () => {
  const f = fixture();
  const [entry] = await zipDirectory(f.file);
  await expect(readZipEntry(f.file, entry, discard(), {}, 1)).rejects.toThrow(/inflated-cap/);
  await expect(
    readZip(f.file, {
      entry: () => ({
        async push() {
          throw new Error("pod failure");
        },
      }),
      skip: vi.fn(),
    }),
  ).rejects.toThrow("pod failure");
});

it.each([
  ["local signature", (f: ReturnType<typeof fixture>) => f.local.int(0, 0)],
  ["flags", (f: ReturnType<typeof fixture>) => f.local.word(6, 0)],
  ["method", (f: ReturnType<typeof fixture>) => f.local.word(8, 0)],
  ["name length", (f: ReturnType<typeof fixture>) => f.local.word(26, 0)],
  [
    "name",
    (f: ReturnType<typeof fixture>) => {
      f.local.bytes[30] = 1;
    },
  ],
  ["offset", (f: ReturnType<typeof fixture>) => f.central.int(42, 0xfffffffe)],
  ["data range", (f: ReturnType<typeof fixture>) => f.central.int(20, 100000)],
  ["directory overlap", (f: ReturnType<typeof fixture>) => f.central.int(20, 50)],
  ["missing ZIP64 extra", (f: ReturnType<typeof fixture>) => f.central.int(24, 0xffffffff)],
])("skips inconsistent %s", async (_, mutate) => {
  const f = fixture();
  mutate(f);
  const skip = vi.fn(),
    entry = vi.fn(discard);
  await readZip(f.file, { entry, skip });
  expect(entry).not.toHaveBeenCalled();
  expect(skip).toHaveBeenCalledWith("Takeout/Drive/a.txt", "invalid-entry");
});

it.each([
  ["missing end record", (f: ReturnType<typeof fixture>) => f.eocd.int(0, 0)],
  ["disk", (f: ReturnType<typeof fixture>) => f.eocd.word(4, 1)],
  ["start disk", (f: ReturnType<typeof fixture>) => f.eocd.word(6, 1)],
  ["disk count", (f: ReturnType<typeof fixture>) => f.eocd.word(8, 0)],
  ["directory cap", (f: ReturnType<typeof fixture>) => f.eocd.int(12, 64 * 1024 * 1024 + 1)],
  ["directory boundary", (f: ReturnType<typeof fixture>) => f.eocd.int(12, 1)],
  ["central signature", (f: ReturnType<typeof fixture>) => f.central.int(0, 0)],
  [
    "entry count",
    (f: ReturnType<typeof fixture>) => {
      f.eocd.word(8, 2);
      f.eocd.word(10, 2);
    },
  ],
  [
    "directory size",
    (f: ReturnType<typeof fixture>) => {
      f.eocd.word(8, 0);
      f.eocd.word(10, 0);
    },
  ],
  ["multi-disk entry", (f: ReturnType<typeof fixture>) => f.central.word(34, 1)],
])("rejects invalid archive %s before dispatch", async (_, mutate) => {
  const f = fixture();
  mutate(f);
  const entry = vi.fn(discard);
  await expect(readZip(f.file, { entry, skip: vi.fn() })).rejects.toThrow();
  expect(entry).not.toHaveBeenCalled();
});

it.each([
  (f: ReturnType<typeof fixture>) => f.tail.int(56, 0),
  (f: ReturnType<typeof fixture>) => f.tail.int(60, 1),
  (f: ReturnType<typeof fixture>) => f.tail.int(72, 2),
  (f: ReturnType<typeof fixture>) => f.tail.int(0, 0),
  (f: ReturnType<typeof fixture>) => f.tail.wide(4, 43n),
  (f: ReturnType<typeof fixture>) => f.tail.wide(4, 45n),
  (f: ReturnType<typeof fixture>) => f.tail.int(16, 1),
  (f: ReturnType<typeof fixture>) => f.tail.int(20, 1),
  (f: ReturnType<typeof fixture>) => f.tail.wide(24, 2n),
  (f: ReturnType<typeof fixture>) => f.tail.wide(48, 2n ** 54n),
])("rejects malformed ZIP64 framing %#", async (mutate) => {
  const f = fixture({ zip64: true });
  mutate(f);
  await expect(zipDirectory(f.file)).rejects.toThrow();
});

it.each([
  (f: ReturnType<typeof fixture>) => f.extra.word(2, 100),
  (f: ReturnType<typeof fixture>) => f.extra.word(2, 1),
  (f: ReturnType<typeof fixture>) => f.extra.word(2, 8),
  (f: ReturnType<typeof fixture>) => f.extra.word(2, 16),
  (f: ReturnType<typeof fixture>) => f.extra.word(2, 24),
  (f: ReturnType<typeof fixture>) => f.extra.word(0, 2),
])("skips malformed ZIP64 extras %#", async (mutate) => {
  const f = fixture({ zip64: true });
  mutate(f);
  // Sections use the same bytes as the exposed extra writer.
  f.central.bytes.set(f.extra.bytes, f.central.bytes.length - f.extra.bytes.length);
  expect((await zipDirectory(f.file))[0].invalid).toBe("invalid-entry");
});

it("checks range port, bounds, short reads and excess bytes, and cancels early consumers", async () => {
  const file = memory(strToU8("abcd"));
  await expect(zipDirectory({ ...file, slice: undefined })).rejects.toThrow(/slice/);
  const collect = async (file: ImportFile, start = 0, end = 4) => {
    for await (const _ of rangedChunks(file, start, end)) {
    }
  };
  await expect(collect({ ...file, slice: undefined })).rejects.toThrow(/slice/);
  for (const [a, b] of [
    [-1, 1],
    [1, 0],
    [0, 5],
    [0.5, 1],
    [0, Number.NaN],
  ])
    await expect(collect(file, a, b)).rejects.toThrow(/range/);
  for (const size of [0, 3, 5])
    await expect(
      collect({
        ...file,
        slice: () => ({
          stream: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(size));
                controller.close();
              },
            }),
        }),
      }),
    ).rejects.toThrow();
  const cancel = vi.fn();
  const iterator = rangedChunks(
    {
      ...file,
      slice: () => ({
        stream: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(strToU8("abcd"));
            },
            cancel,
          }),
      }),
    },
    0,
    4,
  );
  await iterator.next();
  await iterator.return(undefined);
  expect(cancel).toHaveBeenCalled();
});

it("allows ZIP64 extras when the central record already contains ordinary values", async () => {
  const f = fixture({ zip64: true });
  f.central.int(20, 11);
  f.central.int(24, 9);
  f.central.int(42, 0);
  f.central.word(34, 0);
  expect((await zipDirectory(f.file))[0].invalid).toBeUndefined();
});
it("marks nested overlaps and duplicate names independently of entry data", async () => {
  const bytes = zipSync(
    { "Takeout/Drive/a": strToU8("a"), "Takeout/Drive/b": strToU8("b") },
    { level: 0 },
  );
  const view = new DataView(bytes.buffer),
    start = view.getUint32(bytes.length - 6, true);
  const secondCentral = start + 46 + "Takeout/Drive/a".length;
  const secondLocal = view.getUint32(secondCentral + 42, true);
  bytes[secondLocal + 30 + "Takeout/Drive/".length] = 97;
  bytes[secondCentral + 46 + "Takeout/Drive/".length] = 97;
  const entries = await zipDirectory(memory(bytes));
  expect(entries.map((entry) => entry.invalid)).toEqual(["duplicate-entry", "duplicate-entry"]);
  // Put the first range around the second range (and its header).
  view.setUint32(start + 20, start - (30 + "Takeout/Drive/a".length), true);
  // Shorten the nested range so its end is below the outer range.
  view.setUint32(secondCentral + 20, 0, true);
  const overlap = await zipDirectory(memory(bytes));
  expect(overlap.every((entry) => entry.invalid)).toBe(true);
});
it("rejects ZIP64 entries on another disk", async () => {
  await expect(zipDirectory(fixture({ zip64: true, disk: 1 }).file)).rejects.toThrow(/Multi-disk/);
});
