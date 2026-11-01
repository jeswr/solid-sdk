// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import type { PodSession } from "@/lib/session/pod-session";
import { createSolidDriveClient, DriveError } from "../../drive/lib/client/client";
import {
  deleteForever as driveDeleteForever,
  restoreItems,
  trashItems,
} from "../../drive/lib/operations/operations";
import type { TrashEntry } from "../../drive/lib/operations/trash-index";
import { docContainerUrls, isDirectChild } from "../lib/model";
import { compactDocumentLog } from "./compact";

function clientFor(session: PodSession) {
  return createSolidDriveClient({
    storageUrl: session.storageUrl,
    webId: session.webId,
    fetch: createPodScopedFetch(session.storageUrl, { fetch: session.fetch }),
  });
}
function driveRoot(session: PodSession) {
  return new URL("drive/", session.storageUrl).href;
}
function assertDocument(url: string, session: PodSession) {
  if (!isDirectChild(url, new URL("docs/", session.storageUrl).href))
    throw new Error("Expected a document in Docs");
  return docContainerUrls(url);
}
function assertRecords(entries: readonly TrashEntry[], session: PodSession) {
  for (const entry of entries) {
    const url = entry.original.endsWith("/")
      ? `${entry.original.slice(0, -1)}.ttl`
      : entry.original;
    assertDocument(url, session);
  }
}
/** One Drive batch durably records both intents before removing either source. */
export async function deleteDocument(url: string, session: PodSession) {
  const layout = assertDocument(url, session);
  const client = clientFor(session);
  const [document, companion] = await Promise.all([
    client.stat(url),
    client.stat(layout.container).catch((error: unknown) => {
      if (error instanceof DriveError && error.kind === "not-found") return undefined;
      throw error;
    }),
  ]);
  const items = companion ? [document, companion] : [document];
  if (items.length > 1)
    await compactDocumentLog(
      client,
      layout.updateLog,
      createPodScopedFetch(session.storageUrl, { fetch: session.fetch }),
    );
  return trashItems(client, driveRoot(session), items, { webId: session.webId, now: new Date() });
}
/** Undo uses the exact Drive records returned by the delete batch. */
export async function restoreDocument(entries: readonly TrashEntry[], session: PodSession) {
  assertRecords(entries, session);
  return restoreItems(clientFor(session), driveRoot(session), entries);
}
/** Only Trash can permanently delete a document, after an explicit confirmation. */
export async function deleteForever(
  entries: readonly TrashEntry[],
  session: PodSession,
  confirmed: boolean,
) {
  if (!confirmed) throw new Error("Confirm Delete forever first");
  assertRecords(entries, session);
  return driveDeleteForever(clientFor(session), driveRoot(session), entries);
}
