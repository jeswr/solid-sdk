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
import { safeHttpIri, sanitizeText } from "./iri.js";
import { storeToTurtle } from "./reconcile.js";
import { redactSecrets } from "./redact.js";
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
        const doc = new As2MessageDoc(subject, store, DataFactory);
        doc.identifier = id;
        doc.role = message.role;
        return { resource, turtle: await storeToTurtle(store) };
      }),
    );
    const metadata = buildConversation(`${url}_conversation.ttl#it`, {
      identifier: conversation.conversationId,
      title: redactSecrets(sanitizeText(conversation.title)),
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
      const doc = new As2MessageDoc(subject, dataset, DataFactory);
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
    return { url, provider, conversationId, title: room.title, messages, ...details };
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
