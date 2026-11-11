// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import type { MessageTask } from "@jeswr/solid-chat-interop";
import type { DatasetCore } from "@rdfjs/types";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import {
  buildRoomV2,
  memberContainer,
  memberDocument,
  ownContainer,
  readRoomLayout,
} from "./layout";
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
import { ChatNode, NS, serializeChat } from "./rdf";
import { appendReaction, appendUndo, type ReactionInput, type UndoInput } from "./reactions";
import {
  buildRoomAcl,
  type ChatRoom,
  joinRoom,
  leaveRoom,
  type RoomInput,
  readJoinedRooms,
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
export async function ensureContainer(
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
  return { ...document, room: await readRoomLayout(room, document.dataset) };
}
async function roomLayout(
  fetch: typeof globalThis.fetch,
  room: string,
): Promise<ChatRoom | undefined> {
  const document = await optionalChat(fetch, room, roomIndex(room));
  return readRoomLayout(room, document.dataset);
}
async function ensureDayParents(fetch: typeof globalThis.fetch, base: string, url: string) {
  const month = new URL("./", url).href;
  await ensureContainer(fetch, base, new URL("../", month).href);
  await ensureContainer(fetch, base, month);
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
export async function removeJoinedRoom(
  fetch: typeof globalThis.fetch,
  storage: string,
  room: string,
): Promise<void> {
  const base = `${roomContainer(storage)}chat/`;
  const url = joinedRoomsUrl(storage);
  const current = await optionalCondition(fetch, base, url);
  const dataset = leaveRoom(url, current.document.dataset, room);
  if (dataset.size === current.document.dataset.size) return;
  await saveChat(fetch, base, url, dataset, current.condition);
}
/** Inserts only the new subject into existing days; never replaces other participants' statements. */
export async function sendMessage(
  fetch: typeof globalThis.fetch,
  room: string,
  input: SendInput,
): Promise<ChatDocument> {
  const base = roomContainer(room);
  // Validate the entire message before any network side effects.
  appendMessage(new Store(), room, input);
  const container = ownContainer(room, await roomLayout(fetch, room), input.author);
  const delta = appendMessage(new Store(), room, input, container);
  const url = dayUrl(container, input.at);
  const { document, condition } = await optionalCondition(fetch, base, url);
  const dataset = appendMessage(document.dataset, room, input, container);
  if ("ifNoneMatch" in condition) {
    await ensureDayParents(fetch, base, url);
    return { url, dataset, etag: await saveChat(fetch, base, url, dataset, condition) };
  }
  const etag = await insertData(fetch, base, url, delta, condition);
  return { url, dataset, etag };
}
/**
 * The one append-only write: PATCH INSERT DATA of `delta` under a strong If-Match.
 * Moving this onto StorageClient.patch is bead sst-c4xg.
 */
async function insertData(
  fetch: typeof globalThis.fetch,
  base: string,
  url: string,
  delta: Store,
  condition: { ifMatch: string },
): Promise<string | null> {
  const response = checked(
    await scoped(fetch, base)(url, {
      method: "PATCH",
      headers: { "content-type": "application/sparql-update", ...conditions(condition) },
      body: `INSERT DATA {\n${await serializeChat(delta, "application/n-triples")}\n}`,
    }),
  );
  return response.headers.get("etag");
}
export async function loadMessages(
  fetch: typeof globalThis.fetch,
  room: string,
  before: Date,
  since: Date,
  days: number,
) {
  const page = dayPage(room, before, since, days);
  const layout = await roomLayout(fetch, room);
  const containers = layout?.memberContainers;
  const urls =
    containers === undefined
      ? page.urls
      : page.urls.flatMap((url) =>
          containers.map((member) => ({
            url: `${member.url}${url.slice(roomContainer(room).length)}`,
            owner: member.owner,
          })),
        );
  const documents: ChatDocument[] = [];
  let dropped = 0;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (cursor < urls.length) {
        const index = cursor++;
        const target = urls[index] as string | { url: string; owner: string };
        const document = await optionalChat(
          fetch,
          roomContainer(room),
          typeof target === "string" ? target : target.url,
        );
        if (typeof target !== "string") {
          const checked = memberDocument(document.dataset, document.url, target.owner);
          document.dataset = checked.dataset;
          dropped += checked.dropped;
        }
        documents[index] = document;
      }
    }),
  );
  const messages = documents.flatMap((doc) => readMessages(doc.dataset));
  messages.sort(
    (a, b) => (a.published ?? "").localeCompare(b.published ?? "") || a.id.localeCompare(b.id),
  );
  return { documents, messages, next: page.next, dropped, memberContainers: containers };
}

async function appendEvent(
  fetch: typeof globalThis.fetch,
  room: string,
  message: string,
  change: (dataset: Store) => Store | null,
  resource?: string,
): Promise<ChatDocument> {
  const url = resource ?? messageResource(room, message);
  const base = roomContainer(room);
  for (let attempt = 0; ; attempt++) {
    try {
      const { document, condition } = await optionalCondition(fetch, base, url);
      const delta = change(document.dataset);
      if (!delta) return document;
      if (resource !== undefined && "ifNoneMatch" in condition) {
        await ensureDayParents(fetch, base, url);
        return {
          url,
          dataset: delta,
          etag: await saveChat(fetch, base, url, delta, { ifNoneMatch: "*" }),
        };
      }
      const etag = await insertData(fetch, base, url, delta, {
        ifMatch: strongEtag(document.etag),
      });
      return { url, dataset: new Store([...document.dataset, ...delta]), etag };
    } catch (error) {
      if (!(error instanceof ChatIoError && error.status === 412) || attempt === 1) throw error;
    }
  }
}
export async function reactionDocument(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  actor: string,
) {
  const target = messageResource(room, subject);
  const layout = await roomLayout(fetch, room);
  if (layout?.memberContainers === undefined) return undefined;
  const container = ownContainer(room, layout, actor);
  const member = layout.memberContainers.find((member) => target.startsWith(member.url));
  if (!member) throw new ChatModelError("missing-message");
  const document = await loadChat(fetch, room, target);
  const messages = readMessages(memberDocument(document.dataset, target, member.owner).dataset);
  const url = `${container}${target.slice(member.url.length)}`;
  return { document: url, messages, containers: layout.memberContainers };
}
export async function react(fetch: typeof globalThis.fetch, room: string, input: ReactionInput) {
  messageResource(room, input.message);
  const context = await reactionDocument(fetch, room, input.message, input.actor);
  return appendEvent(
    fetch,
    room,
    input.message,
    (dataset) => appendReaction(dataset, room, input, context),
    context?.document,
  );
}
export async function unreact(fetch: typeof globalThis.fetch, room: string, input: UndoInput) {
  messageResource(room, input.message);
  const context = await reactionDocument(fetch, room, input.message, input.actor);
  return appendEvent(
    fetch,
    room,
    input.message,
    (dataset) => appendUndo(dataset, room, input, context),
    context?.document,
  );
}
async function mutate(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  change: (dataset: Store) => Store,
  actor: string,
  moderate = false,
): Promise<ChatDocument> {
  const url = messageResource(room, subject);
  const layout = await roomLayout(fetch, room);
  if (layout?.memberContainers !== undefined) {
    if (moderate) {
      if (
        layout.creator !== actor ||
        !layout.memberContainers.some((member) => url.startsWith(member.url))
      )
        throw new ChatModelError("not-author");
    } else if (!url.startsWith(ownContainer(room, layout, actor)))
      throw new ChatModelError("not-author");
  } else if (moderate) throw new ChatModelError("not-author");
  const document = await loadChat(fetch, roomContainer(room), url);
  const condition = { ifMatch: strongEtag(document.etag) };
  const member = layout?.memberContainers?.find((member) => url.startsWith(member.url));
  const dataset = change(
    member ? memberDocument(document.dataset, url, member.owner).dataset : document.dataset,
  );
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
  return mutate(
    fetch,
    room,
    subject,
    (dataset) => editMessage(dataset, subject, actor, content, at),
    actor,
  );
}
export function deleteOwnMessage(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  actor: string,
  at: Date,
) {
  return mutate(
    fetch,
    room,
    subject,
    (dataset) => tombstoneMessage(dataset, subject, actor, at),
    actor,
  );
}
export function saveMessageTask(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  actor: string,
  task: MessageTask,
  at: Date,
  due?: Date,
) {
  return mutate(
    fetch,
    room,
    subject,
    (dataset) => {
      const result = turnIntoTask(dataset, subject, actor, task, at);
      if (due) new ChatNode(subject, result, DataFactory).setDate(`${NS.WF}dateDue`, due);
      return result;
    },
    actor,
  );
}
export function removeMessage(
  fetch: typeof globalThis.fetch,
  room: string,
  subject: string,
  owner: string,
  at: Date,
) {
  return mutate(
    fetch,
    room,
    subject,
    (dataset) => {
      const message = readMessages(dataset).find((message) => message.id === subject);
      if (!message?.author) throw new ChatModelError("missing-message");
      return tombstoneMessage(dataset, subject, message.author, at);
    },
    owner,
    true,
  );
}
/** Creates a new container, its advertised WAC ACL, then its descriptor. Never overwrites a room. */
export async function createRoom(
  fetch: typeof globalThis.fetch,
  storage: string,
  slug: string,
  input: RoomInput,
  { resume = false }: { resume?: boolean } = {},
): Promise<ChatDocument> {
  const base = roomContainer(storage);
  const room = `${base}chat/rooms/${segment(slug)}/`;
  const dataset = await buildRoomV2(room, input);
  await ensureContainer(fetch, base, `${base}chat/`);
  await ensureContainer(fetch, base, `${base}chat/rooms/`);
  // `resume` finishes a room in the caller's own storage whose creation was interrupted after
  // the container was claimed: existing container, ACL or index are kept, never overwritten.
  const tolerated = (response: Response) =>
    resume && response.status === 412 ? response : checked(response);
  const claim = async (container: string) => {
    const response = tolerated(
      await scoped(fetch, base)(container, {
        method: "PUT",
        headers: {
          "content-type": "text/turtle",
          "if-none-match": "*",
          link: `<${NS.LDP}BasicContainer>; rel="type"`,
        },
        body: "",
      }),
    );
    let aclRef = response.ok ? aclLink(response.headers.get("link")) : undefined;
    if (!aclRef) {
      const discovery = checked(await scoped(fetch, base)(container, { method: "HEAD" }));
      aclRef = aclLink(discovery.headers.get("link"));
    }
    if (!aclRef) throw new ChatModelError("invalid-input");
    return assertWithinPodScope(base, new URL(aclRef, container).href);
  };
  const aclUrl = await claim(room);
  const create = async (target: string, data: Store) => {
    try {
      return await saveChat(fetch, base, target, data, { ifNoneMatch: "*" });
    } catch (error) {
      if (resume && error instanceof ChatIoError && error.status === 412) return null;
      throw error;
    }
  };
  const url = roomIndex(room);
  if (resume) {
    // An existing index decides what the room is; never touch its ACL on the caller's behalf.
    try {
      return await loadChat(fetch, base, url);
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    }
  }
  await create(aclUrl, buildRoomAcl(room, aclUrl, input.creator, input.members, "v2"));
  await ensureContainer(fetch, base, `${room}members/`);
  for (const member of new Set([input.creator, ...input.members])) {
    const container = await memberContainer(room, member);
    const acl = await claim(container);
    await create(acl, buildRoomAcl(container, acl, input.creator, input.members, "v2", member));
  }
  const etag = await create(url, dataset);
  if (etag === null && resume) return loadChat(fetch, base, url);
  return { url, dataset, etag };
}
