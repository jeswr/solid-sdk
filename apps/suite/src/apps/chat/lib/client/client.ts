// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch, isWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { encodeRef } from "../../../../lib/refs";
import {
  ChatIoError,
  type ChatMessage,
  ChatModelError,
  countUnread,
  createRoom as createModelRoom,
  deleteOwnMessage,
  httpIri,
  loadMessages,
  loadRoom,
  loadRooms,
  messageSubject,
  readMessages,
  readRoom,
  removeJoinedRoom,
  roomContainer,
  saveJoinedRoom,
  saveMessageEdit,
  saveMessageTask,
  sendMessage,
} from "../model";
import { copyMessageTask, loadProfileName, loadRoomFiles } from "../model/extras";
import { PreferencesStore } from "./preferences-store";

export interface Room {
  url: string;
  name: string;
  members: string[];
  creator: string | undefined;
  created: string | undefined;
  isDirect: boolean;
  lastActivity?: Date;
}
export type JoinedRoom = Room | { url: string; error: unknown };
export interface Message extends ChatMessage {
  deleted: boolean;
  edited: boolean;
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
  };
}
function roomResult(url: string, room: NonNullable<ReturnType<typeof readRoom>>): Room {
  return {
    url: roomContainer(url),
    name: room.name,
    members: room.members,
    creator: room.creator,
    created: room.created,
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
export class ChatClient {
  readonly fetch: typeof globalThis.fetch;
  readonly preferences: PreferencesStore;
  private readonly known = new Map<string, Message>();
  private readonly profiles = new Map<string, Promise<string>>();
  constructor(
    fetch: typeof globalThis.fetch,
    readonly storageUrl: string,
    readonly webId: string,
    private readonly publicFetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.fetch = createPodScopedFetch(roomContainer(storageUrl), {
      fetch: refuseRedirects(fetch),
      maxRedirects: 0,
    });
    httpIri(webId);
    this.preferences = new PreferencesStore(this.fetch, storageUrl);
  }
  canOpen(url: string): boolean {
    return isWithinPodScope(this.storageUrl, url);
  }
  async joinedRooms(): Promise<JoinedRoom[]> {
    const { rooms } = await loadRooms(this.fetch, this.storageUrl);
    return Promise.all(
      rooms.map(async (url) => {
        try {
          return await this.room(url);
        } catch (error) {
          return { url, error };
        }
      }),
    );
  }
  async room(url: string): Promise<Room> {
    const { room } = await loadRoom(this.fetch, url);
    if (!room) throw new ChatModelError("invalid-input");
    return roomResult(url, room);
  }
  private remember(messages: ChatMessage[]): Message[] {
    return messages.map((message) => {
      const result = displayMessage(message);
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
    }: { before?: Date; days?: number; since?: Date } = {},
  ) {
    const page = await loadMessages(this.fetch, url, before, since, days);
    return { messages: this.remember(page.messages), next: page.next };
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
    const messages = this.remember(readMessages(document.dataset));
    return messages.find((message) => message.id === messageSubject(room, at, id)) as Message;
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
    return this.create(slug(name), name, members);
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
        readRoom(url, document.dataset) as NonNullable<ReturnType<typeof readRoom>>,
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
        readRoom(url, document.dataset) as NonNullable<ReturnType<typeof readRoom>>,
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
        const resumed = readRoom(url, document.dataset);
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
    try {
      await saveJoinedRoom(this.fetch, this.storageUrl, url);
    } catch (error) {
      if (!(error instanceof ChatIoError && error.status === 412)) throw error;
      // Joining is set insertion: re-read after a concurrent collection write.
      await saveJoinedRoom(this.fetch, this.storageUrl, url);
    }
  }
  async leave(url: string): Promise<void> {
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
      this.profiles.set(webId, pending);
    }
    return pending;
  }
  files(room: string) {
    return loadRoomFiles(this.fetch, room);
  }
}
