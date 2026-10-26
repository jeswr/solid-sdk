// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { buildAs2Message, parseAs2Message } from "./as2.js";
import { safeHttpIri, sanitizeText } from "./iri.js";
import { storeToTurtle } from "./reconcile.js";
import { AS_COLLECTION, AS_NAME, DCT, RDF_TYPE } from "./vocab.js";

/** Structural subset of DESIGN §3 PodPort; implementations enforce pod scope. */
export interface ChatPodPort {
  root: string;
  webId: string;
  read(url: string): Promise<{ body: Uint8Array; contentType: string; etag?: string }>;
  list(container: string): Promise<{ url: string; isContainer: boolean }[]>;
  /** Discover a unique, pod-scoped WAC ACL from the target's Link header, even on 404.
   * Reject unsupported models, unsafe targets, redirects and discovery failures. */
  discoverAcl(url: string): Promise<string>;
  /** Reject failed requests with an error carrying numeric `status` (notably 404/412). */
  write(
    url: string,
    body: Uint8Array,
    contentType: string,
    cond: { ifMatch?: string; ifNoneMatch?: "*" },
  ): Promise<{ etag?: string }>;
}

export const CHAT_PROVIDERS = ["claude", "chatgpt", "codex"] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];
export const CHAT_ROLES = ["system", "user", "assistant", "tool"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];
export interface ChatMessage {
  id?: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}
export interface ChatConversation {
  provider: ChatProvider;
  conversationId: string;
  title: string;
  messages: ChatMessage[];
}
export interface ChatSummary {
  url: string;
  provider: ChatProvider;
  conversationId: string;
  title: string;
  updatedAt?: string;
}
export interface ChatListOptions {
  provider?: ChatProvider;
  since?: string;
  /** Exclusive conversation URL from the previous page. */
  cursor?: string;
  limit?: number;
}

/** Metadata layered onto canonical AS2 notes using existing Dublin Core terms. */
class ChatDoc extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get identifier(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}identifier`, LiteralAs.string);
  }
  set identifier(v: string | undefined) {
    OptionalAs.object(this, `${DCT}identifier`, v, LiteralFrom.string);
  }
  get role(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}type`, LiteralAs.string);
  }
  set role(v: string | undefined) {
    OptionalAs.object(this, `${DCT}type`, v, LiteralFrom.string);
  }
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, AS_NAME, LiteralAs.string);
  }
  set title(v: string | undefined) {
    OptionalAs.object(this, AS_NAME, v, LiteralFrom.string);
  }
}

export function chatPortStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  )
    return error.status;
  return undefined;
}

function identifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
    throw new TypeError("Chat IDs must contain 1–200 letters, digits, underscores or hyphens");
  }
  return value;
}
function providerId(value: ChatProvider): ChatProvider {
  if (!CHAT_PROVIDERS.includes(value)) throw new TypeError("Unsupported chat provider");
  return value;
}
function timestamp(value: string): string {
  // Require an explicit zone so persistence does not depend on the host timezone.
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new TypeError("Invalid chat timestamp");
  return new Date(value).toISOString();
}
async function messageId(message: ChatMessage): Promise<string> {
  if (message.id !== undefined) return identifier(message.id);
  const bytes = new TextEncoder().encode(
    JSON.stringify([message.role, message.text, message.createdAt]),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Owner-only, create-only AS2 chat persistence, reusable by capture/import callers. */
export class ChatWriter {
  private readonly base: string;
  private readonly owner: string;
  constructor(private readonly pod: ChatPodPort) {
    const root = new URL(pod.root);
    if (
      !safeHttpIri(pod.root) ||
      root.username ||
      root.password ||
      root.search ||
      root.hash ||
      !root.pathname.endsWith("/")
    )
      throw new TypeError("Invalid chat pod root");
    const owner = safeHttpIri(pod.webId);
    if (!owner) throw new TypeError("Chat storage requires an owner WebID");
    this.owner = owner;
    this.base = `${root.href}private/chats/`;
  }
  private conversationUrl(provider: ChatProvider, id: string): string {
    return `${this.base}${providerId(provider)}/${identifier(id)}/`;
  }
  private async create(url: string, turtle: string): Promise<boolean> {
    try {
      await this.pod.write(url, encoder.encode(turtle), "text/turtle", { ifNoneMatch: "*" });
      return true;
    } catch (error) {
      if (chatPortStatus(error) === 412) return false;
      throw error;
    }
  }
  private async protect(container: string): Promise<void> {
    const acl = await this.pod.discoverAcl(container);
    // Existing documents must be recognizable WAC, never ACP or another model.
    try {
      const existing = await this.dataset(acl);
      if (
        existing.size > 0 &&
        [...new AclResource(existing, DataFactory).authorizations].length === 0
      )
        throw new Error("Unsupported chat access-control model");
    } catch (error) {
      if (chatPortStatus(error) !== 404) throw error;
    }
    const store = new Store();
    const auth = new Authorization(`${acl}#owner`, store, DataFactory);
    auth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
    auth.accessTo = container;
    auth.default = container;
    auth.agent.add(this.owner);
    auth.canRead = true;
    auth.canWrite = true;
    auth.canReadWriteAcl = true;
    // No content is written until the owner-only ACL PUT succeeds. In particular,
    // never swallow ACL errors or fall back to inherited/public permissions.
    await this.pod.write(acl, encoder.encode(await storeToTurtle(store)), "text/turtle", {});
    const containerStore = new Store();
    new ChatDoc(container, containerStore, DataFactory).types.add(
      "http://www.w3.org/ns/ldp#BasicContainer",
    );
    await this.create(container, await storeToTurtle(containerStore));
    if ((await this.pod.discoverAcl(container)) !== acl)
      throw new Error("Chat ACL association changed after container creation");
  }
  async save(
    conversation: ChatConversation,
  ): Promise<{ url: string; saved: number; skipped: number }> {
    const url = this.conversationUrl(conversation.provider, conversation.conversationId);
    // Validate and serialize everything before the first write.
    const messages = await Promise.all(
      conversation.messages.map(async (message) => {
        if (!CHAT_ROLES.includes(message.role)) throw new TypeError("Unsupported chat role");
        const normalized = { ...message, createdAt: timestamp(message.createdAt) };
        const id = await messageId(normalized);
        const resource = `${url}m-${id}.ttl`;
        const subject = `${resource}#it`;
        const store = buildAs2Message(subject, {
          id: subject,
          content: normalized.text,
          mediaType: "text/plain",
          published: normalized.createdAt,
          room: url,
          ...(message.role === "user" ? { author: this.owner } : {}),
        });
        const doc = new ChatDoc(subject, store, DataFactory);
        doc.identifier = id;
        doc.role = message.role;
        return { resource, turtle: await storeToTurtle(store) };
      }),
    );
    const metadata = new Store();
    const room = new ChatDoc(`${url}_conversation.ttl#it`, metadata, DataFactory);
    room.types.add(AS_COLLECTION);
    room.identifier = conversation.conversationId;
    room.title = sanitizeText(conversation.title);
    const roomTurtle = await storeToTurtle(metadata);
    for (const container of [this.base, `${this.base}${conversation.provider}/`, url])
      await this.protect(container);
    await this.create(`${url}_conversation.ttl`, roomTurtle);
    let saved = 0;
    for (const message of messages)
      if (await this.create(message.resource, message.turtle)) saved++;
    return { url, saved, skipped: messages.length - saved };
  }
  private async dataset(url: string) {
    const result = await this.pod.read(url);
    // Our persisted format is Turtle. Reject JSON-LD before the shared parser
    // can follow an untrusted remote context outside the injected pod port.
    if (
      !["text/turtle", "application/n-triples", "application/n-quads", "application/trig"].includes(
        result.contentType.split(";")[0]?.trim().toLowerCase() ?? "",
      )
    ) {
      throw new Error("Unsupported chat RDF content type");
    }
    return parseRdf(decoder.decode(result.body), result.contentType, { baseIRI: url });
  }
  private async children(container: string) {
    try {
      return await this.pod.list(container);
    } catch (error) {
      if (chatPortStatus(error) === 404) return [];
      throw error;
    }
  }
  async get(
    provider: ChatProvider,
    conversationId: string,
  ): Promise<ChatConversation & { url: string }> {
    const url = this.conversationUrl(provider, conversationId);
    const metadataUrl = `${url}_conversation.ttl`;
    const room = new ChatDoc(`${metadataUrl}#it`, await this.dataset(metadataUrl), DataFactory);
    return this.readConversation(provider, conversationId, room);
  }
  private async readConversation(provider: ChatProvider, conversationId: string, room: ChatDoc) {
    const url = this.conversationUrl(provider, conversationId);
    if (
      !room.types.has(AS_COLLECTION) ||
      room.identifier !== conversationId ||
      room.title === undefined
    ) {
      throw new Error("Invalid conversation metadata");
    }
    const messages: (ChatMessage & { id: string })[] = [];
    const resources = await this.children(url);
    for (const child of resources) {
      // Only immediate, generated message names; poisoned listings cannot steer reads.
      if (
        child.isContainer ||
        !child.url.startsWith(url) ||
        !/^m-[a-zA-Z0-9_-]{1,200}\.ttl$/.test(child.url.slice(url.length))
      )
        continue;
      const dataset = await this.dataset(child.url);
      const subject = `${child.url}#it`;
      const canonical = parseAs2Message(subject, dataset);
      const doc = new ChatDoc(subject, dataset, DataFactory);
      const id = doc.identifier;
      const role = doc.role as ChatRole;
      if (
        !canonical ||
        !id ||
        child.url !== `${url}m-${identifier(id)}.ttl` ||
        !CHAT_ROLES.includes(role) ||
        !canonical.published ||
        canonical.room !== url
      ) {
        throw new Error("Invalid stored chat message");
      }
      messages.push({ id, role, text: canonical.content, createdAt: canonical.published });
    }
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return { url, provider, conversationId, title: room.title, messages };
  }
  async list(
    options: ChatListOptions = {},
  ): Promise<{ conversations: ChatSummary[]; nextCursor?: string }> {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new TypeError("limit must be 1–100");
    const since = options.since === undefined ? undefined : timestamp(options.since);
    const providers =
      options.provider === undefined ? CHAT_PROVIDERS : [providerId(options.provider)];
    const candidates: { provider: ChatProvider; id: string; url: string }[] = [];
    for (const provider of providers) {
      const parent = `${this.base}${provider}/`;
      for (const child of await this.children(parent)) {
        if (!child.isContainer || !child.url.startsWith(parent)) continue;
        const segment = child.url.slice(parent.length);
        if (!/^[a-zA-Z0-9_-]{1,200}\/$/.test(segment)) continue;
        if (options.cursor !== undefined && child.url <= options.cursor) continue;
        candidates.push({ provider, id: segment.slice(0, -1), url: child.url });
      }
    }
    candidates.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
    const conversations: ChatSummary[] = [];
    for (const candidate of candidates) {
      const metadataUrl = `${candidate.url}_conversation.ttl`;
      let metadata: Awaited<ReturnType<ChatWriter["dataset"]>>;
      try {
        metadata = await this.dataset(metadataUrl);
      } catch (error) {
        // A container may remain after an interrupted save. Only absent metadata
        // marks it incomplete; permissions, transport and missing messages still fail.
        if (chatPortStatus(error) === 404) continue;
        throw error;
      }
      const conversation = await this.readConversation(
        candidate.provider,
        candidate.id,
        new ChatDoc(`${metadataUrl}#it`, metadata, DataFactory),
      );
      const updatedAt = conversation.messages.at(-1)?.createdAt;
      if (since !== undefined && (updatedAt === undefined || updatedAt <= since)) continue;
      if (conversations.length === limit)
        return {
          conversations,
          nextCursor: conversations.at(-1)?.url,
        };
      conversations.push({
        url: conversation.url,
        provider: conversation.provider,
        conversationId: conversation.conversationId,
        title: conversation.title,
        ...(updatedAt === undefined ? {} : { updatedAt }),
      });
    }
    return { conversations };
  }
}
