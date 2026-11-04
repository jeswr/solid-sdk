// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import type { Entry, StorageClient } from "@jeswr/storage-client";
import type { RunningTarget } from "./types.js";

export async function container(target: RunningTarget, name: string): Promise<string> {
  return (await target.storage.create(target.root, null, { name, kind: "container" })).url;
}

export async function text(
  storage: StorageClient,
  parent: string,
  name = "note.txt",
  body = "first draft",
) {
  return storage.create(parent, body, { name, contentType: "text/plain" });
}

export async function etag(storage: StorageClient, url: string): Promise<string> {
  const tag = (await storage.head(url)).etag;
  assert(tag, "Target must supply a validator");
  return tag;
}

export async function entries(storage: StorageClient, parent: string): Promise<Entry[]> {
  const items: Entry[] = [];
  for await (const item of storage.listAll(parent)) items.push(item);
  return items;
}
