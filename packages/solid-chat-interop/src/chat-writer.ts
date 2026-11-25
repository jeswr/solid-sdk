// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { As2MessageDoc, buildAs2Message, parseAs2Message } from "./as2.js";
import { normalizeChatAccount, redactChatAccount } from "./chat-account.js";
import { buildConversation, parseConversation } from "./conversation.js";
import { ConversationProvenanceDoc } from "./conversation-provenance.js";
import { entities } from "./generated/model.js";
import { safeHttpIri } from "./iri.js";
import { storeToTurtle } from "./reconcile.js";
import { redactConversation } from "./redact.js";
import { PROV_ACTIVITY, PROV_AGENT, RDF_TYPE } from "./vocab.js";

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

/** Build the owner-only WAC dataset shared by ChatWriter and validating ports.
 * Containers inherit Read, Write and Control through acl:default; files use only acl:accessTo.
 * The caller must discover and validate the ACL association and enforce conditional persistence. */
export function ownerOnlyChatAcl(acl: string, target: string, owner: string): Store {
  const store = new Store();
  const auth = new Authorization(`${acl}#owner`, store, DataFactory);
  auth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
  auth.accessTo = target;
  if (target.endsWith("/")) auth.default = target;
  auth.agent.add(owner);
  auth.canRead = true;
  auth.canWrite = true;
  auth.canReadWriteAcl = true;
  return store;
}

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
    const store = ownerOnlyChatAcl(acl, url, this.owner);
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
    const doc = new As2MessageDoc(subject, store, DataFactory);
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
    conversation = redactConversation(conversation);
    const messages = await Promise.all(
      conversation.messages.map(async (message) => {
        if (!CHAT_ROLES.includes(message.role)) throw new TypeError("Unsupported chat role");
        // Redact before deriving the ID, so no stored value or name depends on a secret.
        const normalized = {
          ...message,
          createdAt: timestamp(message.createdAt),
        };
        const id = await messageId(normalized);
        return this.messageDocument(url, { ...normalized, id });
      }),
    );
    const metadata = buildConversation(`${url}_conversation.ttl#it`, {
      identifier: conversation.conversationId,
      title: conversation.title,
    });
    // Provenance (sst-5ax.31) stays a typed view over the same metadata document.
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
      // Container infrastructure is not part of the canonical message model.
      SetFrom.subjectPredicate(
        new TermWrapper(container, containerStore, DataFactory),
        RDF_TYPE,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      ).add("http://www.w3.org/ns/ldp#BasicContainer");
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
    return this.readConversation(provider, conversationId, await this.dataset(metadataUrl));
  }
  private async readConversation(
    provider: ChatProvider,
    conversationId: string,
    dataset: DatasetCore,
  ) {
    const url = this.conversationUrl(provider, conversationId);
    const room = parseConversation(`${url}_conversation.ttl#it`, dataset);
    if (!room || room.identifier !== conversationId) {
      throw new Error("Invalid conversation metadata");
    }
    const title = room.title;
    const provenance = new ConversationProvenanceDoc(
      `${url}_conversation.ttl#it`,
      dataset,
      DataFactory,
    );
    const details: Pick<ChatConversation, "account" | "channel" | "generatedAtTime"> = {};
    if (provenance.generatedAt !== undefined)
      details.generatedAtTime = provenance.generatedAt.toISOString();
    if (provenance.attributedTo !== undefined) {
      if (provenance.attributedTo !== `${url}_conversation.ttl#account`)
        throw new Error("Invalid conversation account provenance");
      const account = new ConversationProvenanceDoc(provenance.attributedTo, dataset, DataFactory);
      const label = normalizeChatAccount(account.accountName);
      if (!account.types.has(PROV_AGENT) || label === undefined)
        throw new Error("Invalid conversation account provenance");
      details.account = redactChatAccount(label);
    }
    if (provenance.generatedBy !== undefined) {
      if (provenance.generatedBy !== `${url}_conversation.ttl#capture`)
        throw new Error("Invalid conversation capture provenance");
      const capture = new ConversationProvenanceDoc(provenance.generatedBy, dataset, DataFactory);
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
      const conversation = await this.readConversation(candidate.provider, candidate.id, metadata);
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
   * Redacts each conversation exactly as {@link ChatWriter.save} would: title and messages
   * together through `redactConversation`, in stored order (`createdAt`, then ID), so secrets
   * spanning fields are caught and derived IDs match a replayed save. Uses `If-Match` on
   * every write and delete. A message named by a hash of its unredacted text moves to the ID
   * a redacted save derives: the redacted copy is created owner-only (or a replay's matching
   * copy is kept), then the legacy message is deleted. Other messages are rewritten in place
   * under their ID. Metadata that cannot be read or validated counts as `failed` but never
   * stops the conversation's messages being repaired. One failing conversation or message is
   * counted in `failed` and the run carries on. Re-running is safe.
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
      // Content-free: the report never carries URLs, IDs or remote errors.
      const failed = () => {
        report.failed++;
      };
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
      const stored: StoredMessage[] = [];
      for (const child of children) {
        try {
          stored.push(await this.readStoredMessage(candidate.url, child.url));
        } catch (error) {
          // Deleted since listing, for example by a concurrent migration.
          if (chatPortStatus(error) !== 404) report.failed++;
        }
      }
      stored.sort(
        (a, b) =>
          a.message.createdAt.localeCompare(b.message.createdAt) ||
          a.message.id.localeCompare(b.message.id),
      );
      const metadata = await this.readMigrationMetadata(candidate, failed);
      const redacted = redactConversation({
        provider: candidate.provider,
        conversationId: candidate.id,
        title: metadata.title ?? "",
        messages: stored.map(({ message }) => ({
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
        })),
      });
      await this.migrateMetadata(metadata, redacted.title, dryRun, count, failed);
      for (const [index, entry] of stored.entries()) {
        try {
          await this.migrateMessage(
            candidate.url,
            entry,
            (redacted.messages[index] as ChatMessage).text,
            listed,
            metadata.captureWritten,
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
  private async readStoredMessage(url: string, resource: string): Promise<StoredMessage> {
    const stored = await this.document(resource);
    const message = storedMessage(url, resource, stored.dataset);
    // save() hashes the canonical timestamp; an unparseable one cannot be given a replay ID.
    return {
      resource,
      etag: stored.etag,
      dataset: stored.dataset,
      message,
      createdAt: timestamp(message.createdAt),
    };
  }
  /** Read a conversation's metadata for repair. Missing, unreadable or invalid metadata
   * leaves `document` unset (the latter two count as failed) so its messages are still
   * repaired. `captureWritten` is true when capture wrote the conversation. */
  private async readMigrationMetadata(
    candidate: { id: string; url: string },
    failed: () => void,
  ): Promise<MigrationMetadata> {
    const metadataUrl = `${candidate.url}_conversation.ttl`;
    const fallback = { captureWritten: isHashName(candidate.id) };
    let document: Awaited<ReturnType<ChatWriter["document"]>>;
    try {
      document = await this.document(metadataUrl);
    } catch (error) {
      // An interrupted save leaves messages without metadata; still repair the messages.
      if (chatPortStatus(error) !== 404) failed();
      return fallback;
    }
    let title: string;
    let channel: string | undefined;
    try {
      title = roomTitle(`${metadataUrl}#it`, document.dataset, candidate.id);
      const provenance = new ConversationProvenanceDoc(
        `${metadataUrl}#it`,
        document.dataset,
        DataFactory,
      );
      channel =
        provenance.generatedBy === `${metadataUrl}#capture`
          ? new ConversationProvenanceDoc(provenance.generatedBy, document.dataset, DataFactory)
              .channel
          : undefined;
    } catch {
      // Invalid title, identifier or provenance: the metadata is left as it is.
      failed();
      return fallback;
    }
    // Capture always passes source IDs (hash-shaped digests) and redacted before saving;
    // legacy capture metadata has no channel but a hash-shaped conversation ID.
    return {
      document,
      metadataUrl,
      title,
      captureWritten:
        channel === "hook" ||
        channel === "export" ||
        (channel === undefined && isHashName(candidate.id)),
    };
  }
  /** Write the redacted title and account label back. An account label that fails
   * validation may still hold a secret, so it is replaced by a bare marker. */
  private async migrateMetadata(
    metadata: MigrationMetadata,
    redactedTitle: string,
    dryRun: boolean,
    count: (fixed: boolean, key: "titles") => void,
    failed: () => void,
  ): Promise<void> {
    const { document, metadataUrl, title } = metadata;
    if (document === undefined || metadataUrl === undefined || title === undefined) return;
    const room = new entities.Conversation.Wrapper(
      `${metadataUrl}#it`,
      document.dataset,
      DataFactory,
    );
    const provenance = new ConversationProvenanceDoc(
      `${metadataUrl}#it`,
      document.dataset,
      DataFactory,
    );
    let changed = false;
    if (redactedTitle !== title) {
      room.title = redactedTitle;
      changed = true;
    }
    if (provenance.attributedTo === `${metadataUrl}#account`) {
      const agent = new ConversationProvenanceDoc(
        provenance.attributedTo,
        document.dataset,
        DataFactory,
      );
      const label = agent.accountName;
      let replacement: string | undefined;
      try {
        const normalized = label === undefined ? undefined : normalizeChatAccount(label);
        if (normalized !== undefined) replacement = redactChatAccount(normalized);
      } catch {
        replacement = "[REDACTED]";
      }
      if (replacement !== undefined && replacement !== label) {
        agent.accountName = replacement;
        changed = true;
      }
    }
    if (!changed) return;
    try {
      count(
        dryRun ||
          (await this.replace(metadataUrl, await storeToTurtle(document.dataset), document.etag)),
        "titles",
      );
    } catch {
      // A failed metadata write must not stop the conversation's messages being repaired.
      failed();
    }
  }
  private async migrateMessage(
    url: string,
    entry: StoredMessage,
    text: string,
    listed: Set<string>,
    captureWritten: boolean,
    dryRun: boolean,
    count: (fixed: boolean, key: "messagesRewritten" | "messagesReplaced") => void,
  ): Promise<void> {
    const { message, resource, etag } = entry;
    if (text === message.text) return;
    if (etag === undefined) throw missingEtag();
    const redacted = { role: message.role, text, createdAt: entry.createdAt };
    const derived =
      (await messageId({ role: message.role, text: message.text, createdAt: entry.createdAt })) ===
        message.id ||
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
        count(await this.replace(resource, next.turtle, etag), "messagesRewritten");
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
    count(dryRun || (await this.remove(resource, etag)), "messagesReplaced");
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

interface StoredMessage {
  resource: string;
  etag: string | undefined;
  dataset: DatasetCore;
  message: ChatMessage & { id: string };
  /** Canonical timestamp, as save() hashes it. */
  createdAt: string;
}
interface MigrationMetadata {
  document?: Awaited<ReturnType<ChatWriter["document"]>>;
  metadataUrl?: string;
  /** Validated stored title; unset when the metadata is missing or invalid. */
  title?: string;
  captureWritten: boolean;
}

function isHashName(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function missingEtag(): Error {
  return new Error("Chat redaction migration needs an ETag for each conditional write");
}

function roomTitle(subject: string, dataset: DatasetCore, conversationId: string): string {
  const room = parseConversation(subject, dataset);
  if (!room || room.identifier !== conversationId) throw new Error("Invalid conversation metadata");
  return room.title;
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
  const doc = new As2MessageDoc(subject, dataset, DataFactory);
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
