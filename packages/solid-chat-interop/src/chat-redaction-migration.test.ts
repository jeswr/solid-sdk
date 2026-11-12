// AUTHORED-BY Claude Opus 5.5
// sst-5ax.39: chats saved before every path redacted are found and fixed, with no duplicates.
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { type ChatConversation, type ChatPodPort, ChatWriter } from "./chat-writer.js";

const ROOT = "https://alice.example/pod/";
const OWNER = `${ROOT}profile/card#me`;
const CHAT = `${ROOT}private/chats/claude/thread-1/`;
const DAY1 = "2026-10-24T12:00:00.000Z";
const DAY2 = "2026-10-25T12:00:00.000Z";
const TOKEN = "ghp_fixtureMigrationToken123";
const PLACEHOLDER = "XXPLACEHOLDERXX";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}
function etagOf(body: Uint8Array): string {
  let hash = 5381;
  for (const byte of body) hash = (hash * 33 + byte) >>> 0;
  return `"${body.length}-${hash.toString(16)}"`;
}
async function derivedId(role: string, text: string, createdAt: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify([role, text, createdAt])),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strong content ETags, conditional writes and deletes, like a Solid server. */
class EtagPod implements ChatPodPort {
  root = ROOT;
  webId = OWNER;
  resources = new Map<string, { body: Uint8Array; contentType: string }>();
  writes: { url: string; cond: { ifMatch?: string; ifNoneMatch?: "*" } }[] = [];
  deletes: { url: string; ifMatch: string }[] = [];
  etags = true;
  fail = new Map<string, number>();
  async discoverAcl(url: string) {
    return `${url}.acl`;
  }
  async read(url: string) {
    const resource = this.resources.get(url);
    if (!resource) throw httpError(404);
    return { ...resource, ...(this.etags ? { etag: etagOf(resource.body) } : {}) };
  }
  async list(container: string) {
    return [...this.resources.keys()]
      .filter(
        (url) =>
          url.startsWith(container) &&
          url !== container &&
          !url.slice(container.length).replace(/\/$/, "").includes("/"),
      )
      .map((url) => ({ url, isContainer: url.endsWith("/") }));
  }
  private check(url: string, ifMatch?: string) {
    const status = this.fail.get(url);
    if (status !== undefined) throw httpError(status);
    if (ifMatch === undefined) return;
    const current = this.resources.get(url);
    if (!current || etagOf(current.body) !== ifMatch) throw httpError(412);
  }
  async write(
    url: string,
    body: Uint8Array,
    contentType: string,
    cond: { ifMatch?: string; ifNoneMatch?: "*" },
  ) {
    this.writes.push({ url, cond });
    this.check(url, cond.ifMatch);
    if (cond.ifNoneMatch === "*" && this.resources.has(url)) throw httpError(412);
    this.resources.set(url, { body, contentType });
    return {};
  }
  async delete(url: string, cond: { ifMatch: string }) {
    this.deletes.push({ url, ifMatch: cond.ifMatch });
    if (!this.resources.has(url)) throw httpError(404);
    this.check(url, cond.ifMatch);
    // Solid servers delete a resource's auxiliary resources with it.
    this.resources.delete(url);
    this.resources.delete(`${url}.acl`);
  }
  text(url: string): string {
    const resource = this.resources.get(url);
    if (!resource) throw new Error(`missing ${url}`);
    return decoder.decode(resource.body);
  }
  set(url: string, text: string) {
    this.resources.set(url, { body: encoder.encode(text), contentType: "text/turtle" });
  }
  everything(): string {
    return [...this.resources.values()].map((r) => decoder.decode(r.body)).join("\n");
  }
}

const RAW_TITLE = `Deploy with ${TOKEN}`;
const RAW_DERIVED = `Use ${TOKEN} now`;
const RAW_SOURCE = `Saved ${TOKEN} for later`;
function raw(): ChatConversation {
  return {
    provider: "claude",
    conversationId: "thread-1",
    title: RAW_TITLE,
    channel: "mcp",
    messages: [
      { role: "user", text: RAW_DERIVED, createdAt: DAY1 },
      { id: "msg-2", role: "assistant", text: RAW_SOURCE, createdAt: DAY2 },
    ],
  };
}

/**
 * Store a chat exactly as the writer did before redaction: verbatim title and text, and an
 * ID-less message named by the digest of its unredacted text. The current writer saves a
 * placeholder, then the fixture swaps the secret back in and renames the derived message.
 */
async function legacyPod(): Promise<{ pod: EtagPod; legacy: string }> {
  const pod = new EtagPod();
  const placeholder = raw();
  placeholder.title = placeholder.title.replace(TOKEN, PLACEHOLDER);
  placeholder.messages = placeholder.messages.map((m) => ({
    ...m,
    text: m.text.replace(TOKEN, PLACEHOLDER),
  }));
  await new ChatWriter(pod).save(placeholder);
  for (const url of [...pod.resources.keys()])
    if (url.startsWith(CHAT) && !url.endsWith(".acl"))
      pod.set(url, pod.text(url).replaceAll(PLACEHOLDER, TOKEN));
  const placeholderId = await derivedId("user", RAW_DERIVED.replace(TOKEN, PLACEHOLDER), DAY1);
  const legacyId = await derivedId("user", RAW_DERIVED, DAY1);
  const from = `${CHAT}m-${placeholderId}.ttl`;
  const legacy = `${CHAT}m-${legacyId}.ttl`;
  for (const [a, b] of [
    [from, legacy],
    [`${from}.acl`, `${legacy}.acl`],
  ] as const) {
    pod.set(b, pod.text(a).replaceAll(placeholderId, legacyId));
    pod.resources.delete(a);
  }
  return { pod, legacy };
}

describe("ChatWriter.migrateRedaction (sst-5ax.39)", () => {
  it("fixture: the legacy chat holds the secret verbatim under a digest of it", async () => {
    const { pod, legacy } = await legacyPod();
    expect(pod.everything()).toContain(TOKEN);
    const chat = await new ChatWriter(pod).get("claude", "thread-1");
    expect(chat.title).toBe(RAW_TITLE);
    expect(chat.messages.map((m) => m.text)).toEqual([RAW_DERIVED, RAW_SOURCE]);
    expect(chat.messages[0]?.id).toBe(legacy.slice(`${CHAT}m-`.length, -".ttl".length));
  });

  it("reports what a dry run would fix without writing or deleting", async () => {
    const { pod } = await legacyPod();
    const before = new Map(pod.resources);
    pod.writes = [];
    const report = await new ChatWriter(pod).migrateRedaction({ dryRun: true });
    expect(report).toEqual({
      dryRun: true,
      conversations: 1,
      titles: 1,
      messagesRewritten: 1,
      messagesReplaced: 1,
      conflicts: 0,
    });
    expect(pod.writes).toEqual([]);
    expect(pod.deletes).toEqual([]);
    expect(pod.resources).toEqual(before);
  });

  it("redacts titles and messages with conditional writes, leaving no secret and no duplicate", async () => {
    const { pod, legacy } = await legacyPod();
    pod.writes = [];
    const writer = new ChatWriter(pod);
    expect(await writer.migrateRedaction()).toEqual({
      dryRun: false,
      conversations: 1,
      titles: 1,
      messagesRewritten: 1,
      messagesReplaced: 1,
      conflicts: 0,
    });
    expect(pod.everything()).not.toContain(TOKEN);
    expect([...pod.resources.keys()].join("\n")).not.toContain(TOKEN);
    // Every in-place rewrite and delete was conditional on what was read.
    for (const write of pod.writes)
      if (!write.url.endsWith(".acl"))
        expect(write.cond.ifMatch ?? write.cond.ifNoneMatch).toBeTruthy();
    expect(pod.deletes).toEqual([{ url: legacy, ifMatch: expect.stringMatching(/^"/) }]);
    expect(pod.resources.has(legacy)).toBe(false);
    expect(pod.resources.has(`${legacy}.acl`)).toBe(false);

    const chat = await writer.get("claude", "thread-1");
    expect(chat.title).toBe("Deploy with [REDACTED TOKEN]");
    expect(chat.messages).toEqual([
      {
        id: await derivedId("user", "Use [REDACTED TOKEN] now", DAY1),
        role: "user",
        text: "Use [REDACTED TOKEN] now",
        createdAt: DAY1,
      },
      { id: "msg-2", role: "assistant", text: "Saved [REDACTED TOKEN] for later", createdAt: DAY2 },
    ]);
    // Provenance survives the title rewrite.
    expect(chat.channel).toBe("mcp");
    expect(chat.generatedAtTime).toBeDefined();

    // The moved message got its own owner-only ACL before its content.
    const moved = `${CHAT}m-${chat.messages[0]?.id}.ttl`;
    const aclWrite = pod.writes.findIndex((w) => w.url === `${moved}.acl`);
    expect(aclWrite).toBeGreaterThanOrEqual(0);
    expect(aclWrite).toBeLessThan(pod.writes.findIndex((w) => w.url === moved));
    const acl = await parseRdf(pod.text(`${moved}.acl`), "text/turtle", {
      baseIRI: `${moved}.acl`,
    });
    const authorizations = [...new AclResource(acl, DataFactory).authorizations];
    expect(authorizations).toHaveLength(1);
    expect([...(authorizations[0]?.agent ?? [])]).toEqual([OWNER]);
    // The rewritten message keeps its original ACL untouched.
    expect(pod.writes.some((w) => w.url === `${CHAT}m-msg-2.ttl.acl`)).toBe(false);

    // A replay of the original conversation now writes nothing new.
    expect(await writer.save(raw())).toMatchObject({ saved: 0, skipped: 2 });
    expect((await writer.get("claude", "thread-1")).messages).toHaveLength(2);
    // Re-running finds nothing left to fix.
    expect(await writer.migrateRedaction()).toMatchObject({
      titles: 0,
      messagesRewritten: 0,
      messagesReplaced: 0,
      conflicts: 0,
    });
  });

  it("deletes a legacy message when a replay already wrote its redacted copy", async () => {
    const { pod, legacy } = await legacyPod();
    const writer = new ChatWriter(pod);
    // The duplicate the conversation-archive ADR describes: replay beside the legacy record.
    expect(await writer.save(raw())).toMatchObject({ saved: 1, skipped: 1 });
    expect((await writer.get("claude", "thread-1")).messages).toHaveLength(3);
    const replay = `${CHAT}m-${await derivedId("user", "Use [REDACTED TOKEN] now", DAY1)}.ttl`;
    const replayBody = pod.text(replay);
    pod.writes = [];
    expect(await writer.migrateRedaction()).toMatchObject({
      messagesReplaced: 1,
      messagesRewritten: 1,
    });
    expect(pod.resources.has(legacy)).toBe(false);
    // The replay's copy is kept as it was, not rewritten.
    expect(pod.text(replay)).toBe(replayBody);
    expect(pod.writes.some((w) => w.url.startsWith(replay))).toBe(false);
    const chat = await writer.get("claude", "thread-1");
    expect(chat.messages.map((m) => m.text)).toEqual([
      "Use [REDACTED TOKEN] now",
      "Saved [REDACTED TOKEN] for later",
    ]);
  });

  it("deletes a source-ID message that duplicates an existing redacted copy", async () => {
    const pod = new EtagPod();
    const writer = new ChatWriter(pod);
    // An ID-less save of the same message already exists, redacted, beside a legacy source-ID one.
    await writer.save({
      ...raw(),
      messages: [{ role: "assistant", text: RAW_SOURCE, createdAt: DAY2 }],
    });
    await writer.save({
      ...raw(),
      messages: [{ id: "msg-2", role: "assistant", text: PLACEHOLDER, createdAt: DAY2 }],
    });
    pod.set(`${CHAT}m-msg-2.ttl`, pod.text(`${CHAT}m-msg-2.ttl`).replace(PLACEHOLDER, RAW_SOURCE));
    expect((await writer.get("claude", "thread-1")).messages).toHaveLength(2);
    expect(await writer.migrateRedaction()).toMatchObject({
      messagesReplaced: 1,
      messagesRewritten: 0,
    });
    expect(pod.resources.has(`${CHAT}m-msg-2.ttl`)).toBe(false);
    expect((await writer.get("claude", "thread-1")).messages.map((m) => m.text)).toEqual([
      "Saved [REDACTED TOKEN] for later",
    ]);
  });

  it("counts a resource that changed after it was read as a conflict and leaves it", async () => {
    const { pod, legacy } = await legacyPod();
    pod.fail.set(`${CHAT}m-msg-2.ttl`, 412);
    pod.fail.set(legacy, 412);
    pod.fail.set(`${CHAT}_conversation.ttl`, 412);
    const writer = new ChatWriter(pod);
    expect(await writer.migrateRedaction()).toMatchObject({
      titles: 0,
      messagesRewritten: 0,
      messagesReplaced: 0,
      conflicts: 3,
    });
    expect(pod.resources.has(legacy)).toBe(true);
    pod.fail.clear();
    // The redacted copy was created before the failed delete; a re-run removes the original.
    expect(await writer.migrateRedaction()).toMatchObject({
      titles: 1,
      messagesRewritten: 1,
      messagesReplaced: 1,
      conflicts: 0,
    });
    expect(pod.everything()).not.toContain(TOKEN);
    expect((await writer.get("claude", "thread-1")).messages).toHaveLength(2);
  });

  it("propagates other failures instead of skipping", async () => {
    const { pod } = await legacyPod();
    pod.fail.set(`${CHAT}m-msg-2.ttl`, 403);
    await expect(new ChatWriter(pod).migrateRedaction()).rejects.toMatchObject({ status: 403 });
  });

  it("refuses to write without ETags or without a delete capability", async () => {
    const { pod } = await legacyPod();
    pod.etags = false;
    pod.writes = [];
    await expect(new ChatWriter(pod).migrateRedaction()).rejects.toThrow(/ETag/);
    expect(pod.writes).toEqual([]);
    pod.etags = true;
    const noDelete: ChatPodPort = {
      root: pod.root,
      webId: pod.webId,
      read: (url) => pod.read(url),
      list: (url) => pod.list(url),
      discoverAcl: (url) => pod.discoverAcl(url),
      write: (...args) => pod.write(...args),
    };
    await expect(new ChatWriter(noDelete).migrateRedaction()).rejects.toThrow(/delete/);
    expect(await new ChatWriter(noDelete).migrateRedaction({ dryRun: true })).toMatchObject({
      titles: 1,
    });
  });

  it("rejects a malformed stored message and an inconsistent replay copy", async () => {
    const { pod, legacy } = await legacyPod();
    const writer = new ChatWriter(pod);
    await writer.save(raw());
    const replay = `${CHAT}m-${await derivedId("user", "Use [REDACTED TOKEN] now", DAY1)}.ttl`;
    pod.set(replay, pod.text(replay).replace("Use [REDACTED TOKEN] now", "Something else"));
    await expect(writer.migrateRedaction()).rejects.toThrow(/stored chat/);
    expect(pod.resources.has(legacy)).toBe(true);
    pod.set(legacy, "");
    await expect(writer.migrateRedaction({ dryRun: true })).rejects.toThrow(/stored chat/);
  });
});
