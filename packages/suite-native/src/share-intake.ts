// AUTHORED-BY Claude Opus 5.5
import { InvalidShareError } from "./errors.js";

export interface ShareFileItem {
  kind: "file";
  /** Sanitised display name (no path separators or control characters). */
  name: string;
  mimeType: string;
  /** Declared size in bytes; `readFile` enforces it. */
  size: number;
}
export interface ShareUrlItem {
  kind: "url";
  url: string;
  title?: string;
}
export interface ShareTextItem {
  kind: "text";
  text: string;
}
export type ShareItem = ShareFileItem | ShareUrlItem | ShareTextItem;

/** One share from another app: a validated, plain-data description of what arrived. */
export interface ShareBatch {
  id: string;
  receivedAt: string;
  items: ShareItem[];
}

/** The native `SuiteShareIntake` plugin (Android SEND intents, iOS Share Extension hand-off). */
export interface ShareIntakePlugin {
  /** Batches received while the suite was not listening (cold start or before `onReceived`). */
  getPending(): Promise<{ batches: unknown[] }>;
  /** Reads `length` bytes of item `index` at `offset`, base64-encoded. */
  readChunk(options: {
    batchId: string;
    index: number;
    offset: number;
    length: number;
  }): Promise<{ data: string; eof: boolean }>;
  /** Deletes the batch and its cached files. */
  acknowledge(options: { batchId: string }): Promise<void>;
  addListener(
    event: "shareReceived",
    listener: (batch: unknown) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

export interface ShareLimits {
  maxItems: number;
  maxFileBytes: number;
  /** Sum of file sizes in one batch (native code also bounds total pending bytes). */
  maxBatchBytes: number;
  maxTextChars: number;
  chunkBytes: number;
}

export const DEFAULT_SHARE_LIMITS: Readonly<ShareLimits> = Object.freeze({
  maxItems: 20,
  maxFileBytes: 100 * 1024 * 1024,
  maxBatchBytes: 200 * 1024 * 1024,
  maxTextChars: 100_000,
  chunkBytes: 512 * 1024,
});

const BATCH_ID = /^[A-Za-z0-9-]{1,64}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const UNSAFE_NAME = /[\u0000-\u001f\u007f/\\]/g;

const invalid = (why: string) => new InvalidShareError(`Invalid share: ${why}`);

/** Reduces an untrusted file name to one safe path segment. */
export function sanitiseFileName(raw: unknown): string {
  const cleaned = (typeof raw === "string" ? raw : "")
    .replace(UNSAFE_NAME, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 255);
  return cleaned === "" ? "shared-file" : cleaned;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid(what);
  return value as Record<string, unknown>;
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") throw invalid("url item without a url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid("url item with a malformed url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw invalid("url must be http(s)");
  if (url.username !== "" || url.password !== "") throw invalid("url must not carry credentials");
  return url.href;
}

function item(raw: unknown, limits: ShareLimits): ShareItem {
  const value = record(raw, "item is not an object");
  switch (value.kind) {
    case "file": {
      const { size } = value;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
        throw invalid("file size must be a non-negative integer");
      }
      if (size > limits.maxFileBytes) throw invalid("file is too large");
      const mimeType =
        typeof value.mimeType === "string" && MIME.test(value.mimeType)
          ? value.mimeType.toLowerCase()
          : "application/octet-stream";
      return { kind: "file", name: sanitiseFileName(value.name), mimeType, size };
    }
    case "url": {
      const url = httpUrl(value.url);
      const title = typeof value.title === "string" ? value.title.slice(0, 1000) : undefined;
      return title === undefined ? { kind: "url", url } : { kind: "url", url, title };
    }
    case "text": {
      if (typeof value.text !== "string") throw invalid("text item without text");
      if (value.text.length > limits.maxTextChars) throw invalid("text is too long");
      return { kind: "text", text: value.text };
    }
    default:
      throw invalid("unknown item kind");
  }
}

/** Validates an untrusted batch from native code into a `ShareBatch`, or throws `InvalidShareError`. */
export function validateShareBatch(
  raw: unknown,
  limits: ShareLimits = DEFAULT_SHARE_LIMITS,
): ShareBatch {
  const value = record(raw, "batch is not an object");
  if (typeof value.id !== "string" || !BATCH_ID.test(value.id)) throw invalid("bad batch id");
  if (typeof value.receivedAt !== "string" || Number.isNaN(Date.parse(value.receivedAt))) {
    throw invalid("bad receivedAt");
  }
  if (!Array.isArray(value.items) || value.items.length === 0) throw invalid("no items");
  if (value.items.length > limits.maxItems) throw invalid("too many items");
  const items = value.items.map((entry) => item(entry, limits));
  const bytes = items.reduce((sum, entry) => sum + (entry.kind === "file" ? entry.size : 0), 0);
  if (bytes > limits.maxBatchBytes) throw invalid("batch is too large");
  return { id: value.id, receivedAt: new Date(value.receivedAt).toISOString(), items };
}

function decodeBase64(data: unknown): Uint8Array<ArrayBuffer> {
  if (typeof data !== "string") throw invalid("chunk is not base64");
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw invalid("chunk is not base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface ShareInboxOptions {
  limits?: ShareLimits;
  /** Called for each batch that failed validation; the batch is acknowledged (deleted). */
  onInvalid?: (error: InvalidShareError) => void;
}

export interface ShareInbox {
  /**
   * Validated batches that arrived before anyone was listening and that this inbox has not handed
   * out yet. They stay on the device until acknowledged.
   */
  takePending(): Promise<ShareBatch[]>;
  /**
   * Subscribes to new batches; returns an unsubscribe function. Each batch is handed out once per
   * inbox, by this or by `takePending`, until it is acknowledged.
   */
  onReceived(handler: (batch: ShareBatch) => void): Promise<() => Promise<void>>;
  /** Reads file item `index` of `batch` into a Blob, enforcing the declared size. */
  readFile(batch: ShareBatch, index: number): Promise<Blob>;
  /** Call once the suite has saved (or the person discarded) the batch. */
  acknowledge(batch: ShareBatch): Promise<void>;
}

/** Wraps the native intake plugin with validation, size enforcement and acknowledgement. */
export function createShareInbox(
  plugin: ShareIntakePlugin,
  options: ShareInboxOptions = {},
): ShareInbox {
  const limits = options.limits ?? DEFAULT_SHARE_LIMITS;
  // iOS announces pending batches on every resume, so live events and pending reads overlap.
  const handedOut = new Set<string>();
  const claim = (batch: ShareBatch | undefined): batch is ShareBatch => {
    if (batch === undefined || handedOut.has(batch.id)) return false;
    handedOut.add(batch.id);
    return true;
  };
  const accept = async (raw: unknown): Promise<ShareBatch | undefined> => {
    try {
      return validateShareBatch(raw, limits);
    } catch (error) {
      options.onInvalid?.(error as InvalidShareError);
      const id = (raw as { id?: unknown } | null)?.id;
      if (typeof id === "string" && BATCH_ID.test(id)) {
        await plugin.acknowledge({ batchId: id }).catch(() => undefined);
      }
      return undefined;
    }
  };

  return {
    async takePending() {
      const { batches } = await plugin.getPending();
      if (!Array.isArray(batches)) return [];
      const accepted = await Promise.all(batches.map(accept));
      return accepted.filter(claim);
    },

    async onReceived(handler) {
      const listener = await plugin.addListener("shareReceived", (raw) => {
        void accept(raw).then((batch) => {
          if (claim(batch)) handler(batch);
        });
      });
      return () => listener.remove();
    },

    async readFile(batch, index) {
      const entry = batch.items[index];
      if (entry?.kind !== "file") throw new TypeError("Item is not a file");
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let offset = 0;
      for (;;) {
        const length = Math.min(limits.chunkBytes, entry.size - offset);
        const chunk = await plugin.readChunk({ batchId: batch.id, index, offset, length });
        const bytes = decodeBase64(chunk?.data);
        // A zero-length request probes for end of file once the declared size has been read.
        const longer = length === 0 ? "file longer than declared" : undefined;
        if (bytes.length > length) throw invalid(longer ?? "chunk longer than requested");
        offset += bytes.length;
        parts.push(bytes);
        if (chunk.eof === true) break;
        if (bytes.length === 0) throw invalid(longer ?? "empty chunk before end of file");
      }
      if (offset !== entry.size) throw invalid("file size does not match");
      return new Blob(parts, { type: entry.mimeType });
    },

    async acknowledge(batch) {
      await plugin.acknowledge({ batchId: batch.id });
      handedOut.delete(batch.id);
    },
  };
}
