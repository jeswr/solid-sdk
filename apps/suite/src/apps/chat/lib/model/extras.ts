// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, isWithinPodScope } from "@jeswr/guarded-fetch";
import { buildTask } from "@jeswr/solid-task-model/task";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { createConcurrentMapper } from "../../../../lib/parallel";
import { ensureContainer, loadChat, loadMemberChat, type MemberReadOptions, saveChat } from "./io";
import { readRoomLayout } from "./layout";
import type { ChatMessage } from "./messages";
import { roomContainer, roomIndex } from "./paths";
import { ChatNode, NS, readText } from "./rdf";
import { httpIri, isoDate, text } from "./validation";

export async function loadProfileName(
  fetch: typeof globalThis.fetch,
  publicFetch: typeof globalThis.fetch,
  storage: string,
  webId: string,
  fallback?: string,
): Promise<string> {
  const url = new URL(httpIri(webId));
  const local = isWithinPodScope(storage, webId);
  const anonymous: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    for (const name of ["authorization", "dpop", "cookie"]) headers.delete(name);
    return publicFetch(input, { ...init, headers, credentials: "omit" });
  };
  // loadChat refuses all redirects before either transport can follow them.
  const document = await loadChat(
    local ? fetch : anonymous,
    local ? storage : `${url.origin}/`,
    webId,
  );
  return (
    readText(document.dataset, webId, `${NS.FOAF}name`)?.trim() ||
    readText(document.dataset, webId, `${NS.VCARD}fn`)?.trim() ||
    (fallback ?? `${url.host}${url.pathname}${url.hash}`)
  );
}
export async function loadRoomFiles(
  fetch: typeof globalThis.fetch,
  room: string,
  { reader, map = createConcurrentMapper() }: MemberReadOptions,
): Promise<{ files: string[]; dropped: number }> {
  const base = roomContainer(room);
  let layout: Awaited<ReturnType<typeof readRoomLayout>>;
  try {
    [layout] = await map([room], async () =>
      readRoomLayout(room, (await loadChat(fetch, base, roomIndex(room))).dataset),
    );
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
  }
  let pending: { url: string; root: string; owner: string | undefined }[] =
    layout?.memberContainers?.map((member) => ({ ...member, root: member.url })) ?? [
      { url: base, root: base, owner: undefined },
    ];
  const seen = new Set(pending.map(({ url }) => url));
  const files: string[] = [];
  let dropped = 0;
  while (pending.length) {
    const next: typeof pending = [];
    await map(pending, async ({ url, root, owner }) => {
      const loaded = await loadMemberChat(fetch, base, url, owner, reader, false);
      dropped += loaded.dropped;
      for (const resource of new Container(url, loaded.document.dataset, DataFactory).contains) {
        try {
          assertWithinPodScope(root, resource.id);
        } catch {
          continue;
        }
        const path = resource.id.slice(root.length);
        if (
          layout?.memberContainers !== undefined &&
          /^(?:\d{4}\/|\d{4}\/\d{2}\/)$/.test(path) &&
          !seen.has(resource.id)
        ) {
          seen.add(resource.id);
          next.push({ url: resource.id, root, owner });
        } else if (
          !new URL(resource.id).pathname.endsWith("/") &&
          !/\.(ttl|acl)$/.test(new URL(resource.id).pathname)
        )
          files.push(resource.id);
      }
    });
    pending = next;
  }
  return { files: files.sort(), dropped };
}
/** A participant can turn somebody else's message into a personal task without rewriting their day. */
export async function copyMessageTask(
  fetch: typeof globalThis.fetch,
  storage: string,
  actor: string,
  message: ChatMessage,
  task: { title: string; due?: Date },
): Promise<void> {
  const base = roomContainer(storage);
  const url = `${base}tasks/${crypto.randomUUID()}.ttl`;
  const title = text(task.title);
  if (task.due) isoDate(task.due);
  const dataset = buildTask(url, {
    title,
    state: "open",
    creator: actor,
    ...(task.due ? { dueDate: task.due } : {}),
  });
  new ChatNode(`${url}#it`, dataset, DataFactory).setIri(`${NS.DCT}source`, httpIri(message.id));
  await ensureContainer(fetch, base, `${base}tasks/`);
  await saveChat(fetch, base, url, dataset, { ifNoneMatch: "*" });
}
