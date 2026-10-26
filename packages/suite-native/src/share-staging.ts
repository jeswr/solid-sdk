// AUTHORED-BY GPT-5.6 Codex
import { type ShareContent, type SharePlugin, type ShareResult, share } from "./share.js";
import { sanitiseFileName } from "./share-intake.js";

/** Native cache writer. No URLs, credentials or authenticated fetch cross this seam. */
export interface ShareStagingPlugin {
  /** `keep` lists files already staged for the same share, which native code must not evict. */
  begin(options: {
    name: string;
    mimeType: string;
    size: number;
    keep?: string[];
  }): Promise<{ stagingId: string }>;
  writeChunk(options: { stagingId: string; offset: number; data: string }): Promise<void>;
  commit(options: { stagingId: string }): Promise<{ uri: string }>;
  abort(options: { stagingId: string }): Promise<void>;
}

export interface ShareStagingLimits {
  maxFileBytes: number;
  chunkBytes: number;
}

export const DEFAULT_SHARE_STAGING_LIMITS: Readonly<ShareStagingLimits> = Object.freeze({
  maxFileBytes: 100 * 1024 * 1024,
  chunkBytes: 512 * 1024,
});

export interface ShareFile {
  blob: Blob;
  name: string;
  mimeType?: string;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function fileOptions(blob: Blob, options: { name: string; mimeType?: string }, max: number) {
  if (
    !(blob instanceof Blob) ||
    !Number.isSafeInteger(blob.size) ||
    blob.size < 0 ||
    blob.size > max
  ) {
    throw new TypeError("Share file exceeds the size limit or is not a Blob");
  }
  const mimeType = options.mimeType ?? (blob.type || "application/octet-stream");
  if (
    typeof mimeType !== "string" ||
    mimeType.length > 255 ||
    MIME.exec(mimeType)?.[0] !== mimeType
  ) {
    throw new TypeError("Invalid share MIME type");
  }
  return {
    name: sanitiseFileName(options.name),
    mimeType: mimeType.toLowerCase(),
    size: blob.size,
  };
}

/** Sequential bounded Blob slices keep both the byte buffer and base64 bridge message bounded. */
export async function stageFile(
  blob: Blob,
  options: { name: string; mimeType?: string },
  plugin: ShareStagingPlugin,
  limits: Partial<ShareStagingLimits> = {},
): Promise<string> {
  return (await stage(blob, options, plugin, limits, [])).uri;
}

async function stage(
  blob: Blob,
  options: { name: string; mimeType?: string },
  plugin: ShareStagingPlugin,
  limits: Partial<ShareStagingLimits>,
  keep: readonly string[],
): Promise<{ stagingId: string; uri: string }> {
  const { maxFileBytes, chunkBytes } = { ...DEFAULT_SHARE_STAGING_LIMITS, ...limits };
  for (const [value, cap] of [
    [maxFileBytes, DEFAULT_SHARE_STAGING_LIMITS.maxFileBytes],
    [chunkBytes, DEFAULT_SHARE_STAGING_LIMITS.chunkBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > cap) {
      throw new TypeError("Invalid share staging limits");
    }
  }
  const metadata = fileOptions(blob, options, maxFileBytes);
  let stagingId: string | undefined;
  try {
    const begun = await plugin.begin(keep.length > 0 ? { ...metadata, keep: [...keep] } : metadata);
    // A malformed id is never sent back to native code, including in abort().
    if (
      typeof begun?.stagingId !== "string" ||
      begun.stagingId.length !== 36 ||
      !ID.test(begun.stagingId)
    ) {
      throw new TypeError("Invalid share staging id");
    }
    stagingId = begun.stagingId;
    for (let offset = 0; offset < blob.size; offset += chunkBytes) {
      const end = Math.min(offset + chunkBytes, blob.size);
      const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
      if (bytes.length !== end - offset) throw new TypeError("Share Blob size changed");
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await plugin.writeChunk({ stagingId, offset, data: btoa(binary) });
    }
    const committed = await plugin.commit({ stagingId });
    if (typeof committed?.uri !== "string" || !committed.uri.startsWith("file:///")) {
      throw new TypeError("Invalid staged file URI");
    }
    const uri = new URL(committed.uri);
    const path = decodeURIComponent(uri.pathname);
    const segments = path.split("/");
    const name = segments.pop();
    if (
      uri.host ||
      uri.search ||
      uri.hash ||
      !name ||
      sanitiseFileName(name) !== name ||
      !segments.join("/").endsWith(`/share-out/${stagingId}`)
    ) {
      throw new TypeError("Invalid staged file URI");
    }
    return { stagingId, uri: committed.uri };
  } catch (error) {
    if (stagingId !== undefined) await plugin.abort({ stagingId }).catch(() => undefined);
    throw error;
  }
}

/** Share already authenticated downloads. Retention belongs to native code, even after dismissal. */
export async function shareFiles(
  files: readonly ShareFile[],
  content: Omit<ShareContent, "files">,
  targets: { staging: ShareStagingPlugin; native: SharePlugin },
): Promise<ShareResult> {
  if (!Array.isArray(files) || files.length === 0 || files.length > 20) {
    throw new TypeError("Share between 1 and 20 files");
  }
  let total = 0;
  for (const file of files) {
    total += fileOptions(file.blob, file, DEFAULT_SHARE_STAGING_LIMITS.maxFileBytes).size;
  }
  if (total > DEFAULT_SHARE_STAGING_LIMITS.maxFileBytes) {
    throw new TypeError("Shared files exceed the cache size limit");
  }
  // Each file pins the earlier ones, so staging a batch never evicts its own files.
  const staged: { stagingId: string; uri: string }[] = [];
  for (const file of files) {
    const keep = staged.map(({ stagingId }) => stagingId);
    staged.push(await stage(file.blob, file, targets.staging, {}, keep));
  }
  return share({ ...content, files: staged.map(({ uri }) => uri) }, { native: targets.native });
}
