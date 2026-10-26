// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { type ChatConversation, type ChatPodPort, ChatWriter } from "./chat-writer.js";
import { parseAs2, storeToTurtle } from "./reconcile.js";

const ROOT = "https://alice.example/pod/";
const OWNER = `${ROOT}profile/card#me`;
const DAY1 = "2026-10-24T12:00:00.000Z";
const DAY2 = "2026-10-25T12:00:00.000Z";
const CONTENT_FILES = ["_conversation.ttl", "m-msg-1.ttl"];
const decoder = new TextDecoder();
function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

class MemoryPod implements ChatPodPort {
  root = ROOT;
  webId = OWNER;
  resources = new Map<string, { body: Uint8Array; contentType: string }>();
  writes: { url: string; body: Uint8Array; cond: { ifMatch?: string; ifNoneMatch?: "*" } }[] = [];
  reads: string[] = [];
  aclLinks = new Map<string, string>();
  async discoverAcl(url: string) {
    return this.aclLinks.get(url) ?? `${url}.acl`;
  }
  failUrl?: string;
  failStatus = 403;
  poison: { url: string; isContainer: boolean }[] = [];
  async read(url: string) {
    this.reads.push(url);
    const resource = this.resources.get(url);
    if (!resource) throw httpError(404);
    return resource;
  }
  async list(container: string) {
    return [...this.resources.keys()]
      .filter(
        (url) =>
          url.startsWith(container) &&
          url !== container &&
          !url.slice(container.length).replace(/\/$/, "").includes("/"),
      )
      .map((url) => ({ url, isContainer: url.endsWith("/") }))
      .concat(this.poison);
  }
  async write(
    url: string,
    body: Uint8Array,
    contentType: string,
    cond: { ifMatch?: string; ifNoneMatch?: "*" },
  ) {
    this.writes.push({ url, body, cond });
    if (url === this.failUrl) throw httpError(this.failStatus);
    if (cond.ifNoneMatch === "*" && this.resources.has(url)) throw httpError(412);
    this.resources.set(url, { body, contentType });
    return {};
  }
}
function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    provider: "claude",
    conversationId: "thread-1",
    title: "A chat",
    messages: [
      { id: "msg-1", role: "user", text: 'Hello "world" <x>', createdAt: DAY1 },
      { id: "msg-2", role: "assistant", text: "Hello back", createdAt: DAY2 },
    ],
    ...overrides,
  };
}

describe("ChatWriter", () => {
  it("writes canonical AS2 and preserves immutable message IDs on re-save", async () => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    const input = conversation();
    const first = await writer.save(input);
    expect(first).toEqual({ url: `${ROOT}private/chats/claude/thread-1/`, saved: 2, skipped: 0 });
    const messageUrl = `${first.url}m-msg-1.ttl`;
    const before = decoder.decode((await pod.read(messageUrl)).body);
    const parsed = await parseAs2(messageUrl, before);
    expect(parsed).toMatchObject({
      content: input.messages[0]?.text,
      author: OWNER,
      published: DAY1,
      room: first.url,
      mediaType: "text/plain",
    });
    expect(
      await writer.save({
        ...input,
        title: "Replacement title",
        messages: input.messages.map((m) => ({ ...m, text: "Changed" })),
      }),
    ).toEqual({ ...first, saved: 0, skipped: 2 });
    expect(decoder.decode((await pod.read(messageUrl)).body)).toBe(before);
    const got = await writer.get("claude", "thread-1");
    expect(got).toEqual({ ...input, url: first.url });
    const writes = pod.writes.filter((w) => /m-msg-.*\.ttl$/.test(w.url));
    expect(writes.every((w) => w.cond.ifNoneMatch === "*")).toBe(true);
    const assistant = await parseAs2(
      `${first.url}m-msg-2.ttl`,
      decoder.decode((await pod.read(`${first.url}m-msg-2.ttl`)).body),
    );
    expect(assistant?.author).toBeUndefined();
  });

  it("derives deterministic IDs for ID-less input and tolerates concurrent replays", async () => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    const input = conversation({
      provider: "codex",
      messages: [{ role: "tool", text: "Read", createdAt: "2026-10-24T13:00:00+01:00" }],
    });
    const results = await Promise.all([writer.save(input), writer.save(input)]);
    expect(results.reduce((sum, r) => sum + r.saved, 0)).toBe(1);
    const saved = await writer.get("codex", "thread-1");
    expect(saved.messages[0]?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.messages[0]).toMatchObject({ role: "tool", createdAt: DAY1 });
    expect(
      (
        await writer.save({
          ...input,
          messages: [
            { ...(input.messages[0] as ChatConversation["messages"][number]), createdAt: DAY1 },
          ],
        })
      ).saved,
    ).toBe(0);
  });

  it("writes only owner ACLs before containers and content", async () => {
    const pod = new MemoryPod();
    await new ChatWriter(pod).save(conversation());
    expect(pod.writes[0]?.url).toBe(`${ROOT}private/chats/.acl`);
    const aclWrites = pod.writes.filter((w) => w.url.endsWith(".acl"));
    expect(aclWrites).toHaveLength(6);
    for (const write of aclWrites) {
      const dataset = await parseRdf(decoder.decode(write.body), "text/turtle", {
        baseIRI: write.url,
      });
      const authorizations = [...new AclResource(dataset, DataFactory).authorizations];
      expect(authorizations).toHaveLength(1);
      const auth = authorizations[0];
      if (!auth) throw new Error("Missing owner authorization");
      expect([...auth.agent]).toEqual([OWNER]);
      expect([...auth.agentClass]).toEqual([]);
      expect([...auth.mode].sort()).toEqual(
        ["Control", "Read", "Write"].map((m) => `http://www.w3.org/ns/auth/acl#${m}`).sort(),
      );
      expect(auth.accessTo).toBe(write.url.slice(0, -4));
      expect(auth.default).toBe(auth.accessTo?.endsWith("/") ? auth.accessTo : undefined);
      expect(pod.writes.findIndex((w) => w.url === auth.accessTo)).toBeGreaterThan(
        pod.writes.indexOf(write),
      );
    }
    expect(pod.writes.some((w) => w.url === `${ROOT}private/.acl`)).toBe(false);
  });

  describe.each([false, true])("content ACLs with existing resource = %s", (existing) => {
    it.each(
      ["", ...CONTENT_FILES].flatMap((file) =>
        (["accessTo", "default"] as const).flatMap((predicate) =>
          [false, true].map((sharedAuthorization) => ({ file, predicate, sharedAuthorization })),
        ),
      ),
    )("rejects shared ACLs for '$file' ($predicate, shared authorization = $sharedAuthorization)", async ({
      file,
      predicate,
      sharedAuthorization,
    }) => {
      const pod = new MemoryPod();
      const writer = new ChatWriter(pod);
      if (existing) await writer.save(conversation());
      const resource = `${ROOT}private/chats/claude/thread-1/${file}`;
      const original = pod.resources.get(resource);
      const acl = `${ROOT}permissions/shared.ttl`;
      pod.aclLinks.set(resource, acl);
      const unrelated = `${ROOT}other/`;
      pod.aclLinks.set(unrelated, acl);
      const store = new Store();
      const targetAuth = new Authorization(`${acl}#target`, store, DataFactory);
      targetAuth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
      targetAuth.accessTo = resource;
      targetAuth.agentClass.add("http://xmlns.com/foaf/0.1/Agent");
      targetAuth.canRead = true;
      const unrelatedAuth = sharedAuthorization
        ? targetAuth
        : new Authorization(`${acl}#unrelated`, store, DataFactory);
      unrelatedAuth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
      unrelatedAuth.agent.add(OWNER);
      unrelatedAuth.canRead = true;
      const targets = SetFrom.subjectPredicate(
        unrelatedAuth,
        `http://www.w3.org/ns/auth/acl#${predicate}`,
        NamedNodeAs.string,
        NamedNodeFrom.string,
      );
      if (sharedAuthorization) targets.add(resource);
      targets.add(unrelated);
      const originalAcl = {
        body: new TextEncoder().encode(await storeToTurtle(store)),
        contentType: "text/turtle",
      };
      pod.resources.set(acl, originalAcl);
      pod.writes = [];

      await expect(writer.save(conversation())).rejects.toThrow(/shared chat ACL/i);
      expect(pod.resources.get(acl)).toBe(originalAcl);
      expect(pod.resources.get(resource)).toBe(original);
      expect(pod.writes.some((write) => write.url === acl || write.url === resource)).toBe(false);
      expect(pod.writes.some((write) => write.url.endsWith("m-msg-2.ttl"))).toBe(false);
    });

    it.each(
      CONTENT_FILES,
    )("replaces public grants before creating or skipping %s", async (file) => {
      const pod = new MemoryPod();
      const writer = new ChatWriter(pod);
      if (existing) await writer.save(conversation());
      const resource = `${ROOT}private/chats/claude/thread-1/${file}`;
      const original = pod.resources.get(resource);
      const acl = `${ROOT}permissions/${file}`;
      pod.aclLinks.set(resource, acl);
      const store = new Store();
      const publicAuth = new Authorization(`${acl}#public`, store, DataFactory);
      publicAuth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
      publicAuth.accessTo = resource;
      publicAuth.agentClass.add("http://xmlns.com/foaf/0.1/Agent");
      publicAuth.canRead = true;
      pod.resources.set(acl, {
        body: new TextEncoder().encode(await storeToTurtle(store)),
        contentType: "text/turtle",
      });
      pod.writes = [];
      const write = pod.write.bind(pod);
      // Inspect permissions at the moment the content PUT (including 412) is attempted.
      pod.write = async (url, body, contentType, cond) => {
        if (url === resource) {
          const dataset = await parseRdf(decoder.decode((await pod.read(acl)).body), "text/turtle");
          const authorizations = [...new AclResource(dataset, DataFactory).authorizations];
          expect(authorizations).toHaveLength(1);
          const auth = authorizations[0];
          expect(auth?.accessTo).toBe(resource);
          expect(auth?.default).toBeUndefined();
          expect([...(auth?.agent ?? [])]).toEqual([OWNER]);
          expect([...(auth?.agentClass ?? [])]).toEqual([]);
          expect(auth?.canRead).toBe(true);
          expect(auth?.canWrite).toBe(true);
          expect(auth?.canReadWriteAcl).toBe(true);
        }
        return write(url, body, contentType, cond);
      };
      expect(await writer.save(conversation({ title: "Replacement title" }))).toMatchObject({
        saved: existing ? 0 : 2,
        skipped: existing ? 2 : 0,
      });
      const contentIndex = pod.writes.findIndex((w) => w.url === resource);
      expect(contentIndex).toBeGreaterThan(0);
      expect(pod.writes[contentIndex - 1]?.url).toBe(acl);
      expect(pod.writes[contentIndex]?.cond).toEqual({ ifNoneMatch: "*" });
      expect(pod.writes.some((w) => w.url === `${resource}.acl`)).toBe(false);
      if (existing) expect(pod.resources.get(resource)).toBe(original);
    });

    it.each(CONTENT_FILES)("fails closed on ACL errors for %s", async (file) => {
      for (const failure of ["discovery", "read", "unsupported", 403, 412, 500] as const) {
        const pod = new MemoryPod();
        const writer = new ChatWriter(pod);
        if (existing) await writer.save(conversation());
        const resource = `${ROOT}private/chats/claude/thread-1/${file}`;
        const acl = `${resource}.acl`;
        const error = httpError(403);
        if (failure === "discovery") {
          const discoverAcl = pod.discoverAcl.bind(pod);
          pod.discoverAcl = async (url) => {
            if (url === resource) throw error;
            return discoverAcl(url);
          };
        } else if (failure === "read") {
          const read = pod.read.bind(pod);
          pod.read = async (url) => {
            if (url === acl) throw error;
            return read(url);
          };
        } else if (failure === "unsupported") {
          pod.resources.set(acl, {
            body: new TextEncoder().encode(
              "<> a <http://www.w3.org/ns/solid/acp#AccessControlResource> .",
            ),
            contentType: "text/turtle",
          });
        } else {
          pod.failUrl = acl;
          pod.failStatus = failure;
        }
        pod.writes = [];
        if (failure === "unsupported")
          await expect(writer.save(conversation())).rejects.toThrow(/access-control model/);
        else
          await expect(writer.save(conversation())).rejects.toMatchObject({
            status: typeof failure === "number" ? failure : 403,
          });
        expect(pod.writes.some((w) => w.url === resource)).toBe(false);
        expect(pod.writes.some((w) => w.url.endsWith("m-msg-2.ttl"))).toBe(false);
      }
    });

    it.each(
      CONTENT_FILES,
    )("rejects a changed ACL association after creating or skipping %s", async (file) => {
      const pod = new MemoryPod();
      const writer = new ChatWriter(pod);
      if (existing) await writer.save(conversation());
      const resource = `${ROOT}private/chats/claude/thread-1/${file}`;
      const discoverAcl = pod.discoverAcl.bind(pod);
      let calls = 0;
      pod.discoverAcl = async (url) => {
        if (url === resource && calls++ > 0) return `${resource}.other-acl`;
        return discoverAcl(url);
      };
      pod.writes = [];
      await expect(writer.save(conversation())).rejects.toThrow(/association changed/);
      expect(calls).toBe(2);
      expect(pod.writes.at(-1)?.url).toBe(resource);
    });
  });

  it.each([403, 412, 500])("aborts before content if ACL write fails (%s)", async (status) => {
    const pod = new MemoryPod();
    pod.failUrl = `${ROOT}private/chats/claude/thread-1/.acl`;
    pod.failStatus = status;
    await expect(new ChatWriter(pod).save(conversation())).rejects.toMatchObject({ status });
    expect([...pod.resources.keys()].some((url) => url.endsWith(".ttl"))).toBe(false);
  });

  it("uses the discovered ACL resource rather than a constructed suffix", async () => {
    const pod = new MemoryPod();
    const base = `${ROOT}private/chats/`;
    const acl = `${ROOT}permissions/chats.ttl`;
    pod.aclLinks.set(base, acl);
    await new ChatWriter(pod).save(conversation());
    expect(pod.writes[0]?.url).toBe(acl);
    expect(pod.resources.has(`${base}.acl`)).toBe(false);
    const dataset = await parseRdf(decoder.decode((await pod.read(acl)).body), "text/turtle");
    const auth = [...new AclResource(dataset, DataFactory).authorizations][0];
    expect(auth?.accessTo).toBe(base);
    expect(auth?.default).toBe(base);
  });

  it("refuses an unsupported existing ACL representation before writing", async () => {
    const pod = new MemoryPod();
    pod.resources.set(`${ROOT}private/chats/.acl`, {
      body: new TextEncoder().encode(
        "<> a <http://www.w3.org/ns/solid/acp#AccessControlResource> .",
      ),
      contentType: "text/turtle",
    });
    await expect(new ChatWriter(pod).save(conversation())).rejects.toThrow(/access-control model/);
    expect(pod.writes).toEqual([]);
  });

  it("stops before content if the ACL association changes after container creation", async () => {
    const pod = new MemoryPod();
    let calls = 0;
    pod.discoverAcl = async (url) => `${url}${calls++ === 0 ? ".acl" : "other.acl"}`;
    await expect(new ChatWriter(pod).save(conversation())).rejects.toThrow(/association changed/);
    expect(pod.writes.map((w) => w.url)).toEqual([
      `${ROOT}private/chats/.acl`,
      `${ROOT}private/chats/`,
    ]);
  });

  it("recovers a partial save by retrying only missing message IDs", async () => {
    const pod = new MemoryPod();
    pod.failUrl = `${ROOT}private/chats/claude/thread-1/m-msg-2.ttl`;
    pod.failStatus = 500;
    const writer = new ChatWriter(pod);
    await expect(writer.save(conversation())).rejects.toMatchObject({ status: 500 });
    pod.failUrl = undefined;
    expect(await writer.save(conversation())).toMatchObject({ saved: 1, skipped: 1 });
    expect((await writer.get("claude", "thread-1")).messages).toHaveLength(2);
  });

  it("pages in stable URL order and applies since before the page limit", async () => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    for (const id of ["b", "Z", "a", "A"]) await writer.save(conversation({ conversationId: id }));
    await writer.save(
      conversation({
        provider: "chatgpt",
        conversationId: "new",
        messages: [
          { id: "fresh", role: "system", text: "System", createdAt: "2026-10-26T12:00:00Z" },
        ],
      }),
    );
    const first = await writer.list({ provider: "claude", limit: 2 });
    expect(first.conversations.map((c) => c.conversationId)).toEqual(["A", "Z"]);
    const second = await writer.list({ provider: "claude", limit: 2, cursor: first.nextCursor });
    expect(second.conversations.map((c) => c.conversationId)).toEqual(["a", "b"]);
    expect(second.nextCursor).toBeUndefined();
    const since = await writer.list({ since: DAY2, limit: 1 });
    expect(since.conversations.map((c) => c.provider)).toEqual(["chatgpt"]);
    expect(since.nextCursor).toBeUndefined();
    expect((await writer.list({ since: "2026-10-27T00:00:00Z" })).conversations).toEqual([]);
  });

  it("returns an empty page for missing providers but propagates permission errors", async () => {
    const pod = new MemoryPod();
    pod.list = async () => {
      throw httpError(404);
    };
    const writer = new ChatWriter(pod);
    expect(await writer.list()).toEqual({ conversations: [] });
    pod.list = async () => {
      throw httpError(403);
    };
    await expect(writer.list()).rejects.toMatchObject({ status: 403 });
    await expect(writer.get("claude", "missing")).rejects.toMatchObject({ status: 404 });
  });

  it("skips interrupted saves with missing metadata before applying pagination", async () => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    for (const id of ["a", "c", "e"]) await writer.save(conversation({ conversationId: id }));
    for (const id of ["0", "b", "d", "f"]) {
      pod.failUrl = `${ROOT}private/chats/claude/${id}/_conversation.ttl`;
      await expect(writer.save(conversation({ conversationId: id }))).rejects.toMatchObject({
        status: 403,
      });
    }
    pod.failUrl = undefined;
    const first = await writer.list({ provider: "claude", limit: 2, since: DAY1 });
    expect(first.conversations.map((c) => c.conversationId)).toEqual(["a", "c"]);
    expect(first.nextCursor).toBe(`${ROOT}private/chats/claude/c/`);
    const second = await writer.list({
      provider: "claude",
      limit: 2,
      since: DAY1,
      cursor: first.nextCursor,
    });
    expect(second.conversations.map((c) => c.conversationId)).toEqual(["e"]);
    expect(second.nextCursor).toBeUndefined();
    await expect(writer.get("claude", "b")).rejects.toMatchObject({ status: 404 });
  });

  it.each([401, 403, 500, "offline"])("preserves metadata read failures (%s)", async (failure) => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    await writer.save(conversation());
    const read = pod.read.bind(pod);
    const error = typeof failure === "number" ? httpError(failure) : new Error(failure);
    pod.read = async (url) => {
      if (url.endsWith("_conversation.ttl")) throw error;
      return read(url);
    };
    await expect(writer.list()).rejects.toBe(error);
  });

  it("preserves a 404 from a listed message rather than skipping its conversation", async () => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    await writer.save(conversation());
    const read = pod.read.bind(pod);
    pod.read = async (url) => {
      if (url.endsWith("m-msg-1.ttl")) throw httpError(404);
      return read(url);
    };
    await expect(writer.list()).rejects.toMatchObject({ status: 404 });
  });

  it("ignores poisoned listings and sorts messages by time", async () => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    await writer.save(conversation({ messages: [...conversation().messages].reverse() }));
    pod.poison = [
      { url: "https://evil.example/m-stolen.ttl", isContainer: false },
      { url: `${ROOT}private/chats/claude/../outside/`, isContainer: true },
      { url: `${ROOT}private/chats/claude/thread-1/nested/m-stolen.ttl`, isContainer: false },
      { url: `${ROOT}private/chats/claude/thread-1/m-%2e%2e.ttl`, isContainer: false },
    ];
    expect((await writer.list()).conversations).toHaveLength(1);
    const got = await writer.get("claude", "thread-1");
    expect(got.messages.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    expect(
      pod.reads
        .filter((url) => !url.endsWith(".acl"))
        .every((url) => url.startsWith(`${ROOT}private/chats/claude/thread-1/`)),
    ).toBe(true);
  });

  it.each([
    "..",
    "a/b",
    "%2e%2e",
    "a?x",
    "",
    "a#b",
    "a\\b",
    "a".repeat(201),
  ])("rejects unsafe IDs before writes: %s", async (id) => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    await expect(writer.save(conversation({ conversationId: id }))).rejects.toThrow(/Chat IDs/);
    await expect(
      writer.save(conversation({ messages: [{ id, role: "user", text: "x", createdAt: DAY1 }] })),
    ).rejects.toThrow(/Chat IDs/);
    expect(pod.writes).toEqual([]);
  });

  it("validates roots, owners, providers, roles, timestamps and page limits", async () => {
    const pod = new MemoryPod();
    for (const root of [
      "not-a-url",
      "file:///tmp/",
      `${ROOT}?query`,
      `${ROOT}#hash`,
      ROOT.slice(0, -1),
      "https://u:p@alice.example/",
    ]) {
      expect(() => new ChatWriter({ ...pod, root } as unknown as ChatPodPort)).toThrow();
    }
    expect(() => new ChatWriter({ ...pod, webId: "" } as unknown as ChatPodPort)).toThrow(/WebID/);
    const writer = new ChatWriter(pod);
    await expect(writer.save(conversation({ provider: "other" as "claude" }))).rejects.toThrow(
      /provider/,
    );
    for (const message of [
      { role: "bad", text: "x", createdAt: DAY1 },
      { role: "user", text: "x", createdAt: "bad" },
      { role: "user", text: "x", createdAt: "2026-10-24T12:00:00" },
    ])
      await expect(
        writer.save(conversation({ messages: [message as ChatConversation["messages"][number]] })),
      ).rejects.toThrow();
    for (const limit of [0, 101, 1.5, Number.NaN])
      await expect(writer.list({ limit })).rejects.toThrow(/limit/);
    await expect(writer.list({ since: "yesterday" })).rejects.toThrow(/timestamp/);
    expect(pod.writes).toEqual([]);
  });

  it("rejects remote-context formats and malformed stored resources", async () => {
    const pod = new MemoryPod();
    const writer = new ChatWriter(pod);
    const { url } = await writer.save(conversation());
    const resource = pod.resources.get(`${url}_conversation.ttl`);
    if (!resource) throw new Error("Missing metadata");
    resource.contentType = "application/ld+json";
    resource.body = new TextEncoder().encode('{"@context":"https://evil.example/context"}');
    await expect(writer.get("claude", "thread-1")).rejects.toThrow(/content type/);
    resource.contentType = "text/turtle";
    resource.body = new TextEncoder().encode("");
    await expect(writer.get("claude", "thread-1")).rejects.toThrow(/metadata/);
    pod.resources.delete(`${url}_conversation.ttl`);
    await writer.save(conversation());
    const message = pod.resources.get(`${url}m-msg-1.ttl`);
    if (!message) throw new Error("Missing message");
    message.body = new TextEncoder().encode("");
    await expect(writer.get("claude", "thread-1")).rejects.toThrow(/stored chat/);
  });

  it("handles empty conversations and excludes them from a since query", async () => {
    const writer = new ChatWriter(new MemoryPod());
    await writer.save(conversation({ messages: [] }));
    expect((await writer.list()).conversations[0]?.updatedAt).toBeUndefined();
    expect((await writer.list({ since: DAY1 })).conversations).toEqual([]);
  });
});
