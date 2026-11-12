// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { assertWithinPodScope, isWithinPodScope } from "@jeswr/guarded-fetch";
import { buildTask } from "@jeswr/solid-task-model/task";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { ensureContainer, loadChat, saveChat } from "./io";
import type { ChatMessage } from "./messages";
import { roomContainer } from "./paths";
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
): Promise<string[]> {
  const base = roomContainer(room);
  const document = await loadChat(fetch, base, base);
  return [...new Container(base, document.dataset, DataFactory).contains]
    .map((resource) => resource.id)
    .filter((url) => {
      try {
        assertWithinPodScope(base, url);
      } catch {
        return false;
      }
      return (
        !new URL(url).pathname.endsWith("/") &&
        !new URL(url).pathname.endsWith(".ttl") &&
        !new URL(url).pathname.endsWith(".acl")
      );
    });
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
