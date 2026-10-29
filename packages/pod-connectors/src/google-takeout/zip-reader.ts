// AUTHORED-BY Codex GPT-6.1-Sol
import { Inflate } from "fflate";
import type { ImportFile } from "../core/file-import.js";

export const ZIP_PIECE_BYTES = 64 * 1024;
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024 * 1024;
export const MAX_ENTRIES = 100_000;
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

export class TotalInflatedLimit extends Error {
  constructor() {
    super("Takeout total-inflated-cap-exceeded.");
  }
}

export class ZipDecoderError extends Error {
  constructor() {
    super("Takeout ZIP decoder failed; archive import aborted.");
  }
}

/** Shared by header sniffing and archive dispatch; failed output is still work produced. */
export class InflationBudget {
  private total = 0;
  constructor(private readonly maxBytes = MAX_TOTAL_BYTES) {}
  get remaining(): number {
    return this.maxBytes - this.total;
  }
  charge(bytes: number): void {
    this.total += bytes;
    if (this.total > this.maxBytes) throw new TotalInflatedLimit();
  }
}

export interface EntrySink {
  push(bytes: Uint8Array, final: boolean): Promise<void>;
}
export interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  offset: number;
  dataStart: number;
  invalid?: string;
}
export interface ZipOptions {
  entry(name: string): EntrySink;
  skip(name: string, reason: string): void | Promise<void>;
  maxTotalBytes?: number;
  maxEntries?: number;
  inflationBudget?: InflationBudget;
  limit?(name: string): number;
  /** Inflated bytes awaiting downstream processing, excluding handler buffers. */
  pendingBytes?(bytes: number): void;
}
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const u16 = (bytes: Uint8Array, offset: number) => view(bytes).getUint16(offset, true);
const u32 = (bytes: Uint8Array, offset: number) => view(bytes).getUint32(offset, true);
function u64(bytes: Uint8Array, offset: number): number {
  const value = view(bytes).getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ZIP64 value exceeds safe range.");
  return Number(value);
}
function range(file: ImportFile, start: number, end: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > file.size
  )
    throw new Error("Invalid ZIP range.");
}

/** Request bounded ranges even when a host's stream uses larger chunks. */
export async function* rangedChunks(
  file: ImportFile,
  start: number,
  end: number,
): AsyncGenerator<Uint8Array> {
  range(file, start, end);
  if (!file.slice) throw new Error("Takeout zip imports require file.slice().");
  for (let offset = start; offset < end; offset += ZIP_PIECE_BYTES) {
    const stop = Math.min(end, offset + ZIP_PIECE_BYTES);
    const reader = file.slice(offset, stop).stream().getReader();
    let received = 0;
    let ended = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          ended = true;
          break;
        }
        received += value.length;
        if (received > stop - offset) throw new Error("ZIP range grew while reading.");
        yield value;
      }
      if (received !== stop - offset) throw new Error("Truncated ZIP range.");
    } finally {
      try {
        if (!ended) await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  }
}
async function bytesAt(file: ImportFile, start: number, length: number): Promise<Uint8Array> {
  range(file, start, start + length);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for await (const chunk of rangedChunks(file, start, start + length)) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Parse central records incrementally; only bounded metadata survives validation. */
export async function zipDirectory(
  file: ImportFile,
  maxEntries = MAX_ENTRIES,
): Promise<ZipEntry[]> {
  if (!file.slice) throw new Error("Takeout zip imports require file.slice().");
  range(file, 0, file.size);
  const tailStart = Math.max(0, file.size - 65535 - 22);
  const tail = await bytesAt(file, tailStart, file.size - tailStart);
  let eocd = tail.length - 22;
  while (
    eocd >= 0 &&
    (u32(tail, eocd) !== 0x06054b50 || eocd + 22 + u16(tail, eocd + 20) !== tail.length)
  )
    eocd--;
  if (eocd < 0) throw new Error("ZIP end-of-central-directory missing.");
  if (u16(tail, eocd + 4) || u16(tail, eocd + 6)) throw new Error("Multi-disk ZIP is unsupported.");
  let count = u16(tail, eocd + 10);
  let size = u32(tail, eocd + 12);
  let start = u32(tail, eocd + 16);
  let directoryEnd = tailStart + eocd;
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) {
    const locator = await bytesAt(file, directoryEnd - 20, 20);
    if (u32(locator, 0) !== 0x07064b50 || u32(locator, 4) || u32(locator, 16) !== 1)
      throw new Error("Invalid ZIP64 locator or multi-disk archive.");
    directoryEnd = u64(locator, 8);
    const record = await bytesAt(file, directoryEnd, 56);
    if (
      u32(record, 0) !== 0x06064b50 ||
      u64(record, 4) < 44 ||
      directoryEnd + 12 + u64(record, 4) !== tailStart + eocd - 20 ||
      u32(record, 16) ||
      u32(record, 20) ||
      u64(record, 24) !== u64(record, 32)
    )
      throw new Error("Invalid ZIP64 directory.");
    count = u64(record, 32);
    size = u64(record, 40);
    start = u64(record, 48);
  } else if (u16(tail, eocd + 8) !== count) throw new Error("Multi-disk ZIP is unsupported.");
  if (size > MAX_DIRECTORY_BYTES) throw new Error("ZIP central directory exceeds 64 MiB.");
  range(file, start, start + size);
  if (start + size !== directoryEnd) throw new Error("Invalid ZIP directory boundary.");
  if (count > maxEntries) throw new Error("ZIP entry-count-cap-exceeded.");
  const iterator = rangedChunks(file, start, start + size);
  let pending: Uint8Array = new Uint8Array();
  const take = async (length: number): Promise<Uint8Array> => {
    while (pending.length < length) {
      const next = await iterator.next();
      if (next.done) throw new Error("Truncated ZIP central directory.");
      const joined = new Uint8Array(pending.length + next.value.length);
      joined.set(pending);
      joined.set(next.value, pending.length);
      pending = joined;
    }
    const result = pending.slice(0, length);
    pending = pending.subarray(length);
    return result;
  };
  const entries: ZipEntry[] = [];
  let consumed = 0;
  try {
    for (let index = 0; index < count; index++) {
      const fixed = await take(46);
      if (u32(fixed, 0) !== 0x02014b50) throw new Error("Invalid ZIP central record.");
      const nameLength = u16(fixed, 28),
        extraLength = u16(fixed, 30),
        commentLength = u16(fixed, 32);
      const variable = await take(nameLength + extraLength + commentLength);
      consumed += 46 + variable.length;
      const entry: ZipEntry = {
        name: new TextDecoder("utf-8", { fatal: true }).decode(variable.subarray(0, nameLength)),
        flags: u16(fixed, 8),
        method: u16(fixed, 10),
        crc: u32(fixed, 16),
        compressedSize: u32(fixed, 20),
        size: u32(fixed, 24),
        offset: u32(fixed, 42),
        dataStart: 0,
      };
      let disk = u16(fixed, 34);
      try {
        const extra = variable.subarray(nameLength, nameLength + extraLength);
        let zip64 = false;
        for (let pos = 0; pos < extra.length; ) {
          if (pos + 4 > extra.length || pos + 4 + u16(extra, pos + 2) > extra.length)
            throw new Error("Invalid ZIP extra.");
          const end = pos + 4 + u16(extra, pos + 2);
          if (u16(extra, pos) === 1) {
            let cursor = pos + 4;
            const wide = () => {
              if (cursor + 8 > end) throw new Error("Truncated ZIP64 extra.");
              const n = u64(extra, cursor);
              cursor += 8;
              return n;
            };
            if (entry.size === 0xffffffff) entry.size = wide();
            if (entry.compressedSize === 0xffffffff) entry.compressedSize = wide();
            if (entry.offset === 0xffffffff) entry.offset = wide();
            if (disk === 0xffff) {
              if (cursor + 4 > end) throw new Error("Truncated ZIP64 disk.");
              disk = u32(extra, cursor);
            }
            zip64 = true;
          }
          pos = end;
        }
        if (!zip64 && [entry.size, entry.compressedSize, entry.offset].includes(0xffffffff))
          throw new Error("Missing ZIP64 extra.");
        range(file, entry.offset, entry.offset + 30);
        const local = await bytesAt(file, entry.offset, 30);
        if (
          u32(local, 0) !== 0x04034b50 ||
          u16(local, 6) !== entry.flags ||
          u16(local, 8) !== entry.method ||
          u16(local, 26) !== nameLength
        )
          throw new Error("Inconsistent ZIP local header.");
        const localName = await bytesAt(file, entry.offset + 30, nameLength);
        if (!localName.every((byte, i) => byte === variable[i]))
          throw new Error("Inconsistent ZIP local name.");
        entry.dataStart = entry.offset + 30 + nameLength + u16(local, 28);
        range(file, entry.dataStart, entry.dataStart + entry.compressedSize);
        if (entry.dataStart + entry.compressedSize > start)
          throw new Error("ZIP entry overlaps directory.");
      } catch {
        entry.invalid = "invalid-entry";
      }
      if (!entry.invalid && disk) throw new Error("Multi-disk ZIP is unsupported.");
      entries.push(entry);
    }
    if (consumed !== size) throw new Error("ZIP central directory size mismatch.");
  } finally {
    await iterator.return(undefined);
  }
  const sorted = entries.filter((entry) => !entry.invalid).sort((a, b) => a.offset - b.offset);
  let previous: ZipEntry | undefined;
  let end = -1;
  for (const entry of sorted) {
    if (entry.offset < end) {
      entry.invalid = "overlapping-entry";
      (previous as ZipEntry).invalid = "overlapping-entry";
    }
    if (entry.dataStart + entry.compressedSize >= end) {
      end = entry.dataStart + entry.compressedSize;
      previous = entry;
    }
  }
  const names = new Map<string, ZipEntry>();
  for (const entry of entries) {
    const earlier = names.get(entry.name);
    if (earlier) {
      entry.invalid = "duplicate-entry";
      earlier.invalid = "duplicate-entry";
    }
    names.set(entry.name, entry);
    if (!entry.invalid && entry.flags & 1) entry.invalid = "encrypted-entry";
    if (!entry.invalid && entry.method !== 0 && entry.method !== 8)
      entry.invalid = "unsupported-compression";
  }
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crcUpdate(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 255] as number) ^ (crc >>> 8);
  return crc;
}
class InvalidEntry extends Error {}

/** fflate 0.8.3's public final flag reflects the caller, not DEFLATE's BFINAL.
 * Check its pinned Inflate state after each push: completed input must end at the
 * declared boundary and pending compressed data may never exceed one stored block.
 * No ZIP framing relies on fflate internals. */
function inflateState(inflate: Inflate): { finished: boolean; pending: number } {
  const { s, p } = inflate as unknown as {
    s: { f?: number; l?: unknown; p: number };
    p: Uint8Array;
  };
  return { finished: !!s.f && !s.l, pending: p.length - Math.ceil(s.p / 8) };
}

/** Stream a validated range, withholding final dispatch until size/CRC/DEFLATE checks pass.
 * A sink may deliberately stop early (mail header sniff); callers must not treat that as validation. */
export async function readZipEntry(
  file: ImportFile,
  entry: ZipEntry,
  sink: EntrySink,
  options: Pick<ZipOptions, "pendingBytes" | "inflationBudget"> = {},
  cap = MAX_TOTAL_BYTES,
  pieceBytes = ZIP_PIECE_BYTES,
): Promise<number> {
  let size = 0;
  let crc = -1;
  let output: Uint8Array = new Uint8Array();
  const inflate =
    entry.method === 8
      ? new Inflate((bytes) => {
          // Charge before boundary, size, CRC or downstream checks can reject this output.
          options.inflationBudget?.charge(bytes.length);
          output = bytes;
        })
      : undefined;
  let compressed = 0;
  for await (const chunk of rangedChunks(
    file,
    entry.dataStart,
    entry.dataStart + entry.compressedSize,
  )) {
    for (let offset = 0; offset < chunk.length; offset += pieceBytes) {
      const bytes = chunk.subarray(offset, offset + pieceBytes);
      compressed += bytes.length;
      if (inflate) {
        output = new Uint8Array();
        try {
          inflate.push(bytes, compressed === entry.compressedSize);
        } catch (error) {
          if (error instanceof TotalInflatedLimit) throw error;
          // fflate may produce bytes internally before throwing without calling
          // ondata. Abort the archive because that work cannot be charged safely.
          throw new ZipDecoderError();
        }
        const state = inflateState(inflate);
        if (
          state.pending > ZIP_PIECE_BYTES + 5 ||
          (state.finished && (state.pending !== 0 || compressed !== entry.compressedSize))
        )
          throw new InvalidEntry("invalid-deflate-boundary");
      } else {
        options.inflationBudget?.charge(bytes.length);
        output = bytes;
      }
      size += output.length;
      if (size > entry.size) throw new InvalidEntry("declared-size-mismatch");
      if (size > cap) throw new InvalidEntry("inflated-cap-exceeded");
      crc = crcUpdate(crc, output);
      options.pendingBytes?.(output.length);
      try {
        await sink.push(output, false);
      } finally {
        options.pendingBytes?.(0);
      }
    }
  }
  if (inflate && !inflateState(inflate).finished)
    throw new InvalidEntry("incomplete-deflate-entry");
  if (size !== entry.size) throw new InvalidEntry("declared-size-mismatch");
  if ((crc ^ -1) >>> 0 !== entry.crc) throw new InvalidEntry("crc-mismatch");
  await sink.push(new Uint8Array(), true);
  return size;
}
export async function readZip(
  file: ImportFile,
  options: ZipOptions,
  directory?: ZipEntry[],
): Promise<void> {
  const entries = directory ?? (await zipDirectory(file, options.maxEntries));
  const inflationBudget = options.inflationBudget ?? new InflationBudget(options.maxTotalBytes);
  for (const entry of entries) {
    if (entry.invalid) {
      await options.skip(entry.name, entry.invalid);
      continue;
    }
    if (entry.size > inflationBudget.remaining) {
      await options.skip(entry.name, "total-inflated-cap-exceeded");
      continue;
    }
    if (entry.size > (options.limit?.(entry.name) ?? MAX_TOTAL_BYTES)) {
      await options.skip(entry.name, "entry-inflated-cap-exceeded");
      continue;
    }
    try {
      await readZipEntry(
        file,
        entry,
        options.entry(entry.name),
        { ...options, inflationBudget },
        options.limit?.(entry.name) ?? MAX_TOTAL_BYTES,
      );
    } catch (error) {
      if (!(error instanceof InvalidEntry)) throw error;
      await options.skip(entry.name, error.message);
    }
  }
}

/** Bound whole-file accumulation before retaining a chunk, releasing it on a breach. */
export function cappedSink(
  cap: number,
  complete: (bytes: Uint8Array | undefined, size: number) => Promise<void>,
): EntrySink {
  let chunks: Uint8Array[] = [];
  let size = 0;
  let exceeded = false;
  return {
    async push(bytes, final) {
      size += bytes.length;
      if (size > cap) {
        exceeded = true;
        chunks = [];
      } else chunks.push(bytes.slice());
      if (!final) return;
      if (exceeded) {
        await complete(undefined, size);
        return;
      }
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      chunks = [];
      await complete(joined, size);
    },
  };
}
