// AUTHORED-BY Codex GPT-6.1-Sol
import { MAX_RAW_BYTES, SYSTEM_LABELS } from "../gmail/adapter.js";
import type { MailFolder } from "../mail/writer.js";
import type { EntrySink } from "./zip-reader.js";

/** Byte-oriented mboxrd splitter. Only a five-byte line prefix is retained while
 * discarding an oversized message, including an arbitrarily long body line. */
export function mboxSink(
  message: (raw: Uint8Array) => Promise<void>,
  skip: () => void,
  cap = MAX_RAW_BYTES,
): EntrySink {
  let parts: Uint8Array[] = [];
  let block = new Uint8Array(Math.min(8192, cap));
  let used = 0;
  let size = 0;
  let prefix: number[] = [];
  let arrows = 0;
  let atStart = true;
  let separator = false;
  let oversized = false;
  let started = false;
  const exceed = () => {
    parts = [];
    block = new Uint8Array();
    used = 0;
    oversized = true;
    skip();
  };
  const append = (byte: number) => {
    if (oversized) return;
    if (size >= cap) {
      exceed();
      return;
    }
    if (used === block.length) {
      parts.push(block);
      block = new Uint8Array(Math.min(8192, cap - size));
      used = 0;
    }
    block[used++] = byte;
    size++;
  };
  const appendSlice = (bytes: Uint8Array) => {
    if (oversized) return;
    if (bytes.length > cap - size) {
      exceed();
      return;
    }
    let offset = 0;
    while (offset < bytes.length) {
      if (used === block.length) {
        parts.push(block);
        block = new Uint8Array(Math.min(8192, cap - size));
        used = 0;
      }
      const length = Math.min(block.length - used, bytes.length - offset);
      block.set(bytes.subarray(offset, offset + length), used);
      used += length;
      size += length;
      offset += length;
    }
  };
  const flushPrefix = (unquote: boolean) => {
    if (!oversized) for (let i = unquote ? 1 : 0; i < arrows; i++) append(62);
    for (const byte of prefix) append(byte);
    arrows = 0;
    prefix = [];
  };
  const finish = async () => {
    if (started && !oversized && size) {
      const raw = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        raw.set(part, offset);
        offset += part.length;
      }
      raw.set(block.subarray(0, used), offset);
      parts = [];
      block = new Uint8Array();
      await message(raw);
    }
    parts = [];
    block = new Uint8Array(Math.min(8192, cap));
    used = 0;
    size = 0;
    oversized = false;
    started = true;
  };
  return {
    async push(bytes, final) {
      for (let index = 0; index < bytes.length; index++) {
        const byte = bytes[index] as number;
        if (separator) {
          const newline = bytes.indexOf(10, index);
          if (newline < 0) break;
          index = newline;
          separator = false;
          atStart = true;
          continue;
        }
        if (atStart) {
          if (byte === 62 && !prefix.length) {
            arrows++;
            if (arrows > cap && !oversized) exceed();
            continue;
          }
          prefix.push(byte);
          const text = String.fromCharCode(...prefix);
          if ("From ".startsWith(text)) {
            if (text !== "From ") continue;
            if (!arrows) {
              await finish();
              prefix = [];
              separator = true;
              continue;
            }
            started = true;
            flushPrefix(true);
            atStart = false;
            continue;
          }
          started = true;
          flushPrefix(false);
          atStart = byte === 10;
        } else {
          const newline = bytes.indexOf(10, index);
          const end = newline < 0 ? bytes.length : newline + 1;
          appendSlice(bytes.subarray(index, end));
          index = end - 1;
          atStart = newline >= 0;
        }
      }
      if (final) {
        if (prefix.length || arrows) started = true;
        flushPrefix(false);
        await finish();
      }
    },
  };
}

export function mailHeaders(raw: Uint8Array): Map<string, string> {
  // Header parsing is bounded separately from the raw-message cap.
  const text = new TextDecoder().decode(raw.subarray(0, 64 * 1024));
  const head = text.split(/\r?\n\r?\n/, 1)[0] as string;
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const key = line.slice(0, colon).toLowerCase();
      if (!headers.has(key)) headers.set(key, line.slice(colon + 1).trim());
    }
  }
  return headers;
}

/** Quoted Gmail label names may contain commas and doubled quotes. */
export function mailLabels(value: string): { folders: MailFolder[]; read: boolean; spam: boolean } {
  const labels: string[] = [];
  let label = "";
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"') {
      if (quoted && value[i + 1] === '"') {
        label += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      labels.push(label.trim());
      label = "";
    } else label += c;
  }
  labels.push(label.trim());
  const ids = labels.map((label) =>
    label.toUpperCase() === "DRAFTS" ? "DRAFT" : label.toUpperCase(),
  );
  const folders: MailFolder[] = [];
  for (const [i, id] of ids.entries()) {
    const system = SYSTEM_LABELS[id];
    if (system) folders.push({ key: system, title: system });
    else if (!/^(?:|SPAM|UNREAD|READ|OPENED|IMPORTANT|ARCHIVED|CATEGORY(?:[ _].*)?)$/.test(id)) {
      const name = labels[i] as string;
      if (name !== "." && name !== "..") folders.push({ key: name, title: name });
    }
  }
  if (!ids.some((id) => ["INBOX", "SENT", "DRAFT", "TRASH"].includes(id)))
    folders.push({ key: "Archive", title: "Archive" });
  return { folders, read: !ids.includes("UNREAD"), spam: ids.includes("SPAM") };
}

export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
