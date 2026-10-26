// AUTHORED-BY Codex
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { LiteralFrom, NamedNodeFrom, OptionalAs } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import type { PodSession } from "@/lib/session/pod-session";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
} from "../../drive/lib/client/client";
import {
  DocumentDoc,
  docContainerUrls,
  isDirectChild,
  PROV,
  ResourceWriteError,
  readRdf,
  writeRdf,
} from "../lib/model";

/** Drive's existing trash vocabulary, with the companion tree beside the .ttl. */
class TrashRecord extends DocumentDoc {
  markTrashed(webId: string) {
    this.types.add(PROV.Entity);
    OptionalAs.object(
      this,
      "http://www.w3.org/ns/prov#invalidatedAtTime",
      new Date(),
      LiteralFrom.dateTime,
    );
    OptionalAs.object(this, PROV.wasAttributedTo, webId, NamedNodeFrom.string);
  }
}
function clientFor(session: PodSession) {
  return createSolidDriveClient({
    storageUrl: session.storageUrl,
    fetch: createPodScopedFetch(session.storageUrl, { fetch: session.fetch }),
  });
}
function trashRoot(session: PodSession) {
  return new URL("drive/.trash/", session.storageUrl).href;
}
function assertDocument(url: string, session: PodSession) {
  if (!isDirectChild(url, new URL("docs/", session.storageUrl).href))
    throw new Error("Expected a document in Docs");
  return docContainerUrls(url);
}
function assertTrash(url: string, session: PodSession) {
  const parent = new URL(".", url).href;
  if (!isDirectChild(parent.slice(0, -1), trashRoot(session)) || !isDirectChild(url, parent))
    throw new Error("Expected a document in Trash");
  return docContainerUrls(url);
}
async function ensureFolder(client: DriveClient, url: string) {
  try {
    await client.createFolder(url);
  } catch (error) {
    if (!(error instanceof DriveError && error.kind === "conflict")) throw error;
  }
}
/** Validate advertised children before recursion, even when they are on the same pod. */
async function children(client: DriveClient, url: string) {
  const items = await client.list(url);
  for (const item of items) {
    if (!isDirectChild(item.kind === "folder" ? item.url.slice(0, -1) : item.url, url))
      throw new Error("Invalid document tree child");
  }
  return items;
}
async function copyTree(client: DriveClient, from: string, to: string) {
  const items = await children(client, from);
  await client.createFolder(to);
  for (const item of items) {
    const target = `${to}${item.url.slice(from.length)}`;
    if (item.kind === "folder") await copyTree(client, item.url, target);
    else await client.copy(item.url, target);
  }
}
async function removeTree(client: DriveClient, url: string) {
  for (const item of await children(client, url)) {
    if (item.kind === "folder") await removeTree(client, item.url);
    else await client.remove(item.url);
  }
  await client.remove(url);
}
async function hasTree(client: DriveClient, url: string) {
  try {
    await client.stat(url);
    return true;
  } catch (error) {
    if (error instanceof DriveError && error.kind === "not-found") return false;
    throw error;
  }
}
async function updateIndex(session: PodSession, mutate: (dataset: Store) => void) {
  const url = `${trashRoot(session)}index.ttl`;
  const fetchImpl = createPodScopedFetch(session.storageUrl, { fetch: session.fetch });
  for (let attempt = 0; ; attempt++) {
    let dataset: Store;
    let etag: string | null = null;
    try {
      const read = await readRdf(url, fetchImpl);
      dataset = new Store([...read.dataset]);
      etag = read.etag;
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      dataset = new Store();
    }
    mutate(dataset);
    try {
      await writeRdf(url, dataset, { fetchImpl, ...(etag ? { etag } : { createOnly: true }) });
      return;
    } catch (error) {
      if (!(error instanceof ResourceWriteError && error.status === 412) || attempt > 0)
        throw error;
    }
  }
}
function removeRecord(dataset: Store, url: string) {
  for (const quad of dataset.match(DataFactory.namedNode(url))) dataset.delete(quad);
}
/** Move to Drive's app-managed trash. Original bytes and all revisions remain restorable. */
export async function deleteDocument(url: string, session: PodSession): Promise<string> {
  const layout = assertDocument(url, session);
  const client = clientFor(session);
  const root = trashRoot(session);
  const folder = `${root}${crypto.randomUUID()}/`;
  const target = `${folder}${new URL(url).pathname.split("/").at(-1)}`;
  const trashed = docContainerUrls(target);
  await ensureFolder(client, new URL("drive/", session.storageUrl).href);
  await ensureFolder(client, root);
  await client.createFolder(folder);
  // Copy everything before removing anything. A failed move always leaves a durable copy.
  const companion = await hasTree(client, layout.container);
  await client.copy(url, target);
  if (companion) await copyTree(client, layout.container, trashed.container);
  await updateIndex(session, (dataset) => {
    const record = new TrashRecord(target, dataset, DataFactory);
    record.markTrashed(session.webId);
    record.wasDerivedFrom = url;
    record.title = new URL(url).pathname.split("/").at(-1);
    record.format = "text/turtle";
  });
  if (companion) await removeTree(client, layout.container);
  await client.remove(url);
  return target;
}
export async function restoreDocument(url: string, session: PodSession): Promise<string> {
  const trashed = assertTrash(url, session);
  const client = clientFor(session);
  const { dataset } = await readRdf(
    `${trashRoot(session)}index.ttl`,
    createPodScopedFetch(session.storageUrl, { fetch: session.fetch }),
  );
  const original = new TrashRecord(url, dataset, DataFactory).wasDerivedFrom;
  if (!original) throw new Error("Missing original document location");
  const layout = assertDocument(original, session);
  const companion = await hasTree(client, trashed.container);
  // Create-only copies refuse to overwrite a document created at the original location.
  if ((await hasTree(client, original)) || (await hasTree(client, layout.container)))
    throw new Error("The original document location is occupied");
  await ensureFolder(client, new URL("docs/", session.storageUrl).href);
  if (companion) await copyTree(client, trashed.container, layout.container);
  await client.copy(url, original);
  if (companion) await removeTree(client, trashed.container);
  await client.remove(url);
  await updateIndex(session, (index) => removeRecord(index, url));
  await client.remove(new URL(".", url).href);
  return original;
}
/** Only Trash can permanently delete a document, after an explicit confirmation. */
export async function deleteForever(
  url: string,
  session: PodSession,
  confirmed: boolean,
): Promise<void> {
  assertTrash(url, session);
  if (!confirmed) throw new Error("Confirm Delete forever first");
  await removeTree(clientFor(session), new URL(".", url).href);
  await updateIndex(session, (dataset) => removeRecord(dataset, url));
}
