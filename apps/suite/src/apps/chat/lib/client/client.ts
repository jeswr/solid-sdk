// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  isWithinPodScope,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { Store } from "n3";
import { encodeRef } from "../../../../lib/refs";
import {
  ChatIoError,
  type ChatMessage,
  ChatModelError,
  countUnread,
  createRoom as createModelRoom,
  deleteOwnMessage,
  httpIri,
  loadChat,
  loadMessages,
  loadRoom,
  loadRooms,
  type MemberContainer,
  messageResource,
  type Reaction,
  react,
  reactionDocument,
  readMessages,
  readReactions,
  type readRoom,
  readRoomLayout,
  removeJoinedRoom,
  removeMessage,
  roomContainer,
  saveJoinedRoom,
  saveMessageEdit,
  saveMessageTask,
  sendMessage,
  unreact,
} from "../model";
import { copyMessageTask, loadProfileName, loadRoomFiles } from "../model/extras";
import {
  evaluateQuery,
  MAX_MESSAGE_FIELD_LENGTH,
  MAX_MESSAGE_ID_LENGTH,
  MAX_MESSAGE_TEXT_LENGTH,
  MAX_MESSAGES,
  parseQuery,
  type SearchMessage,
  type SearchSnippet,
} from "../search";
import { aggregateReactions, type ReactionSummary } from "../timeline";
import { PreferencesStore } from "./preferences-store";

export interface Room {
  url: string;
  name: string;
  members: string[];
  creator: string | undefined;
  created: string | undefined;
  memberContainers?: MemberContainer[];
  isDirect: boolean;
  lastActivity?: Date;
}
export type JoinedRoom = Room | { url: string; error: unknown };
export interface Message extends ChatMessage {
  deleted: boolean;
  edited: boolean;
  reactions: ReactionSummary[];
}
export interface ChatSearchOptions {
  days?: number;
  maxRooms?: number;
  timeZone: string;
  signal?: AbortSignal | undefined;
}
/** A searched room; direct messages carry their members so the UI can name the other person. */
export interface ChatSearchRoom {
  url: string;
  name: string;
  isDirect: boolean;
  members: string[];
}
export interface ChatSearchResult {
  results: {
    room: ChatSearchRoom;
    message: Message;
    snippet: SearchSnippet;
    score: number;
  }[];
  searchedRooms: number;
  skipped: ChatSearchRoom[];
  truncated: boolean;
  truncationReasons: ("rooms" | "days" | "results" | "records")[];
  searchedDays: number;
  droppedRecords: number;
}
export class ChatClientError extends Error {
  override name = "ChatClientError";
  constructor(readonly code: "not-own-message" | "missing-message" | "direct-room-collision") {
    super(
      code === "direct-room-collision"
        ? "The direct message address is occupied by an unavailable or different conversation. Try again later."
        : `Chat: ${code}`,
    );
  }
}
function displayMessage(message: ChatMessage): Message {
  const deleted = message.tombstone || message.deletedAt !== undefined;
  return {
    ...message,
    content: deleted ? "Message deleted" : message.content,
    deleted,
    edited: !deleted && message.updated !== undefined,
    reactions: [],
  };
}
function roomResult(url: string, room: NonNullable<ReturnType<typeof readRoom>>): Room {
  return {
    url: roomContainer(url),
    name: room.name,
    members: room.members,
    creator: room.creator,
    created: room.created,
    ...(room.memberContainers !== undefined ? { memberContainers: room.memberContainers } : {}),
    isDirect: room.members.length === 2 && (room.name === "" || room.name.startsWith("dm:")),
  };
}
function slug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48)
      .replace(/-$/, "") || "room"
  );
}
/** Attach cancellation without changing the RDF model's fetch seam. */
function abortableFetch(
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal,
): typeof globalThis.fetch {
  if (!signal) return fetch;
  return (input, init) => {
    signal.throwIfAborted();
    // The RDF model never passes its own signal, so this one is the only one.
    return fetch(input, { ...init, signal });
  };
}
export class ChatClient {
  readonly fetch: typeof globalThis.fetch;
  readonly preferences: PreferencesStore;
  private readonly known = new Map<string, Message>();
  private readonly profiles = new Map<string, Promise<string>>();
  private readonly resolvedNames = new Map<string, string>();
  private joinedCache: JoinedRoom[] | undefined;
  constructor(
    fetch: typeof globalThis.fetch,
    readonly storageUrl: string,
    readonly webId: string,
    private readonly publicFetch: typeof globalThis.fetch = globalThis.fetch,
    displayName?: string,
  ) {
    this.fetch = createPodScopedFetch(roomContainer(storageUrl), {
      fetch: refuseRedirects(fetch),
      maxRedirects: 0,
    });
    httpIri(webId);
    this.preferences = new PreferencesStore(this.fetch, storageUrl);
    if (displayName) this.resolvedNames.set(webId, displayName);
  }
  canOpen(url: string): boolean {
    return isWithinPodScope(this.storageUrl, url);
  }
  async joinedRooms({
    signal,
    cached = false,
  }: {
    signal?: AbortSignal | undefined;
    cached?: boolean;
  } = {}): Promise<JoinedRoom[]> {
    signal?.throwIfAborted();
    const { rooms } = await loadRooms(abortableFetch(this.fetch, signal), this.storageUrl).catch(
      (error: unknown) => {
        signal?.throwIfAborted();
        throw error;
      },
    );
    const joined: JoinedRoom[] = [];
    let cursor = 0;
    // Metadata reads share the same four-request bound as message loading.
    await Promise.all(
      Array.from({ length: Math.min(4, rooms.length) }, async () => {
        while (cursor < rooms.length) {
          signal?.throwIfAborted();
          const index = cursor++;
          const url = rooms[index] as string;
          try {
            joined[index] =
              (cached &&
                this.joinedCache?.find((room) => room.url === url && !("error" in room))) ||
              (await this.room(url, { signal }));
          } catch (error) {
            signal?.throwIfAborted();
            joined[index] = { url, error };
          }
        }
      }),
    );
    this.joinedCache = joined;
    return joined;
  }
  async room(url: string, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<Room> {
    signal?.throwIfAborted();
    const { room } = await loadRoom(abortableFetch(this.fetch, signal), url);
    if (!room) throw new ChatModelError("invalid-input");
    return roomResult(url, room);
  }
  private remember(messages: ChatMessage[], reactions = new Map<string, Reaction[]>()): Message[] {
    return messages.map((message) => {
      const result = displayMessage(message);
      result.reactions = aggregateReactions(reactions.get(message.id) ?? [], this.webId);
      this.known.set(result.id, result);
      return result;
    });
  }
  async messages(
    url: string,
    {
      before = new Date(),
      days = 7,
      since = new Date("1970-01-01T00:00:00Z"),
      signal,
    }: {
      before?: Date;
      days?: number;
      since?: Date | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<{ messages: Message[]; next: Date | null; dropped?: number }> {
    const page = await loadMessages(abortableFetch(this.fetch, signal), url, before, since, days);
    const reactions = new Map<string, Reaction[]>();
    const known = new Set(page.messages.map((message) => message.id));
    for (const document of page.documents)
      for (const [message, found] of readReactions(
        document.dataset,
        document.url,
        known,
        page.memberContainers,
      ))
        reactions.set(message, [...(reactions.get(message) ?? []), ...found]);
    return {
      messages: this.remember(page.messages, reactions),
      next: page.next,
      dropped: page.dropped,
    };
  }
  async search(
    source: string,
    { days = 30, maxRooms = 50, timeZone, signal }: ChatSearchOptions,
  ): Promise<ChatSearchResult> {
    const parsed = parseQuery(source);
    evaluateQuery(parsed, [], timeZone);
    if (!Number.isSafeInteger(days) || days < 1 || !Number.isSafeInteger(maxRooms) || maxRooms < 1)
      throw new ChatModelError("invalid-input");
    signal?.throwIfAborted();
    const joined = await this.joinedRooms({ signal, cached: true });
    const budget = Math.min(days, 366);
    const query = {
      ...parsed,
      terms: parsed.terms.map((term) => {
        if (term.type !== "filter" || term.field !== "in") return term;
        const wanted = term.value.toLowerCase();
        // A room by its name, or a direct message by the other person's resolved name.
        const room = joined.find(
          (room) =>
            !("error" in room) &&
            (room.name.toLowerCase() === wanted ||
              (room.isDirect &&
                room.members.some(
                  (member) =>
                    member !== this.webId &&
                    this.resolvedNames.get(member)?.toLowerCase() === wanted,
                ))),
        );
        return room ? { ...term, value: room.url } : term;
      }),
    };
    // Room names can expand to a much longer (or malformed) IRI. Validate again before reads.
    evaluateQuery(query, [], timeZone);
    const included = query.terms.filter(
      (term) => term.type === "filter" && term.field === "in" && !term.negated,
    );
    const eligible = joined.filter((room) => included.every((term) => term.value === room.url));
    const rooms = included.length ? eligible : eligible.slice(0, maxRooms);
    const reasons = new Set<ChatSearchResult["truncationReasons"][number]>();
    if (rooms.length < eligible.length) reasons.add("rooms");
    const result: ChatSearchResult = {
      results: [],
      searchedRooms: 0,
      skipped: [],
      truncated: false,
      truncationReasons: [],
      searchedDays: budget,
      droppedRecords: 0,
    };
    const pages: { messages: Message[]; next: Date | null }[] = [];
    const before = new Date();
    let cursor = 0;
    const skipped = new Set<number>();
    await Promise.all(
      Array.from({ length: Math.min(4, rooms.length) }, async () => {
        while (cursor < rooms.length) {
          signal?.throwIfAborted();
          const index = cursor++;
          const room = rooms[index] as JoinedRoom;
          try {
            if ("error" in room) throw room.error;
            const created = room.created ? new Date(room.created) : new Date(NaN);
            const since =
              Number.isFinite(created.getTime()) &&
              created.getUTCFullYear() >= 1 &&
              created.getUTCFullYear() <= 9999 &&
              created.getTime() <= before.getTime()
                ? created
                : undefined;
            const page = await this.messages(room.url, { before, days: budget, since, signal });
            signal?.throwIfAborted();
            pages[index] = page;
            result.searchedRooms++;
            if (page.next) reasons.add("days");
          } catch {
            signal?.throwIfAborted();
            skipped.add(index);
          }
        }
      }),
    );
    const snapshot = new Map<
      string,
      { room: ChatSearchRoom; message: Message; record: SearchMessage }
    >();
    // Merge in listed order, independent of request completion. A nested owning container wins.
    rooms.forEach((room, index) => {
      const summary: ChatSearchRoom =
        "error" in room
          ? { url: room.url, name: room.url, isDirect: false, members: [] }
          : { url: room.url, name: room.name, isDirect: room.isDirect, members: room.members };
      if (skipped.has(index)) result.skipped.push(summary);
      for (const message of pages[index]?.messages ?? []) {
        if (message.deleted || message.tombstone || message.deletedAt !== undefined) continue;
        const createdAt = message.published ? Date.parse(message.published) : 0;
        const author = message.author ?? "unknown";
        try {
          if (
            message.id.length > MAX_MESSAGE_ID_LENGTH ||
            room.url.length > MAX_MESSAGE_ID_LENGTH ||
            !message.id.isWellFormed() ||
            !room.url.isWellFormed() ||
            !isWithinPodScope(room.url, httpIri(message.id)) ||
            message.content.length > MAX_MESSAGE_TEXT_LENGTH ||
            author.length > MAX_MESSAGE_FIELD_LENGTH ||
            !author.trim() ||
            !Number.isSafeInteger(createdAt) ||
            createdAt < -62_135_596_800_000 ||
            createdAt > 253_402_300_799_999
          )
            throw new ChatModelError("invalid-input");
        } catch {
          result.droppedRecords++;
          continue;
        }
        const previous = snapshot.get(message.id);
        if (previous && previous.room.url.length >= room.url.length) continue;
        if (!previous && snapshot.size >= MAX_MESSAGES) {
          reasons.add("records");
          result.droppedRecords++;
          continue;
        }
        const record: SearchMessage = {
          id: message.id,
          roomId: room.url,
          authorWebId: author.toWellFormed(),
          authorName: (this.resolvedNames.get(author) ?? message.author ?? "Unknown author")
            .slice(0, MAX_MESSAGE_FIELD_LENGTH)
            .toWellFormed(),
          text: message.content.toWellFormed(),
          createdAt,
          hasAttachment: false,
          inReplyTo: null,
        };
        snapshot.set(message.id, { room: summary, message, record });
      }
    });
    const matches = evaluateQuery(
      query,
      [...snapshot.values()].map(({ record }) => record),
      timeZone,
    );
    if (matches.length > 200) reasons.add("results");
    result.results = matches.slice(0, 200).map(({ message, snippet, score }) => {
      const entry = snapshot.get(message.id) as NonNullable<ReturnType<typeof snapshot.get>>;
      return { room: entry.room, message: entry.message, snippet, score };
    });
    result.truncationReasons = (["rooms", "days", "results", "records"] as const).filter((reason) =>
      reasons.has(reason),
    );
    result.truncated = result.truncationReasons.length > 0;
    return result;
  }
  async send(
    room: string,
    text: string,
    { id = crypto.randomUUID(), at = new Date() }: { id?: string; at?: Date } = {},
  ): Promise<Message> {
    const input = { id, at, author: this.webId, content: text };
    const send = () => sendMessage(this.fetch, room, input);
    let document: Awaited<ReturnType<typeof sendMessage>>;
    try {
      document = await send();
    } catch (error) {
      if (!(error instanceof ChatIoError && error.status === 412)) throw error;
      // sendMessage re-reads the day, merging the append against the winner.
      document = await send();
    }
    const messages = this.remember(
      readMessages(document.dataset),
      readReactions(document.dataset, document.url),
    );
    return messages.find((message) => message.id === `${document.url}#${id}`) as Message;
  }
  async react(room: string, subject: string, emoji: string): Promise<void> {
    assertWithinPodScope(this.storageUrl, roomContainer(room));
    const url = messageResource(room, subject);
    let document: Awaited<ReturnType<typeof loadChat>>;
    try {
      document = await loadChat(this.fetch, room, url);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404)
        throw new ChatClientError("missing-message");
      throw error;
    }
    const message = readMessages(document.dataset).find((message) => message.id === subject);
    if (!message || message.tombstone || message.deletedAt !== undefined)
      throw new ChatClientError("missing-message");
    const context = await reactionDocument(this.fetch, room, subject, this.webId);
    if (context) {
      if (!context.messages.some((message) => message.id === subject))
        throw new ChatClientError("missing-message");
      try {
        document = await loadChat(this.fetch, room, context.document);
      } catch (error) {
        if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
        document = { url: context.document, dataset: new Store(), etag: null };
      }
    }
    const mine = (
      readReactions(
        document.dataset,
        context?.document ?? url,
        new Set([subject]),
        context?.containers,
      ).get(subject) ?? []
    ).filter((reaction) => reaction.actorId === this.webId && reaction.emoji === emoji);
    const input = { message: subject, actor: this.webId, at: new Date() };
    if (mine.length) {
      for (const reaction of mine) {
        document = await unreact(this.fetch, room, {
          ...input,
          id: crypto.randomUUID(),
          reaction: reaction.id,
        });
      }
    } else {
      document = await react(this.fetch, room, { ...input, id: crypto.randomUUID(), emoji });
    }
    this.remember(readMessages(document.dataset), readReactions(document.dataset, url));
  }
  private own(subject: string): void {
    if (this.known.get(subject)?.author !== this.webId)
      throw new ChatClientError("not-own-message");
  }
  async edit(room: string, subject: string, text: string): Promise<void> {
    this.own(subject);
    this.remember(
      readMessages(
        (await saveMessageEdit(this.fetch, room, subject, this.webId, text, new Date())).dataset,
      ),
    );
  }
  async remove(room: string, subject: string): Promise<void> {
    this.own(subject);
    this.remember(
      readMessages(
        (await deleteOwnMessage(this.fetch, room, subject, this.webId, new Date())).dataset,
      ),
    );
  }
  async moderate(room: string, subject: string): Promise<void> {
    if (!this.known.has(subject)) throw new ChatClientError("missing-message");
    this.remember(
      readMessages(
        (await removeMessage(this.fetch, room, subject, this.webId, new Date())).dataset,
      ),
    );
  }
  async toTask(room: string, subject: string, task: { title: string; due?: Date }): Promise<void> {
    const message = this.known.get(subject);
    if (!message) throw new ChatClientError("missing-message");
    if (message.author === this.webId) {
      this.remember(
        readMessages(
          (
            await saveMessageTask(
              this.fetch,
              room,
              subject,
              this.webId,
              { title: task.title, state: "open" },
              new Date(),
              task.due,
            )
          ).dataset,
        ),
      );
    } else {
      // Participants have Append, not Write: another author's message stays intact.
      await copyMessageTask(this.fetch, this.storageUrl, this.webId, message, task);
    }
  }
  async createRoom({ name, members }: { name: string; members: readonly string[] }): Promise<Room> {
    const base = slug(name);
    // Deterministic DM addresses are reserved: a named room never occupies one.
    return this.create(/^dm-[a-f\d]{16}$/.test(base) ? `${base}-room` : base, name, members);
  }
  private async create(baseSlug: string, name: string, members: readonly string[]): Promise<Room> {
    for (let suffix = 1; ; suffix++) {
      const extension = suffix === 1 ? "" : `-${suffix}`;
      const candidate = `${baseSlug.slice(0, 48 - extension.length).replace(/-$/, "")}${extension}`;
      let document: Awaited<ReturnType<typeof createModelRoom>>;
      try {
        document = await createModelRoom(this.fetch, this.storageUrl, candidate, {
          name,
          members,
          creator: this.webId,
          created: new Date(),
        });
      } catch (error) {
        if (error instanceof ChatIoError && error.status === 412) continue;
        throw error;
      }
      const url = `${roomContainer(this.storageUrl)}chat/rooms/${candidate}/`;
      await this.join(url);
      return roomResult(
        url,
        (await readRoomLayout(url, document.dataset)) as NonNullable<ReturnType<typeof readRoom>>,
      );
    }
  }
  async createDirect(webId: string): Promise<Room> {
    httpIri(webId);
    const people = [...new Set([this.webId, webId])].sort();
    if (people.length !== 2) throw new ChatModelError("invalid-input");
    const existing = (await this.joinedRooms()).find(
      (room) =>
        !("error" in room) &&
        room.isDirect &&
        people.every((person) => room.members.includes(person)),
    );
    if (existing) return existing as Room;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(people)),
    );
    const hash = [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const candidate = `dm-${hash}`;
    const url = `${roomContainer(this.storageUrl)}chat/rooms/${candidate}/`;
    let room: Room;
    try {
      const document = await createModelRoom(this.fetch, this.storageUrl, candidate, {
        name: "",
        members: people,
        creator: this.webId,
        created: new Date(),
      });
      room = roomResult(
        url,
        (await readRoomLayout(url, document.dataset)) as NonNullable<ReturnType<typeof readRoom>>,
      );
    } catch (error) {
      if (!(error instanceof ChatIoError && error.status === 412)) throw error;
      room = await this.directWinner(url).catch(async (failure: unknown) => {
        // directWinner only fails with direct-room-collision. The DM lives in our own storage, so
        // an index that never appears means an earlier creation was interrupted: finish it
        // (never overwriting) instead of failing forever.
        const document = await createModelRoom(
          this.fetch,
          this.storageUrl,
          candidate,
          { name: "", members: people, creator: this.webId, created: new Date() },
          { resume: true },
        );
        const resumed = await readRoomLayout(url, document.dataset);
        if (!resumed) throw failure;
        return roomResult(url, resumed);
      });
      if (!room.isDirect || !people.every((person) => room.members.includes(person)))
        throw new ChatClientError("direct-room-collision");
    }
    await this.join(url);
    return room;
  }
  private async directWinner(url: string): Promise<Room> {
    // The container is claimed before its ACL/index are written. Give the winner
    // a bounded chance to finish; never overwrite or suffix a deterministic DM.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.room(url);
      } catch (error) {
        if (!(error instanceof RdfFetchError && error.status === 404) || attempt === 4)
          throw new ChatClientError("direct-room-collision");
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }
  async join(url: string): Promise<void> {
    this.joinedCache = undefined;
    try {
      await saveJoinedRoom(this.fetch, this.storageUrl, url);
    } catch (error) {
      if (!(error instanceof ChatIoError && error.status === 412)) throw error;
      // Joining is set insertion: re-read after a concurrent collection write.
      await saveJoinedRoom(this.fetch, this.storageUrl, url);
    }
  }
  async leave(url: string): Promise<void> {
    this.joinedCache = undefined;
    await removeJoinedRoom(this.fetch, this.storageUrl, url);
  }
  async unreadCounts(rooms: readonly { url: string }[]): Promise<Record<string, number>> {
    const { data } = await this.preferences.read();
    const pairs = await Promise.all(
      rooms.map(async ({ url }) => {
        const page = await this.messages(url);
        const messages = page.messages
          .filter(
            (message) =>
              !message.deleted &&
              message.author !== undefined &&
              message.author !== this.webId &&
              message.published !== undefined,
          )
          .map((message) => ({
            id: message.id,
            roomId: url,
            senderId: message.author as string,
            timestamp: Date.parse(message.published as string),
            mentionIds: [],
          }));
        return [
          url,
          countUnread(
            {
              roomId: url,
              lastRead: data.find((marker) => marker.roomId === url)?.lastRead ?? null,
              messages,
            },
            this.webId,
          ).unreadCount,
        ] as const;
      }),
    );
    return Object.fromEntries(pairs);
  }
  inviteLink(room: string, origin: string): string {
    return `${new URL(origin).origin}/chat/r/${encodeRef(roomContainer(room))}`;
  }
  profile(webId: string): Promise<string> {
    let pending = this.profiles.get(webId);
    if (!pending) {
      pending = loadProfileName(this.fetch, this.publicFetch, this.storageUrl, webId).catch(() => {
        const url = new URL(webId);
        return `${url.host}${url.pathname}${url.hash}`;
      });
      pending = pending.then((name) => {
        this.resolvedNames.set(webId, name);
        return name;
      });
      this.profiles.set(webId, pending);
    }
    return pending;
  }
  files(room: string) {
    return loadRoomFiles(this.fetch, room);
  }
}
