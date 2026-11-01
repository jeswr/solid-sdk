// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import type { MessageTask } from "@jeswr/solid-chat-interop";
import type { DatasetCore } from "@rdfjs/types";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { aclLink } from "./links";
import {
  appendMessage,
  editMessage,
  messageResource,
  readMessages,
  type SendInput,
  tombstoneMessage,
  turnIntoTask,
} from "./messages";
import { dayPage, dayUrl, joinedRoomsUrl, roomContainer, roomIndex } from "./paths";
import { NS, serializeChat } from "./rdf";
import {
  buildRoom,
  buildRoomAcl,
  joinRoom,
  type RoomInput,
  readJoinedRooms,
  readRoom,
} from "./rooms";
import { ChatModelError, segment, strongEtag } from "./validation";

export interface ChatDocument {
  url: string;
  dataset: Store;
  etag: string | null;
}
export type WriteCondition = { ifMatch: string } | { ifNoneMatch: "*" };
export class ChatIoError extends Error {
  override name = "ChatIoError";
  constructor(
    readonly status: number,
    readonly etag: string | null,
  ) {
    super(`Chat request failed (${status})`);
  }
}
function checked(response: Response): Response {
  if (!response.ok) throw new ChatIoError(response.status, response.headers.get("etag"));
  return response;
}
function scoped(fetch: typeof globalThis.fetch, base: string) {
  return createPodScopedFetch(base, { fetch: refuseRedirects(fetch), maxRedirects: 0 });
}
function conditions(condition: WriteCondition): Record<string, string> {
  if ("ifMatch" in condition) return { "if-match": strongEtag(condition.ifMatch) };
  if (condition.ifNoneMatch !== "*") throw new ChatModelError("invalid-input");
  return { "if-none-match": "*" };
}
export async function loadChat(
  fetch: typeof globalThis.fetch,
  base: string,
  url: string,
): Promise<ChatDocument> {
  const target = assertWithinPodScope(roomContainer(base), url);
  const result = await fetchRdf(target, { fetch: scoped(fetch, base) });
  return { url: target, dataset: result.dataset, etag: result.etag };
}
export async function saveChat(
  fetch: typeof globalThis.fetch,
  base: string,
  url: string,
  dataset: DatasetCore,
  condition: WriteCondition,
): Promise<string | null> {
  const target = assertWithinPodScope(roomContainer(base), url);
  const headers = { "content-type": "text/turtle", ...conditions(condition) };
  const response = checked(
    await scoped(fetch, base)(target, {
      method: "PUT",
      headers,
      body: await serializeChat(dataset),
    }),
  );
  return response.headers.get("etag");
}
async function optionalChat(
  fetch: typeof globalThis.fetch,
  base: string,
  url: string,
): Promise<ChatDocument> {
  try {
    return await loadChat(fetch, base, url);
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    return { url, dataset: new Store(), etag: null };
  }
}
async function ensureContainer(
  fetch: typeof globalThis.fetch,
  base: string,
  url: string,
): Promise<void> {
  let existing: ChatDocument;
  try {
    existing = await loadChat(fetch, base, url);
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    // PUT on an existing container requires Write even with If-None-Match.
    const response = await scoped(fetch, base)(url, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        "if-none-match": "*",
        link: `<${NS.LDP}BasicContainer>; rel="type"`,
      },
      body: "",
    });
    if (response.status !== 412) {
      checked(response);
      return;
    }
    // A concurrent creator won; validate its resource before using it.
    existing = await loadChat(fetch, base, url);
  }
  if (
    !new Container(url, existing.dataset, DataFactory).type.has(`${NS.LDP}Container`) &&
    !new Container(url, existing.dataset, DataFactory).type.has(`${NS.LDP}BasicContainer`)
  )
    throw new ChatModelError("invalid-input");
}
export async function loadRoom(fetch: typeof globalThis.fetch, room: string) {
  const document = await loadChat(fetch, roomContainer(room), roomIndex(room));
  return { ...document, room: readRoom(room, document.dataset) };
}
export async function loadRooms(fetch: typeof globalThis.fetch, storage: string) {
  const base = `${roomContainer(storage)}chat/`;
  const document = await optionalChat(fetch, base, joinedRoomsUrl(storage));
  return { ...document, rooms: readJoinedRooms(document.url, document.dataset) };
}
export async function saveJoinedRoom(
  fetch: typeof globalThis.fetch,
  storage: string,
  room: string,
): Promise<ChatDocument> {
  roomContainer(room);
  const url = joinedRoomsUrl(storage);
  const current = await optionalCondition(fetch, `${roomContainer(storage)}chat/`, url);
  const joined = joinRoom(url, current.document.dataset, room);
  if (joined.size === current.document.dataset.size) return current.document;
  await ensureContainer(fetch, roomContainer(storage), `${roomContainer(storage)}chat/`);
  const etag = await saveChat(
    fetch,
    `${roomContainer(storage)}chat/`,
    url,
    joined,
    current.condition,
  );
  return { url, dataset: joined, etag };
}
async function optionalCondition(
  fetch: typeof globalThis.fetch,
  base: string,
  url: string,
): Promise<{ document: ChatDocument; condition: WriteCondition }> {
  try {
    const document = await loadChat(fetch, base, url);
    return { document, condition: { ifMatch: strongEtag(document.etag) } };
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    return { document: { url, dataset: new Store(), etag: null }, condition: { ifNoneMatch: "*" } };
  }
}
/** Inserts only the new subject into existing days; never replaces other participants' statements. */
export async function sendMessage(
  fetch: typeof globalThis.fetch,
  room: string,
  input: SendInput,
): Promise<ChatDocument> {
  const base = roomContainer(room);
  // Validate the entire message before any network side effects.
  const delta = appendMessage(new Store(), room, input);
  const url = dayUrl(room, input.at);
  const { document, condition } = await optionalCondition(fetch, base, url);
  const dataset = appendMessage(document.dataset, room, input);
  if ("ifNoneMatch" in condition) {
    const parts = new URL(url).pathname.split("/");
    const year = parts.at(-3);
    const month = parts.at(-2);
    await ensureContainer(fetch, base, `${base}${year}/`);
    await ensureContainer(fetch, base, `${base}${year}/${month}/`);
    return { url, dataset, etag: await saveChat(fetch, base, url, dataset, condition) };
  }
  const response = checked(
    await scoped(fetch, base)(url, {
      method: "PATCH",
      headers: { "content-type": "application/sparql-update", ...conditions(condition) },
      body: `INSERT DATA {\n${await serializeChat(delta, "application/n-triples")}\n}`,
    }),
  );
  return { url, dataset, etag: response.headers.get("etag") };
}
export async function loadMessages(
  fetch: typeof globalThis.fetch,
  room: string,
  before: Date,
  since: Date,
  days: number,
) {
  const page = dayPage(room, before, since, days);
  const documents: ChatDocument[] = [];
  for (const url of page.urls) documents.push(await optionalChat(fetch, roomContainer(room), url));
  const messages = documents.flatMap((doc) => readMessages(doc.dataset));
  messages.sort(
    (a, b) => (a.published ?? "").localeCompare(b.published ?? "") || a.id.localeCompare(b.id),
  );
  return { documents, messages, next: page.next };
}
async function mutate(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  change: (dataset: Store) => Store,
): Promise<ChatDocument> {
  const url = messageResource(room, subject);
  const document = await loadChat(fetch, roomContainer(room), url);
  const condition = { ifMatch: strongEtag(document.etag) };
  const dataset = change(document.dataset);
  return { url, dataset, etag: await saveChat(fetch, room, url, dataset, condition) };
}
export function saveMessageEdit(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  actor: string,
  content: string,
  at: Date,
) {
  return mutate(fetch, room, subject, (dataset) =>
    editMessage(dataset, subject, actor, content, at),
  );
}
export function deleteOwnMessage(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  actor: string,
  at: Date,
) {
  return mutate(fetch, room, subject, (dataset) => tombstoneMessage(dataset, subject, actor, at));
}
export function saveMessageTask(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  actor: string,
  task: MessageTask,
  at: Date,
) {
  return mutate(fetch, room, subject, (dataset) => turnIntoTask(dataset, subject, actor, task, at));
}
/** Creates a new container, its advertised WAC ACL, then its descriptor. Never overwrites a room. */
export async function createRoom(
  fetch: typeof globalThis.fetch,
  storage: string,
  slug: string,
  input: RoomInput,
): Promise<ChatDocument> {
  const base = roomContainer(storage);
  const room = `${base}chat/rooms/${segment(slug)}/`;
  const dataset = buildRoom(room, input);
  await ensureContainer(fetch, base, `${base}chat/`);
  await ensureContainer(fetch, base, `${base}chat/rooms/`);
  const response = checked(
    await scoped(fetch, base)(room, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        "if-none-match": "*",
        link: `<${NS.LDP}BasicContainer>; rel="type"`,
      },
      body: "",
    }),
  );
  let aclRef = aclLink(response.headers.get("link"));
  if (!aclRef) {
    // Solid advertises auxiliary resources on HEAD/GET; PUT may omit Link.
    const discovery = checked(await scoped(fetch, base)(room, { method: "HEAD" }));
    aclRef = aclLink(discovery.headers.get("link"));
  }
  if (!aclRef) throw new ChatModelError("invalid-input");
  const aclUrl = assertWithinPodScope(base, new URL(aclRef, room).href);
  await saveChat(fetch, base, aclUrl, buildRoomAcl(room, aclUrl, input.creator, input.members), {
    ifNoneMatch: "*",
  });
  const url = roomIndex(room);
  const etag = await saveChat(fetch, base, url, dataset, { ifNoneMatch: "*" });
  return { url, dataset, etag };
}
