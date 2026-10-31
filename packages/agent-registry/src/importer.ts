// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { constants } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { open } from "fs/promises";
import { inventorySettings, MAX_REGISTRY_BYTES, parseRegistryYaml } from "./inventory.js";
import type { Settings } from "./model.js";
import type { RegistryReader, SaltProvider, StorageClient } from "./ports.js";
import { accountDataset, accountTurtle } from "./rdf.js";

/** Explicit local registry input, pod storage root, and owner; no default paths or network transport. */
export interface ImportConfig {
  registryPath: string;
  storageRoot: string;
  ownerWebId: string;
}
/** Import outcome is safe for a pod/UI: it contains no source path, raw handles, or private notes. */
export interface ImportReport {
  imported: number;
  updated: number;
  unchanged: number;
  settings: Settings;
}
/** Bounded local file reader; no symlink following and no provider/credential resolution. */
export class FileRegistryReader implements RegistryReader {
  async read(path: string, maxBytes: number): Promise<string> {
    // The caller chooses the path; never infer a home directory or real registry location.
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) throw new Error("Registry must be a regular file");
      const buffer = new Uint8Array(maxBytes + 1);
      let offset = 0;
      while (offset < buffer.byteLength) {
        const { bytesRead } = await file.read(buffer, offset, buffer.byteLength - offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > maxBytes) throw new Error("Registry exceeds byte limit");
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } finally {
      await file.close();
    }
  }
}
function httpUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /[\s<>"{}|^`\\]/.test(value))
      throw new Error();
    return url;
  } catch {
    throw new Error("Invalid import URL configuration");
  }
}
/**
 * Import the configured registry with ACL-before-content ordering and conditional replacement.
 * Setup evidence cannot grant rights. Changed inventory resets restrictions to deny all.
 * A failed/absent salt, malformed registry, read error or ACL failure aborts without a content write.
 */
export async function importRegistry(
  config: ImportConfig,
  ports: { reader: RegistryReader; salt: SaltProvider; storage: StorageClient },
): Promise<ImportReport> {
  const base = httpUrl(config.storageRoot);
  httpUrl(config.ownerWebId);
  if (
    base.search ||
    base.hash ||
    !base.pathname.endsWith("/") ||
    /%/.test(config.storageRoot) ||
    !config.registryPath?.trim()
  )
    throw new Error("Invalid import configuration");
  let text: string;
  try {
    text = await ports.reader.read(config.registryPath, MAX_REGISTRY_BYTES);
  } catch {
    throw new Error("Registry read failed");
  }
  const snapshot = parseRegistryYaml(text);
  let salt: Uint8Array;
  try {
    salt = await ports.salt.getSalt();
  } catch {
    throw new Error("Daemon salt unavailable");
  }
  // Construct every graph before touching storage; any private-reference failure aborts the batch.
  const settings = inventorySettings(snapshot, salt);
  const container = new URL("agent/accounts/", base).href;
  const resources = await Promise.all(
    settings.connections.map(async (account) => {
      const url = `${container}${account.id}.ttl`;
      const dataset = accountDataset(account, url);
      return { url, dataset, body: await accountTurtle(dataset) };
    }),
  );
  const report: ImportReport = { imported: 0, updated: 0, unchanged: 0, settings };
  const acl = {
    owner: config.ownerWebId,
    public: false,
    modes: ["Read", "Write", "Control"],
  } as const;
  try {
    await ports.storage.setAcl(container, acl);
    for (const resource of resources) {
      const existing = await ports.storage.read(resource.url);
      await ports.storage.setAcl(resource.url, acl);
      if (existing?.body === resource.body) {
        report.unchanged++;
        continue;
      }
      if (existing && !existing.etag) throw new Error("Missing conditional-write evidence");
      await ports.storage.writeRdf(
        resource.url,
        resource.dataset,
        existing ? { ifMatch: existing.etag } : { ifNoneMatch: "*" },
      );
      if (existing) report.updated++;
      else report.imported++;
    }
  } catch {
    throw new Error("Registry storage operation failed");
  }
  return report;
}
