// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { SolidUpdateStore } from "@jeswr/y-solid";
import { mergeUpdates } from "yjs";
import { mapConcurrent } from "../../../lib/parallel";
import { type DriveClient, DriveError } from "../../drive/lib/client/client";
import { assertUpdateIdentities } from "../lib/model/update-store";

/**
 * Fold immutable Yjs updates before Drive has to copy and verify each one.
 * Preserve pending CRDT structs with mergeUpdates (rather than re-encoding a Doc).
 * A verified, durable merged update precedes every conditional source deletion.
 * Concurrent appends are outside this snapshot and remain in the log.
 */
export async function compactDocumentLog(
  client: DriveClient,
  container: string,
  http: typeof fetch,
): Promise<void> {
  const children = await client.list(container).catch((error: unknown) => {
    if (error instanceof DriveError && error.kind === "not-found") return [];
    throw error;
  });
  if (children.length < 2 || children.some((child) => child.kind !== "file")) return;
  const versions = new Map<string, string>();
  const store = new SolidUpdateStore({
    container,
    fetch: async (input, init) => {
      const response = await http(input, init);
      if (response.ok) {
        const etag = response.headers.get("etag");
        if (!etag || etag.startsWith("W/"))
          throw new DriveError("missing-validator", 409, String(input));
        versions.set(String(input), etag);
      }
      return response;
    },
  });
  const stored = await mapConcurrent(
    children,
    async ({ url }) => {
      const update = await store.readUpdate(url);
      if (!update) throw new DriveError("not-found", 404, url);
      return { url, etag: versions.get(url) as string, update };
    },
    64,
  );
  let merged: Uint8Array;
  try {
    assertUpdateIdentities(stored.map(({ update }) => update));
    merged = mergeUpdates(stored.map(({ update }) => update));
  } catch {
    // Unrecognised/corrupt resources must still be recoverable through Drive.
    return;
  }
  const destination = `${container}${Date.now()}-${crypto.randomUUID()}`;
  const { etag } = await client.write(
    destination,
    new Blob([new Uint8Array(merged)]),
    {
      contentType: "application/octet-stream",
      ifNoneMatch: "*",
    },
    { kind: "protect-ancestors" },
  );
  if (!etag || etag.startsWith("W/")) throw new DriveError("missing-validator", 409, destination);
  const copy = await store.readUpdate(destination);
  if (
    !copy ||
    copy.length !== merged.length ||
    !copy.every((byte, index) => byte === merged[index])
  )
    throw new DriveError("conflict", 409, destination);
  await mapConcurrent(
    stored,
    async (source) => {
      const verified = await http(destination, { method: "HEAD", headers: { "if-match": etag } });
      if (!verified.ok || verified.headers.get("etag") !== etag)
        throw new DriveError("conflict", 412, destination);
      const removed = await http(source.url, {
        method: "DELETE",
        headers: { "if-match": source.etag },
      });
      if (!removed.ok) throw new DriveError("conflict", removed.status, source.url);
    },
    64,
  );
}
