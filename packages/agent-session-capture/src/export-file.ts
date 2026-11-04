// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { constants } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { open } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { crc32, inflateRawSync } from "zlib";
import { MAX_BYTES } from "./io.js";

function region(bytes: Buffer, offset: number, size: number): Buffer {
  if (offset + size > bytes.length) throw new Error("Invalid ZIP bounds");
  return bytes.subarray(offset, offset + size);
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

/** Decode only a unique root conversations.json from a bounded, single-disk stored/deflated ZIP.
 * No entry is ever extracted to disk. Unsafe paths, links, encryption and ZIP64 are refused.
 */
export function chatgptZipJson(bytes: Buffer): string {
  if (bytes.length > MAX_BYTES) throw new Error("Export exceeds limit");
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (
      bytes.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
    )
      break;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw new Error("Invalid ZIP directory");
  const tail = region(bytes, end, 22);
  const entries = tail.readUInt16LE(10);
  const size = tail.readUInt32LE(12);
  const start = tail.readUInt32LE(16);
  if (
    tail.readUInt16LE(4) !== 0 ||
    tail.readUInt16LE(6) !== 0 ||
    tail.readUInt16LE(8) !== entries ||
    entries > 10000 ||
    start + size !== end
  )
    throw new Error("Unsupported ZIP directory");
  let cursor = start;
  let found: Buffer | undefined;
  for (let i = 0; i < entries; i++) {
    const header = region(bytes, cursor, 46);
    if (header.readUInt32LE(0) !== 0x02014b50) throw new Error("Invalid ZIP entry");
    const flags = header.readUInt16LE(8);
    const method = header.readUInt16LE(10);
    const compressed = header.readUInt32LE(20);
    const expanded = header.readUInt32LE(24);
    const nameLength = header.readUInt16LE(28);
    const nameBytes = region(bytes, cursor + 46, nameLength);
    const name = decode(nameBytes);
    const mode = (header.readUInt32LE(38) >>> 16) & 0o170000;
    if (
      (flags & ~0x80e) !== 0 ||
      (method !== 0 && method !== 8) ||
      header.readUInt16LE(34) !== 0 ||
      mode === 0o120000 ||
      /[\\:\p{Cc}]/u.test(name) ||
      name.startsWith("/") ||
      name.split("/").some((part) => part === ".." || part === ".") ||
      compressed === 0xffffffff ||
      expanded === 0xffffffff
    )
      throw new Error("Unsafe or unsupported ZIP entry");
    cursor += 46 + nameLength + header.readUInt16LE(30) + header.readUInt16LE(32);
    if (cursor > end) throw new Error("Invalid ZIP entry length");
    if (name !== "conversations.json") continue;
    if (found !== undefined || expanded > MAX_BYTES)
      throw new Error("Invalid conversations ZIP entry");
    const offset = header.readUInt32LE(42);
    const local = region(bytes, offset, 30);
    const localNameLength = local.readUInt16LE(26);
    const dataStart = offset + 30 + localNameLength + local.readUInt16LE(28);
    if (
      local.readUInt32LE(0) !== 0x04034b50 ||
      local.readUInt16LE(6) !== flags ||
      local.readUInt16LE(8) !== method ||
      !region(bytes, offset + 30, localNameLength).equals(nameBytes) ||
      dataStart + compressed > start ||
      ((flags & 8) === 0 &&
        (local.readUInt32LE(14) !== header.readUInt32LE(16) ||
          local.readUInt32LE(18) !== compressed ||
          local.readUInt32LE(22) !== expanded))
    )
      throw new Error("Invalid ZIP local entry");
    const payload = region(bytes, dataStart, compressed);
    found = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: MAX_BYTES });
    if (found.length !== expanded || crc32(found) !== header.readUInt32LE(16))
      throw new Error("Invalid ZIP content");
  }
  if (cursor !== end || found === undefined) throw new Error("Missing conversations ZIP entry");
  return decode(found);
}

/** Read at most 16 MiB from a regular, non-symlink file, including if it grows during the read.
 * ZIP archives are decoded in memory only when explicitly allowed by the ChatGPT command.
 */
export async function readExportJson(
  path: string,
  allowZip: boolean,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Unsafe export file");
    // Read one sentinel byte beyond the cap rather than trusting a racy stat or an unbounded readFile.
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let used = 0;
    for (;;) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(bytes, used, bytes.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
      if (used > MAX_BYTES) throw new Error("Export grew beyond limit");
    }
    signal.throwIfAborted();
    const data = bytes.subarray(0, used);
    return allowZip && path.toLowerCase().endsWith(".zip") ? chatgptZipJson(data) : decode(data);
  } finally {
    await file.close();
  }
}
