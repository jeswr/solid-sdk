// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { readContainerMembers } from "@jeswr/ldp-container";
import { z } from "zod";
import { validateCommentSnapshot } from "../comments/anchors";
import { WorkbookConflictError } from "../contract";
import { deserializeSnapshot, type Snapshot, serializeSnapshot } from "../model/snapshot";

const metadataSchema = z.object({
  created: z.iso.datetime(),
  author: z.string().optional(),
  name: z.string().trim().min(1).max(200).optional(),
});
type Metadata = z.infer<typeof metadataSchema>;
export interface SheetVersion extends Metadata {
  readonly url: string;
  readonly etag: string | null;
}
export interface VersionHistory {
  list(): Promise<SheetVersion[]>;
  load(url: string): Promise<Snapshot>;
  name(version: SheetVersion, name: string): Promise<void>;
  capture(name: string): Promise<void>;
}

/** Workbook-specific JSON history; transport and LDP parsing come from the SDK. */
export function createVersionHistory(options: {
  fetch: typeof globalThis.fetch;
  container: string;
  author?: string;
  now?: () => Date;
  readOnly?: boolean;
}) {
  const container = new URL(options.container).href;
  if (!container.endsWith("/")) throw new TypeError("Expected a workbook container");
  const root = new URL("versions/", container).href;
  const http = createPodScopedFetch(container, { fetch: refuseRedirects(options.fetch) });
  const now = options.now ?? (() => new Date());
  let lastSaved: number | undefined;
  let pending: { etag: string | null; time: number } | undefined;

  function metadataUrl(url: string) {
    // Only our direct, canonical JSON sidecars can designate a snapshot.
    if (!url.startsWith(root) || !/^[\w-]+\.meta\.json$/.test(url.slice(root.length)))
      throw new TypeError("Invalid spreadsheet version URL");
    return url;
  }
  function writable() {
    if (options.readOnly) throw new Error("View-only spreadsheets cannot change versions");
  }
  function validator(etag: string | null): string {
    if (etag === null || !/^"[^"\r\n]*"$/.test(etag))
      throw new Error("Version resource has no strong ETag");
    return etag;
  }
  async function request(url: string, init?: RequestInit) {
    const response = await http(url, { cache: "no-store", ...init });
    if (!response.ok)
      throw Object.assign(new Error(`Version request failed (${response.status})`), {
        status: response.status,
      });
    return response;
  }
  async function readMetadata(url: string): Promise<SheetVersion> {
    const response = await request(metadataUrl(url));
    return {
      ...metadataSchema.parse(await response.json()),
      url,
      etag: response.headers.get("etag"),
    };
  }
  async function list(): Promise<SheetVersion[]> {
    const members = await readContainerMembers(http, root, { scope: container });
    const versions: SheetVersion[] = [];
    for (const member of members ?? []) {
      try {
        versions.push(await readMetadata(member.url));
      } catch {
        // Malformed, foreign, vanished and unreadable entries do not hide valid versions.
      }
    }
    return versions.sort(
      (a, b) => Date.parse(b.created) - Date.parse(a.created) || b.url.localeCompare(a.url),
    );
  }
  async function decode(body: string): Promise<Snapshot> {
    let value: Snapshot = JSON.parse(body);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return deserializeSnapshot(body);
    value = validateCommentSnapshot(value);
    if (value.charts !== undefined)
      value = (await import("../charts/spec")).validateChartSnapshot(value);
    serializeSnapshot(value);
    return value;
  }
  async function capture(name?: string, expected?: string) {
    writable();
    const response = await request(new URL("workbook.json", container).href);
    const etag = response.headers.get("etag");
    if (expected !== undefined && etag !== expected) throw new WorkbookConflictError(container);
    const body = await response.text();
    await decode(body);
    const time = now().getTime();
    const stem = `${time}-${crypto.randomUUID()}`;
    const url = `${root}${stem}.meta.json`;
    const metadata: Metadata = metadataSchema.parse({
      created: new Date(time).toISOString(),
      author: options.author,
      name,
    });
    // PUT below versions/ creates its parent on Solid pods, inheriting workbook acl:default.
    // Publish metadata last: an interrupted upload never advertises an incomplete snapshot.
    const headers = { "Content-Type": "application/json", "If-None-Match": "*" };
    await request(`${root}${stem}.json`, { method: "PUT", headers, body });
    await request(url, { method: "PUT", headers, body: JSON.stringify(metadata) });
    return { etag, time };
  }
  async function prune() {
    const automatic = (await list()).filter((version) => version.name === undefined);
    for (const version of automatic.slice(50)) {
      try {
        const url = version.url.replace(".meta.json", ".json");
        const snapshot = await request(url, { method: "HEAD" });
        const etag = validator(snapshot.headers.get("etag"));
        // Claim the sidecar first. A concurrent name changes its ETag and prevents pruning.
        await request(version.url, {
          method: "DELETE",
          headers: { "If-Match": validator(version.etag) },
        });
        await request(url, { method: "DELETE", headers: { "If-Match": etag } });
      } catch {
        // Missing validators, permission failures and concurrent writes leave data intact.
      }
    }
  }
  return {
    list,
    async load(url: string) {
      const response = await request(metadataUrl(url).replace(".meta.json", ".json"));
      return decode(await response.text());
    },
    async name(version: SheetVersion, name: string) {
      writable();
      const { url, etag } = version;
      metadataUrl(url);
      const current = await readMetadata(url);
      if (current.etag !== etag) throw new Error("This version changed. Refresh version history.");
      const metadata = metadataSchema.parse({ ...current, name });
      await request(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": validator(etag) },
        body: JSON.stringify(metadata),
      });
    },
    async capture(name: string) {
      await capture(name);
    },
    /** Capture the stored baseline before overwriting it, and acknowledge only accepted saves. */
    async beforeSave(etag: string, always = false) {
      const time = now().getTime();
      if (always || lastSaved === undefined || time - lastSaved >= 30 * 60 * 1000) {
        try {
          if (always || pending?.etag !== etag) pending = await capture(undefined, etag);
        } catch (error) {
          pending = undefined;
          if (always || error instanceof WorkbookConflictError) throw error;
          // Automatic history is best effort. Leave it due so the next save retries.
        }
      }
      return () => {
        if (!pending) return false;
        lastSaved = pending.time;
        pending = undefined;
        return true;
      };
    },
    prune,
  };
}
