// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
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
import { normalizeChatAccount, redactChatAccount } from "./chat-account.js";
import { ConversationProvenanceDoc } from "./conversation-provenance.js";
import { safeHttpIri, sanitizeText } from "./iri.js";
import { storeToTurtle } from "./reconcile.js";
import { redactSecrets } from "./redact.js";
import { AS_COLLECTION, AS_NAME, DCT, PROV_ACTIVITY, PROV_AGENT, RDF_TYPE } from "./vocab.js";

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
  /** Delete only while the resource still has this ETag; reject a mismatch with status 412.
   * Needed only by {@link ChatWriter.migrateRedaction}. */
  delete?(url: string, cond: { ifMatch: string }): Promise<void>;
}

export const CHAT_PROVIDERS = ["claude", "chatgpt", "codex"] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];
export const CHAT_ROLES = ["system", "user", "assistant", "tool"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];
export const CHAT_CHANNELS = ["hook", "export", "mcp"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
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
  /** Owner-chosen label; source-derived IDs must be scoped with chatConversationId before save. */
  account?: string;
  /** Required on save; absent when reading legacy metadata. */
  channel?: ChatChannel;
  /** First writer creation time, returned on read; ignored on save. */
  generatedAtTime?: string;
}
export interface ChatSummary {
  url: string;
  provider: ChatProvider;
  conversationId: string;
  title: string;
  updatedAt?: string;
  account?: string;
  channel?: ChatChannel;
  generatedAtTime?: string;
}
export interface ChatListOptions {
  provider?: ChatProvider;
  account?: string;
  since?: string;
  /** Exclusive conversation URL from the previous page. */
  cursor?: string;
  limit?: number;
}
export interface ChatRedactionOptions {
  /** Count what would change without writing or deleting anything. */
  dryRun?: boolean;
}
/** Counts from {@link ChatWriter.migrateRedaction}; with `dryRun`, what would change. */
export interface ChatRedactionReport {
  dryRun: boolean;
  /** Conversations with metadata that were checked. */
  conversations: number;
  /** Conversation metadata rewritten in place for its title or account label. */
  titles: number;
  /** Messages with a source ID, rewritten in place under the same ID. */
  messagesRewritten: number;
  /** Messages whose ID came from their unredacted text. Each was replaced by the redacted
   * message under its new ID (or by the copy a replay already wrote), then deleted. */
  messagesReplaced: number;
  /** Resources that changed after they were read and were left alone. Run again. */
  conflicts: number;
  /** Conversations or messages that could not be checked or fixed (unreadable, malformed,
   * no ETag, or a failed request). The run carries on past them; fix and run again. */
  failed: number;
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
  private async createProtected(url: string, turtle: string): Promise<boolean> {
    const acl = await this.pod.discoverAcl(url);
    // Existing documents must be recognizable WAC, never ACP or another model.
    try {
      const existing = await this.dataset(acl);
      validateWacAcl(existing, url);
    } catch (error) {
      if (chatPortStatus(error) !== 404) throw error;
    }
    const store = new Store();
    const auth = new Authorization(`${acl}#owner`, store, DataFactory);
    auth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
    auth.accessTo = url;
    if (url.endsWith("/")) auth.default = url;
    auth.agent.add(this.owner);
    auth.canRead = true;
    auth.canWrite = true;
    auth.canReadWriteAcl = true;
    // No content is written until the owner-only ACL PUT succeeds. In particular,
    // never swallow ACL errors or fall back to inherited/public permissions.
    await this.pod.write(acl, encoder.encode(await storeToTurtle(store)), "text/turtle", {});
    const created = await this.create(url, turtle);
    if ((await this.pod.discoverAcl(url)) !== acl)
      throw new Error("Chat ACL association changed after resource creation");
    return created;
  }
  private async messageDocument(url: string, message: ChatMessage & { id: string }) {
    const resource = `${url}m-${message.id}.ttl`;
    const subject = `${resource}#it`;
    const store = buildAs2Message(subject, {
      id: subject,
      content: message.text,
      mediaType: "text/plain",
      published: message.createdAt,
      room: url,
      ...(message.role === "user" ? { author: this.owner } : {}),
    });
    const doc = new ChatDoc(subject, store, DataFactory);
    doc.identifier = message.id;
    doc.role = message.role;
    return { resource, turtle: await storeToTurtle(store) };
  }
  async save(
    conversation: ChatConversation,
  ): Promise<{ url: string; saved: number; skipped: number }> {
    const url = this.conversationUrl(conversation.provider, conversation.conversationId);
    const account = normalizeChatAccount(conversation.account);
    if (!CHAT_CHANNELS.includes(conversation.channel as ChatChannel))
      throw new TypeError("Unsupported chat capture channel");
    // Validate and serialize everything before the first write.
    const messages = await Promise.all(
      conversation.messages.map(async (message) => {
        if (!CHAT_ROLES.includes(message.role)) throw new TypeError("Unsupported chat role");
        // Redact before deriving the ID, so no stored value or name depends on a secret.
        const normalized = {
          ...message,
          // Strip control characters first: one inside a credential would defeat the pattern
          // and then be removed by the AS2 serializer, storing the plaintext secret.
          text: redactSecrets(sanitizeText(message.text)),
          createdAt: timestamp(message.createdAt),
        };
        const id = await messageId(normalized);
        return this.messageDocument(url, { ...normalized, id });
      }),
    );
    const metadata = new Store();
    const room = new ChatDoc(`${url}_conversation.ttl#it`, metadata, DataFactory);
    room.types.add(AS_COLLECTION);
    room.identifier = conversation.conversationId;
    room.title = redactSecrets(sanitizeText(conversation.title));
    const provenance = new ConversationProvenanceDoc(
      `${url}_conversation.ttl#it`,
      metadata,
      DataFactory,
    );
    provenance.generatedAt = new Date();
    const captureId = `${url}_conversation.ttl#capture`;
    provenance.generatedBy = captureId;
    const capture = new ConversationProvenanceDoc(captureId, metadata, DataFactory);
    capture.types.add(PROV_ACTIVITY);
    capture.channel = conversation.channel;
    if (account !== undefined) {
      const accountId = `${url}_conversation.ttl#account`;
      provenance.attributedTo = accountId;
      const agent = new ConversationProvenanceDoc(accountId, metadata, DataFactory);
      agent.types.add(PROV_AGENT);
      agent.accountName = redactChatAccount(account);
    }
    const roomTurtle = await storeToTurtle(metadata);
    for (const container of [this.base, `${this.base}${conversation.provider}/`, url]) {
      const containerStore = new Store();
      new ChatDoc(container, containerStore, DataFactory).types.add(
        "http://www.w3.org/ns/ldp#BasicContainer",
      );
      await this.createProtected(container, await storeToTurtle(containerStore));
    }
    await this.createProtected(`${url}_conversation.ttl`, roomTurtle);
    let saved = 0;
    for (const message of messages)
      if (await this.createProtected(message.resource, message.turtle)) saved++;
    return { url, saved, skipped: messages.length - saved };
  }
  private async dataset(url: string) {
    return (await this.document(url)).dataset;
  }
  private async document(url: string) {
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
    return {
      dataset: await parseRdf(decoder.decode(result.body), result.contentType, { baseIRI: url }),
      etag: result.etag,
    };
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
    const title = roomTitle(room, conversationId);
    const provenance = new ConversationProvenanceDoc(
      `${url}_conversation.ttl#it`,
      room.dataset,
      DataFactory,
    );
    const details: Pick<ChatConversation, "account" | "channel" | "generatedAtTime"> = {};
    if (provenance.generatedAt !== undefined)
      details.generatedAtTime = provenance.generatedAt.toISOString();
    if (provenance.attributedTo !== undefined) {
      if (provenance.attributedTo !== `${url}_conversation.ttl#account`)
        throw new Error("Invalid conversation account provenance");
      const account = new ConversationProvenanceDoc(
        provenance.attributedTo,
        room.dataset,
        DataFactory,
      );
      const label = normalizeChatAccount(account.accountName);
      if (!account.types.has(PROV_AGENT) || label === undefined)
        throw new Error("Invalid conversation account provenance");
      details.account = redactChatAccount(label);
    }
    if (provenance.generatedBy !== undefined) {
      if (provenance.generatedBy !== `${url}_conversation.ttl#capture`)
        throw new Error("Invalid conversation capture provenance");
      const capture = new ConversationProvenanceDoc(
        provenance.generatedBy,
        room.dataset,
        DataFactory,
      );
      if (
        !capture.types.has(PROV_ACTIVITY) ||
        !CHAT_CHANNELS.includes(capture.channel as ChatChannel)
      )
        throw new Error("Invalid conversation capture provenance");
      details.channel = capture.channel as ChatChannel;
    }
    const messages: (ChatMessage & { id: string })[] = [];
    const resources = await this.children(url);
    for (const child of resources) {
      if (!isMessageChild(url, child)) continue;
      messages.push(storedMessage(url, child.url, await this.dataset(child.url)));
    }
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return { url, provider, conversationId, title, messages, ...details };
  }
  private async conversationCandidates(providers: readonly ChatProvider[], cursor?: string) {
    const candidates: { provider: ChatProvider; id: string; url: string }[] = [];
    for (const provider of providers) {
      const parent = `${this.base}${provider}/`;
      for (const child of await this.children(parent)) {
        if (!child.isContainer || !child.url.startsWith(parent)) continue;
        const segment = child.url.slice(parent.length);
        if (!/^[a-zA-Z0-9_-]{1,200}\/$/.test(segment)) continue;
        if (cursor !== undefined && child.url <= cursor) continue;
        candidates.push({ provider, id: segment.slice(0, -1), url: child.url });
      }
    }
    return candidates.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  }
  async list(
    options: ChatListOptions = {},
  ): Promise<{ conversations: ChatSummary[]; nextCursor?: string }> {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new TypeError("limit must be 1–100");
    const since = options.since === undefined ? undefined : timestamp(options.since);
    const label = normalizeChatAccount(options.account);
    const account = label === undefined ? undefined : redactChatAccount(label);
    const providers =
      options.provider === undefined ? CHAT_PROVIDERS : [providerId(options.provider)];
    const candidates = await this.conversationCandidates(providers, options.cursor);
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
      if (account !== undefined && conversation.account !== account) continue;
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
        ...(conversation.account === undefined ? {} : { account: conversation.account }),
        ...(conversation.channel === undefined ? {} : { channel: conversation.channel }),
        ...(conversation.generatedAtTime === undefined
          ? {}
          : { generatedAtTime: conversation.generatedAtTime }),
        ...(updatedAt === undefined ? {} : { updatedAt }),
      });
    }
    return { conversations };
  }

  /**
   * Owner-run repair for chats stored before every save path redacted (sst-5ax.39).
   * Rewrites titles, account labels and messages whose stored text changes under
   * `redactSecrets`, using `If-Match` on every write and delete. A message named by a hash of
   * its unredacted text moves to the ID a redacted save derives: the redacted copy is created
   * owner-only (or a replay's matching copy is kept), then the legacy message is deleted.
   * Other messages are rewritten in place under their ID. One failing conversation or
   * message is counted in `failed` and the run carries on. Re-running is safe.
   */
  async migrateRedaction(options: ChatRedactionOptions = {}): Promise<ChatRedactionReport> {
    const dryRun = options.dryRun === true;
    if (!dryRun && typeof this.pod.delete !== "function")
      throw new TypeError("Chat redaction migration needs a pod port that can delete");
    const report: ChatRedactionReport = {
      dryRun,
      conversations: 0,
      titles: 0,
      messagesRewritten: 0,
      messagesReplaced: 0,
      conflicts: 0,
      failed: 0,
    };
    const count = (fixed: boolean, key: "titles" | "messagesRewritten" | "messagesReplaced") => {
      if (fixed) report[key]++;
      else report.conflicts++;
    };
    for (const candidate of await this.conversationCandidates(CHAT_PROVIDERS)) {
      report.conversations++;
      let captureWritten: boolean;
      try {
        captureWritten = await this.migrateMetadata(candidate, dryRun, count, () => {
          report.failed++;
        });
      } catch {
        // Content-free: the report never carries URLs, IDs or remote errors.
        report.failed++;
        continue;
      }
      let children: { url: string; isContainer: boolean }[];
      try {
        children = (await this.children(candidate.url)).filter((child) =>
          isMessageChild(candidate.url, child),
        );
      } catch {
        report.failed++;
        continue;
      }
      const listed = new Set(children.map((child) => child.url));
      for (const child of children) {
        try {
          await this.migrateMessage(
            candidate.url,
            child.url,
            listed,
            captureWritten,
            dryRun,
            count,
          );
        } catch {
          report.failed++;
        }
      }
    }
    return report;
  }
  /** Re-redact a conversation's title and account label. True when capture wrote it. */
  private async migrateMetadata(
    candidate: { id: string; url: string },
    dryRun: boolean,
    count: (fixed: boolean, key: "titles") => void,
    failed: () => void,
  ): Promise<boolean> {
    const metadataUrl = `${candidate.url}_conversation.ttl`;
    let metadata: Awaited<ReturnType<ChatWriter["document"]>>;
    try {
      metadata = await this.document(metadataUrl);
    } catch (error) {
      // An interrupted save leaves messages without metadata; still repair the messages.
      if (chatPortStatus(error) === 404) return isHashName(candidate.id);
      throw error;
    }
    const room = new ChatDoc(`${metadataUrl}#it`, metadata.dataset, DataFactory);
    const title = roomTitle(room, candidate.id);
    const provenance = new ConversationProvenanceDoc(
      `${metadataUrl}#it`,
      metadata.dataset,
      DataFactory,
    );
    const capture =
      provenance.generatedBy === `${metadataUrl}#capture`
        ? new ConversationProvenanceDoc(provenance.generatedBy, metadata.dataset, DataFactory)
        : undefined;
    const channel = capture?.channel;
    let changed = false;
    const redactedTitle = redactSecrets(sanitizeText(title));
    if (redactedTitle !== title) {
      room.title = redactedTitle;
      changed = true;
    }
    if (provenance.attributedTo === `${metadataUrl}#account`) {
      const agent = new ConversationProvenanceDoc(
        provenance.attributedTo,
        metadata.dataset,
        DataFactory,
      );
      const label = agent.accountName;
      const normalized = label === undefined ? undefined : normalizeChatAccount(label);
      if (normalized !== undefined && redactChatAccount(normalized) !== label) {
        agent.accountName = redactChatAccount(normalized);
        changed = true;
      }
    }
    if (changed) {
      try {
        count(
          dryRun ||
            (await this.replace(metadataUrl, await storeToTurtle(metadata.dataset), metadata.etag)),
          "titles",
        );
      } catch {
        // A failed metadata write must not stop the conversation's messages being repaired.
        failed();
      }
    }
    // Capture always passes source IDs (hash-shaped digests) and redacted before saving;
    // legacy capture metadata has no channel but a hash-shaped conversation ID.
    return (
      channel === "hook" ||
      channel === "export" ||
      (channel === undefined && isHashName(candidate.id))
    );
  }
  private async migrateMessage(
    url: string,
    resource: string,
    listed: Set<string>,
    captureWritten: boolean,
    dryRun: boolean,
    count: (fixed: boolean, key: "messagesRewritten" | "messagesReplaced") => void,
  ): Promise<void> {
    let stored: Awaited<ReturnType<ChatWriter["document"]>>;
    try {
      stored = await this.document(resource);
    } catch (error) {
      // Deleted since listing, for example by a concurrent migration.
      if (chatPortStatus(error) === 404) return;
      throw error;
    }
    const message = storedMessage(url, resource, stored.dataset);
    const text = redactSecrets(sanitizeText(message.text));
    if (text === message.text) return;
    if (stored.etag === undefined) throw missingEtag();
    const redacted = { role: message.role, text, createdAt: message.createdAt };
    const derived =
      (await messageId({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      })) === message.id;
    // Before control characters were stripped first, an ID-less message's name hashed its raw
    // text, which the serializer then cleaned, so the name no longer matches the stored text.
    // Any hash-shaped name outside capture is treated as such a legacy name.
    if (!derived && (captureWritten || !isHashName(message.id))) {
      if (!dryRun) {
        const next = await this.messageDocument(url, { ...redacted, id: message.id });
        count(await this.replace(resource, next.turtle, stored.etag), "messagesRewritten");
      } else count(true, "messagesRewritten");
      return;
    }
    const replayId = await messageId(redacted);
    const replay = `${url}m-${replayId}.ttl`;
    if (listed.has(replay)) {
      // A replay already wrote the redacted copy; check it before deleting the original.
      await this.requireCopy(url, replay, redacted);
    } else if (!dryRun) {
      const next = await this.messageDocument(url, { ...redacted, id: replayId });
      // false means a concurrent writer created it first; check that copy too.
      if (!(await this.createProtected(next.resource, next.turtle)))
        await this.requireCopy(url, replay, redacted);
    }
    count(dryRun || (await this.remove(resource, stored.etag)), "messagesReplaced");
  }
  private async requireCopy(url: string, resource: string, expected: Omit<ChatMessage, "id">) {
    const copy = storedMessage(url, resource, await this.dataset(resource));
    if (
      copy.role !== expected.role ||
      copy.text !== expected.text ||
      copy.createdAt !== expected.createdAt
    )
      throw new Error("Invalid stored chat message");
  }
  /** Conditional in-place rewrite; existing ACLs are untouched. False on a 412. */
  private async replace(url: string, turtle: string, etag: string | undefined): Promise<boolean> {
    if (etag === undefined) throw missingEtag();
    try {
      await this.pod.write(url, encoder.encode(turtle), "text/turtle", { ifMatch: etag });
      return true;
    } catch (error) {
      if (chatPortStatus(error) === 412) return false;
      throw error;
    }
  }
  /** Conditional delete; true when the resource is gone, false on a 412. */
  private async remove(url: string, etag: string | undefined): Promise<boolean> {
    if (etag === undefined) throw missingEtag();
    const remove = this.pod.delete;
    if (remove === undefined)
      throw new TypeError("Chat redaction migration needs a pod port that can delete");
    try {
      await remove.call(this.pod, url, { ifMatch: etag });
      return true;
    } catch (error) {
      const status = chatPortStatus(error);
      if (status === 404) return true;
      if (status === 412) return false;
      throw error;
    }
  }
}

function isHashName(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function missingEtag(): Error {
  return new Error("Chat redaction migration needs an ETag for each conditional write");
}

function roomTitle(room: ChatDoc, conversationId: string): string {
  const title = room.title;
  if (!room.types.has(AS_COLLECTION) || room.identifier !== conversationId || title === undefined)
    throw new Error("Invalid conversation metadata");
  return title;
}

/** Only immediate, generated message names; poisoned listings cannot steer reads. */
function isMessageChild(url: string, child: { url: string; isContainer: boolean }): boolean {
  return (
    !child.isContainer &&
    child.url.startsWith(url) &&
    /^m-[a-zA-Z0-9_-]{1,200}\.ttl$/.test(child.url.slice(url.length))
  );
}

function storedMessage(
  url: string,
  resource: string,
  dataset: DatasetCore,
): ChatMessage & { id: string } {
  const subject = `${resource}#it`;
  const canonical = parseAs2Message(subject, dataset);
  const doc = new ChatDoc(subject, dataset, DataFactory);
  const id = doc.identifier;
  const role = doc.role as ChatRole;
  if (
    !canonical ||
    !id ||
    resource !== `${url}m-${identifier(id)}.ttl` ||
    !CHAT_ROLES.includes(role) ||
    !canonical.published ||
    canonical.room !== url
  ) {
    throw new Error("Invalid stored chat message");
  }
  return { id, role, text: canonical.content, createdAt: canonical.published };
}

/** Validate that an ACL can be replaced for this resource without changing another's grants. */
export function validateWacAcl(existing: DatasetCore, url: string): void {
  // Reject ACP even when a document also happens to contain WAC authorizations.
  if (
    [...existing].some((quad) =>
      [quad.subject, quad.predicate, quad.object].some(
        (term) =>
          term.termType === "NamedNode" && term.value.startsWith("http://www.w3.org/ns/solid/acp#"),
      ),
    )
  )
    throw new Error("Unsupported access-control model: ACP");
  const authorizations = [...new AclResource(existing, DataFactory).authorizations];
  if (existing.size > 0 && authorizations.length === 0)
    throw new Error("Unsupported chat access-control model");
  // Replacing a shared ACL would remove grants for other resources. Inspect
  // every scope value: Authorization's optional getters are single-valued.
  for (const authorization of authorizations) {
    for (const predicate of ["accessTo", "default"]) {
      const targets = SetFrom.subjectPredicate(
        authorization,
        `http://www.w3.org/ns/auth/acl#${predicate}`,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      );
      if ([...targets].some((target) => target !== url))
        throw new Error("Shared chat ACL documents cannot be replaced");
    }
  }
}
