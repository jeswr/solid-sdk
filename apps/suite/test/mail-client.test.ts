// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/noNonNullAssertion: Integration assertions establish fixture entries before use.

import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  fileChunks,
  folderIriFromKey,
  folderKey,
  MailClient,
  MailFileError,
  mailErrorMessage,
  SYSTEM_KEYS,
} from "../src/apps/mail/lib/client";
import { documentOf, MailError, mailDocument, TypeIndexDataset } from "../src/apps/mail/lib/model";
import { parseQuery, SearchQueryError } from "../src/apps/mail/lib/search";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { mailboxChunks, mailboxFixture } from "./fixtures/mail-mbox";

const root = DEMO_ROOT;
const account = "imported";
function setup(fetchOverride?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch) {
  const pod = createDemoPod({ root });
  const client = new MailClient(fetchOverride ? fetchOverride(pod.fetch) : pod.fetch, root);
  return { pod, client, inbox: folderIriFromKey(client.root(account), "inbox") };
}
async function* bytes(value: string) {
  yield new TextEncoder().encode(value);
}
async function imported(count = 50) {
  const state = setup();
  const result = await state.client.importMailbox(account, mailboxChunks(count), {
    mintId: () => "fallback",
  });
  expect(result.messages).toBe(count);
  return state;
}
describe("MailClient demo pod integration", () => {
  it("imports fifty messages, folders, threads, attachments, flags and safe HTML", async () => {
    const pod = createDemoPod({ root, seed: await buildDemoSeed(Date.UTC(2026, 5, 1)) });
    const client = new MailClient(pod.fetch, root, DEMO_WEBID);
    const onProgress = vi.fn();
    const result = await client.importMailbox(account, mailboxChunks(), {
      onProgress,
      mintId: () => "fallback",
    });
    expect(result).toMatchObject({
      messages: 50,
      attachments: 2,
      failed: 0,
      aborted: false,
      typeIndex: "registered",
      bytes: new TextEncoder().encode(mailboxFixture()).length,
    });
    expect(onProgress).toHaveBeenCalledTimes(50);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({
      messages: 50,
      attachments: 2,
      failed: 0,
    });
    expect(await client.accounts()).toEqual([account]);
    const folders = await client.folders(account);
    expect(folders.map((f) => f.key)).toEqual([
      "inbox",
      "starred",
      "label:Garden~20club",
      "label:Important",
      "label:Travel",
    ]);
    expect(folders[0]).toMatchObject({ total: 50, unread: 10, system: true });
    const inbox = folderIriFromKey(client.root(account), "inbox");
    const page = await client.threads(account, inbox, 0, 3);
    expect(page).toMatchObject({ total: 10, next: 3 });
    expect(page.items.map((r) => r.subject)).toEqual([
      "Re: Garden plans 10",
      "Re: Garden plans 9",
      "Re: Garden plans 8",
    ]);
    expect(page.items[0]).toMatchObject({
      count: 5,
      unread: true,
      hasAttachment: false,
      participants: ["Noel Reed", "Garden friends", "Alex Moss", "Mira Vale"],
    });
    expect(page.items[0]?.snippet).not.toContain("\n");
    expect((await client.threads(account, inbox, 9, 3)).next).toBeNull();
    const oldest = (await client.threads(account, inbox)).items.at(-1);
    const thread = await client.thread(oldest!.iri);
    expect(thread.messages).toHaveLength(5);
    expect(thread.messages[1]?.quoted.hasQuotedHistory).toBe(true);
    expect(thread.messages[2]?.html).toContain("<strong>garden</strong>");
    expect(thread.messages[2]?.html).not.toMatch(/script|https:\/\/tracker/);
    expect(thread.messages[3]?.attachments).toEqual([
      {
        name: "garden-3.txt",
        contentType: "text/plain",
        size: 16,
        url: expect.stringContaining("mail/attachments/imported/"),
      },
    ]);
    const attachment = thread.messages[3]!.attachments[0]!;
    expect(await (await pod.fetch(attachment.url)).text()).toBe("Seeds and water\n");
    const index = await client.store.load(new URL("settings/privateTypeIndex.ttl", root).href);
    expect(
      new TypeIndexDataset(index.mailbox, DataFactory).locate("http://schema.org/EmailMessage"),
    ).toContainEqual({ container: client.root(account) });
    expect(await client.registerTypeIndex(account)).toBe("registered");
  });
  it("uses ETags for read, star, labels, archive and reports batch failures in sequence", async () => {
    const { client, inbox } = await imported(5);
    const thread = await client.thread((await client.threads(account, inbox)).items[0]!.iri);
    const ids = thread.messages.map((m) => m.iri);
    expect(await client.markRead([...ids, ids[0]!], true)).toEqual({ done: ids, failed: [] });
    expect((await client.folders(account))[0]?.unread).toBe(0);
    await client.markRead(ids, false);
    expect((await client.folders(account))[0]?.unread).toBe(1);
    for (const id of ids) await client.star(id, false);
    expect(
      (await client.threads(account, folderIriFromKey(client.root(account), "starred"))).items,
    ).toEqual([]);
    await client.star(ids[0]!, true);
    expect((await client.threads(account, inbox)).items[0]?.starred).toBe(true);
    const custom = await client.createLabel(account, "Projects");
    await client.label(ids[0]!, custom, true);
    expect((await client.folders(account)).find((f) => f.iri === custom)?.total).toBe(1);
    await client.label(ids[0]!, custom, false);
    expect((await client.folders(account)).find((f) => f.iri === custom)?.total).toBe(0);
    expect(await client.archive(ids)).toEqual({ done: ids, failed: [] });
    expect((await client.threads(account, inbox)).total).toBe(0);
    expect(
      (await client.threads(account, folderIriFromKey(client.root(account), "archive"))).total,
    ).toBe(1);
    const missing = `${mailDocument(client.root(account), "messages", "missing")}#it`;
    const result = await client.markRead([missing, ids[0]!], true);
    expect(result.done).toEqual([ids[0]]);
    expect(result.failed[0]).toMatchObject({ iri: missing, error: expect.any(MailError) });
    expect((await client.archive([missing, ids[1]!])).failed).toHaveLength(1);
    await expect(
      client.label(ids[0]!, folderIriFromKey(client.root("other"), "inbox"), true),
    ).rejects.toThrow("same account");
  });
  it("searches summaries, parses operators, deduplicates threads and respects the result limit", async () => {
    const { client } = await imported();
    expect(await client.search(account, 'subject:"Garden plans 10"')).toHaveLength(1);
    expect(await client.search(account, "has:attachment")).toHaveLength(2);
    expect(await client.search(account, "from:mira@example.org is:unread", 2)).toHaveLength(2);
    expect(await client.search(account, "before:2020-01-01")).toEqual([]);
    const results = await client.search(account, "");
    expect(results).toHaveLength(10);
    expect(results[0]!.latest.getTime()).toBeGreaterThan(results[1]!.latest.getTime());
    await expect(client.search(account, "unknown:bad")).rejects.toBeInstanceOf(SearchQueryError);
    await expect(client.search(account, "", 0)).rejects.toThrow("Invalid search limit");
  });
  it("provides an empty inbox for missing mail, folders and accounts without hiding access failures", async () => {
    const { client, inbox } = setup();
    expect(await client.accounts()).toEqual([]);
    expect(await client.folders(account)).toEqual([
      { iri: inbox, key: "inbox", title: "Inbox", system: true, unread: 0, total: 0 },
    ]);
    expect(await client.threads(account, inbox)).toEqual({ items: [], next: null, total: 0 });
    expect(await client.search(account, "")).toEqual([]);
    const forbidden = setup(() => async () => new Response("", { status: 403 })).client;
    await expect(forbidden.accounts()).rejects.toMatchObject({ status: 403 });
    await expect(forbidden.folders(account)).rejects.toMatchObject({ status: 403 });
    await expect(
      setup(() => async () => new Response("", { status: 401 })).client.accounts(),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      setup(() => async () => new Response("", { status: 500 })).client.accounts(),
    ).rejects.toMatchObject({ status: 500 });
    vi.spyOn(client.store, "list").mockRejectedValue(new Error("network"));
    await expect(client.accounts()).rejects.toThrow("network");
  });
  it("validates label names and creates them with If-None-Match, rejecting concurrent creation", async () => {
    const { client } = setup();
    for (const title of ["", "system:inbox", "SYSTEM:mine", "a".repeat(101), "bad\u0000label"])
      await expect(client.createLabel(account, title)).rejects.toThrow("Choose a label");
    await expect(client.createLabel("attachments", "Plans")).rejects.toThrow("reserved");
    await client.createLabel("personal mail", "Plans");
    expect(await client.accounts()).toContain("personal mail");
    await client.createLabel(account, "  Plans  ");
    await expect(client.createLabel(account, "plans")).rejects.toThrow("already exists");
    const original = client.folders.bind(client);
    vi.spyOn(client, "folders").mockResolvedValue([]);
    await expect(client.createLabel(account, "Plans")).rejects.toMatchObject({ code: "conflict" });
    vi.mocked(client.folders).mockImplementation(original);
  });
  it("rejects cross-account or malformed resource identities before mutations", async () => {
    const { client, inbox } = setup();
    await expect(client.threads("other", inbox)).rejects.toThrow("Invalid account folder");
    for (const iri of [
      "https://else.example/mail/imported/messages/x.ttl#it",
      `${root}other/imported/messages/x.ttl`,
      `${root}mail/imported/extra/messages/x.ttl`,
      `${root}mail//messages/x.ttl`,
      `${root}mail/imported/other/x.ttl`,
    ])
      await expect(client.thread(iri)).rejects.toThrow("Invalid mail resource");
  });
});
describe("Mailbox streaming and recovery", () => {
  it("supports blobs, file chunks, ZIP errors and invalid chunk sizes", async () => {
    const chunks = [];
    for await (const chunk of fileChunks(new Blob(["abcdef"]), 2))
      chunks.push(new TextDecoder().decode(chunk));
    expect(chunks).toEqual(["ab", "cd", "ef"]);
    for (const blob of [
      new File(["zip"], "Takeout.ZIP"),
      new Blob(["zip"], { type: "application/zip" }),
    ]) {
      await expect(async () => {
        for await (const _ of fileChunks(blob)) {
          /* consume */
        }
      }).rejects.toThrow("Unzip your Takeout");
    }
    await expect(async () => {
      for await (const _ of fileChunks(new Blob(), 0)) {
        /* consume */
      }
    }).rejects.toThrow("Invalid chunk size");
  });
  it("honours abort before import and after a message; records persistence failures and continues", async () => {
    const before = new AbortController();
    before.abort();
    expect(
      await setup().client.importMailbox(account, mailboxChunks(), { signal: before.signal }),
    ).toMatchObject({ messages: 0, aborted: true });
    const during = new AbortController();
    const { client } = setup();
    expect(
      await client.importMailbox(account, mailboxChunks(), {
        signal: during.signal,
        onProgress: () => during.abort(),
      }),
    ).toMatchObject({ messages: 1, aborted: true });
    let failed = false;
    const state = setup((fetch) => async (input, init) => {
      if (!failed && init?.method === "PUT" && String(input).includes("messages/")) {
        failed = true;
        return new Response("", { status: 503 });
      }
      return fetch(input, init);
    });
    const result = await state.client.importMailbox(account, mailboxChunks(5));
    expect(result).toMatchObject({ messages: 4, failed: 1, aborted: false });
    expect(result.failures[0]?.error).toBeInstanceOf(MailError);
  });
  it("continues past malformed per-message MIME dates while preserving References and raw byte encodings", async () => {
    const { client } = setup();
    const malformed = mailboxFixture(1)
      .replace(/^Date:.*$/m, "Date: invalid")
      .replaceAll("sample-0@", "broken@");
    const result = await client.importMailbox(account, bytes(malformed + mailboxFixture(5)));
    expect(result).toMatchObject({ messages: 5, failed: 1 });
    expect(result.failures[0]?.iri).toBe("Message 1");
    const text =
      "From sender@example.org Thu Jan 01 00:00:00 2026\nMessage-ID: <escape@example.org>\nContent-Type: text/plain; charset=iso-8859-1\n\n>From escaped\n>>From double\n";
    const source = new Uint8Array([...new TextEncoder().encode(text), 0xe9, 10]);
    await client.importMailbox(
      account,
      (async function* () {
        yield source;
      })(),
    );
    const loaded = await client.store.load(
      mailDocument(client.root(account), "messages", "<escape@example.org>"),
    );
    const encoding = [...loaded.mailbox.messages][0]!.encoding!;
    const raw = new Uint8Array(await (await client.store.fetch(encoding)).arrayBuffer());
    expect(raw).toContain(0xe9);
    expect(new TextDecoder().decode(raw)).toContain("\nFrom escaped\n>From double");
  });
  it("reports missing and failed Type Index discovery independently of imported mail", async () => {
    expect(await setup().client.registerTypeIndex(account)).toBe("missing");
    const state = setup(
      (fetch) => async (input, init) =>
        String(input).includes("profile/card")
          ? new Response("", { status: 403 })
          : fetch(input, init),
    );
    const result = await state.client.importMailbox(account, mailboxChunks(1));
    expect(result).toMatchObject({
      messages: 1,
      typeIndex: "failed",
      typeIndexError: expect.any(MailError),
    });
  });
});
describe("Folder keys and error copy", () => {
  it("round trips system and escaped custom keys and rejects garbage", () => {
    const { client } = setup();
    const base = client.root(account);
    for (const key of SYSTEM_KEYS) expect(folderKey(folderIriFromKey(base, key))).toBe(key);
    for (const title of ["Garden club", "system:inbox", "work/next", "日本語", "tilde~"]) {
      const iri = `${mailDocument(base, "folders", title)}#it`;
      expect(folderIriFromKey(base, folderKey(iri))).toBe(iri);
    }
    for (const key of [
      "junk",
      "label:",
      "label:..",
      "label:.",
      "label:a/b",
      "label:system:inbox",
      "label:%",
      "label:%61",
      "label:a?b",
      "label:a#b",
    ])
      expect(() => folderIriFromKey(base, key)).toThrow();
    for (const iri of [
      "file:///mail/folders/a.ttl#it",
      "https://a:b@example.org/mail/folders/a.ttl#it",
      `${base}folders/a.ttl?q=x#it`,
      `${base}folders/a.ttl#wrong`,
      `${base}messages/a.ttl#it`,
      `${base}folders/a.txt#it`,
      `${base}folders/system:garbage.ttl#it`,
    ])
      expect(() => folderKey(iri)).toThrow();
  });
  it("maps every model code and safe query errors to readable copy", () => {
    for (const code of ["not-found", "forbidden", "conflict", "no-validator", "http"] as const)
      expect(mailErrorMessage(new MailError(code, 0))).not.toContain("Mail operation failed");
    let queryError: unknown;
    try {
      parseQuery("bad:query");
    } catch (error) {
      queryError = error;
    }
    expect(mailErrorMessage(queryError)).toBe((queryError as Error).message);
    expect(mailErrorMessage(new MailFileError())).toContain("Unzip your Takeout");
    expect(mailErrorMessage(new RangeError("Mail message exceeds import limit"))).toContain(
      "25 MiB",
    );
    expect(mailErrorMessage(new RangeError("private details"))).toContain("Couldn't finish");
    expect(mailErrorMessage(new TypeError("Choose a label"))).toBe("Choose a label");
    expect(mailErrorMessage(new Error("secret transport details"))).toBe(
      "Couldn't finish the mail operation. Try again.",
    );
    expect(mailErrorMessage(null)).toContain("Couldn't finish");
  });
});

describe("Sparse and bounded account snapshots", () => {
  it("handles sparse messages, missing titles, empty threads and equal dates", async () => {
    const { client, inbox } = setup();
    const folderDoc = await client.store.load(documentOf(inbox), true);
    const folder = folderDoc.mailbox.createFolder(inbox);
    const threadIris: string[] = [];
    for (let i = 0; i < 4; i++) {
      const iri = `${mailDocument(client.root(account), "messages", `sparse-${i}`)}#it`;
      const msgDoc = await client.store.load(documentOf(iri), true);
      const message = msgDoc.mailbox.createMessage(iri);
      if (i < 2) {
        const thread = `${mailDocument(client.root(account), "threads", `sparse-${i}`)}#it`;
        threadIris.push(thread);
        message.partOfThread = thread;
        const threadDoc = await client.store.load(documentOf(thread), true);
        const t = threadDoc.mailbox.createThread(thread);
        if (i === 0) t.addMessage(iri); // An empty registered conversation remains readable.
        await client.store.save(threadDoc);
      }
      if (i === 3) {
        message.partOfThread = threadIris[0];
        const parent = await client.store.load(documentOf(threadIris[0]!));
        parent.mailbox.thread(threadIris[0]!).addMessage(iri);
        await client.store.save(parent);
      }
      message.folderIris.add(inbox);
      folder.addMessage(iri);
      await client.store.save(msgDoc);
    }
    await client.store.save(folderDoc);
    const untitled = await client.store.load(
      mailDocument(client.root(account), "folders", "Untitled"),
      true,
    );
    untitled.mailbox.createFolder(`${untitled.url}#it`);
    await client.store.save(untitled);
    expect((await client.folders(account)).find((f) => !f.system)?.title).toBe("label:Untitled");
    expect((await client.thread(threadIris[0]!)).messages[0]).toMatchObject({
      from: "Unknown sender",
      subject: "(No subject)",
      text: "",
      date: new Date(0),
    });
    expect(await client.thread(threadIris[1]!)).toMatchObject({
      subject: "(No subject)",
      messages: [],
    });
    const rows = await client.search(account, "");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.subject === "(No subject)" && r.latest.getTime() === 0)).toBe(true);
    expect(rows.find((r) => r.count === 0)).toMatchObject({
      participants: [],
      snippet: "",
      unread: false,
    });
    await client.threads(account, inbox);
    expect(new MailClient(client.store.fetch, root.slice(0, -1)).storageUrl).toBe(root);
  });
  it("evaluates only the newest 5,000 message summaries", async () => {
    const { client, inbox } = setup();
    const loaded = await client.store.load(documentOf(inbox), true);
    const folder = loaded.mailbox.createFolder(inbox);
    // One synthetic RDF document keeps the regression small while exercising the
    // real store snapshot and typed model over 5,001 messages.
    for (let i = 0; i < 5001; i++) {
      const iri = `${loaded.url}#message-${i}`;
      const message = loaded.mailbox.createMessage(iri);
      message.subjectLine = i === 0 ? "outside-bound" : "inside-bound";
      message.dateSent = new Date(i * 1000);
      folder.addMessage(iri);
    }
    await client.store.save(loaded);
    expect(await client.search(account, "subject:outside-bound")).toEqual([]);
    expect(await client.search(account, "subject:inside-bound")).toEqual([]); // No conversation relation invented.
  });
  it("preserves final unterminated MIME bytes, and mboxrd prefixes split at each position", async () => {
    const { client } = setup();
    const body =
      "From sender@example.org Thu Jan 01 00:00:00 2026\n\nF\nFr\nFro\nFromx\nFrom literal\n";
    const source = body.replace("\nFrom literal", "\n>From literal").trimEnd();
    expect(await client.importMailbox(account, bytes(source))).toMatchObject({
      messages: 1,
      failed: 0,
    });
  });
  it("discovers a private index through preferences and rejects off-pod profile pointers", async () => {
    const profile = `<${DEMO_WEBID}> <http://www.w3.org/ns/pim/space#preferencesFile> <${root}settings/prefs.ttl>.`;
    const prefs = `<${DEMO_WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}settings/privateTypeIndex.ttl>.`;
    const pod = createDemoPod({
      root,
      seed: [
        { path: "profile/card", body: profile, contentType: "text/turtle" },
        { path: "settings/prefs.ttl", body: prefs, contentType: "text/turtle" },
        { path: "settings/privateTypeIndex.ttl", body: "", contentType: "text/turtle" },
      ],
    });
    const client = new MailClient(pod.fetch, root);
    expect(await client.registerTypeIndex(account)).toBe("registered");
    await client.store.write(
      `${root}settings/prefs.ttl`,
      "",
      "text/turtle",
      (await client.store.load(`${root}settings/prefs.ttl`)).etag,
      true,
    );
    expect(await client.registerTypeIndex(account)).toBe("missing");
    const foreign = new MailClient(pod.fetch, root, "https://foreign.example/profile#me");
    await expect(foreign.registerTypeIndex(account)).rejects.toThrow();
  });
  it("uses attachment metadata without probing binaries, even when they are missing", async () => {
    const { client, inbox } = await imported(5);
    const row = (await client.threads(account, inbox)).items[0]!;
    const view = await client.thread(row.iri);
    const message = view.messages[3]!;
    const { Attachment } = await import("../src/apps/mail/lib/model");
    const loaded = await client.store.load(documentOf(message.iri));
    const metadata = new Attachment(message.attachments[0]!.url, loaded.mailbox, DataFactory);
    metadata.name = undefined;
    metadata.contentType = undefined;
    metadata.size = undefined;
    await client.store.save(loaded);
    const original = client.store.fetch;
    vi.spyOn(client.store, "fetch").mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (init?.method === "HEAD") response.headers.delete("content-length");
      return response;
    });
    expect((await client.thread(row.iri)).messages[3]?.attachments[0]).toMatchObject({
      name: "attachment",
      contentType: "application/octet-stream",
      size: 0,
    });
    vi.mocked(client.store.fetch).mockImplementation(async (input, init) =>
      init?.method === "HEAD" ? new Response(null, { status: 404 }) : original(input, init),
    );
    await expect(client.thread(row.iri)).resolves.toMatchObject({ messages: expect.any(Array) });
    expect(
      vi.mocked(client.store.fetch).mock.calls.every(([, init]) => init?.method !== "HEAD"),
    ).toBe(true);
  });
});

describe("Round one client regressions", () => {
  it("renders accepted large and line-heavy bodies with a bounded preview and original source", async () => {
    const { client, inbox } = setup();
    const large = mailboxFixture(1).replace(
      /Hello friends,[\s\S]*/,
      `${"x".repeat(2 * 1024 * 1024 + 1)}\n`,
    );
    expect(await client.importMailbox(account, bytes(large))).toMatchObject({
      messages: 1,
      failed: 0,
    });
    const thread = (await client.threads(account, inbox)).items[0]!;
    let message = (await client.thread(thread.iri)).messages[0]!;
    expect(message.truncated).toBe(true);
    expect(message.quoted.visibleText).toHaveLength(64 * 1024);
    expect(message.originalUrl).toMatch(/\.eml$/);
    expect((await client.binaryFetch(message.originalUrl!)).ok).toBe(true);
    const loaded = await client.store.load(documentOf(message.iri));
    loaded.mailbox.message(message.iri).body = "line\n".repeat(50_001);
    await client.store.save(loaded);
    message = (await client.thread(thread.iri)).messages[0]!;
    expect(message.truncated).toBe(true);
    expect((await client.markRead([message.iri], true)).failed).toEqual([]);
    expect((await client.archive([message.iri])).failed).toEqual([]);
    // Unexpected parser errors still surface; validation errors have a per-message fallback.
    const quotes = await import("../src/apps/mail/lib/quotes");
    const split = vi.spyOn(quotes, "splitQuotedText");
    const error = new Error("parser failure");
    split.mockImplementationOnce(() => {
      throw error;
    });
    await expect(client.thread(thread.iri)).rejects.toBe(error);
    split.mockRestore();
  });
  it("retains both neighbours of an oversized message, reports failure and preserves ancestry", async () => {
    const { client, inbox } = setup();
    const first = mailboxFixture(1);
    const last = mailboxFixture(2).slice(first.length);
    const oversize =
      "From sender@example.org Thu Jan 01 00:00:00 2026\nMessage-ID: <large@example.org>\n\n";
    async function* source() {
      yield new TextEncoder().encode(first + oversize);
      const block = new Uint8Array(64 * 1024).fill(120);
      for (let i = 0; i < 401; i++) yield block;
      yield new TextEncoder().encode(`\n${last}`);
    }
    const onProgress = vi.fn();
    const result = await client.importMailbox(account, source(), { onProgress });
    expect(result).toMatchObject({ messages: 2, failed: 1, aborted: false, typeIndex: "missing" });
    expect(result.failures[0]?.error).toBeInstanceOf(RangeError);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ messages: 2, failed: 1 });
    const rows = (await client.threads(account, inbox)).items;
    expect(rows).toHaveLength(1);
    expect((await client.thread(rows[0]!.iri)).messages).toHaveLength(2);
  });
  it("surfaces nested folder/message 404s and counts unread conversations per label", async () => {
    const { client, inbox, pod } = await imported(7);
    expect((await client.folders(account)).find((folder) => folder.key === "inbox")?.unread).toBe(
      2,
    );
    expect(
      (await client.folders(account)).find((folder) => folder.title === "Garden club")?.unread,
    ).toBe(2);
    const row = (await client.threads(account, inbox)).items[0]!;
    const message = (await client.thread(row.iri)).messages[0]!;
    expect((await pod.fetch(documentOf(message.iri), { method: "DELETE" })).ok).toBe(true);
    await expect(client.folders(account)).rejects.toMatchObject({ code: "not-found" });
    await expect(client.threads(account, inbox)).rejects.toMatchObject({ code: "not-found" });
    const isolated = setup();
    const label = await isolated.client.createLabel(account, "Work");
    const list = isolated.client.store.list.bind(isolated.client.store);
    vi.spyOn(isolated.client.store, "list").mockImplementation(async (url) => {
      const children = await list(url);
      await isolated.pod.fetch(documentOf(label), { method: "DELETE" });
      return children;
    });
    await expect(isolated.client.folders(account)).rejects.toMatchObject({ code: "not-found" });
  });
  it("uses a scoped binary transport for JSON-LD attachments and leaves missing attachments lazy", async () => {
    const { client, pod, inbox } = await imported(5);
    const row = (await client.threads(account, inbox)).items[0]!;
    const message = (await client.thread(row.iri)).messages[3]!;
    const attachment = message.attachments[0]!;
    const json = '{"@context":"https://example.net/context","name":"Seeds"}';
    const response = await pod.fetch(attachment.url);
    await pod.fetch(attachment.url, {
      method: "PUT",
      headers: { "content-type": "application/ld+json", "if-match": response.headers.get("etag")! },
      body: json,
    });
    expect(await (await client.binaryFetch(attachment.url, { method: "HEAD" })).text()).toBe("");
    expect(await (await client.binaryFetch(attachment.url)).text()).toBe(json);
    await expect(client.binaryFetch("https://elsewhere.example/file")).rejects.toThrow();
    await pod.fetch(attachment.url, { method: "DELETE" });
    expect((await client.thread(row.iri)).messages[3]?.attachments).toHaveLength(1);
    expect((await client.binaryFetch(attachment.url)).status).toBe(404);
  });
  it("prefers header display names, detects a mailto owner and preserves sparse originals", async () => {
    const { client, pod, inbox } = await imported(1);
    const owner = new MailClient(pod.fetch, root, "mailto:mira@example.org");
    const row = (await owner.threads(account, inbox)).items[0]!;
    expect(row.participants).toEqual(["me", "Garden friends", "Alex Moss"]);
    expect((await owner.thread(row.iri)).messages[0]).toMatchObject({
      from: "me <mira@example.org>",
      to: ["Garden friends <friends@example.org>"],
      cc: ["Alex Moss <alex@example.org>"],
    });
    expect(await client.search(account, "from:mira@example.org")).toHaveLength(1);
  });
  it("ships eighteen varied messages across six weeks with names, quotes, HTML and PNG/PDF attachments", async () => {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      new URL("../public/samples/sample-mailbox.mbox", import.meta.url),
      "utf8",
    );
    expect(content).not.toMatch(/fictional|sample/i);
    const { client, inbox } = setup();
    expect(await client.importMailbox(account, bytes(content))).toMatchObject({
      messages: 18,
      attachments: 2,
      failed: 0,
    });
    const page = await client.threads(account, inbox);
    expect(page.total).toBe(11);
    expect(page.items[0]).toMatchObject({
      subject: "Re: Saturday at the garden",
      count: 4,
      participants: ["Noel Hart", "Mira Vale", "Alex Moss"],
    });
    const views = await Promise.all(page.items.map((row) => client.thread(row.iri)));
    const messages = views.flatMap((view) => view.messages);
    const times = messages.map((message) => message.date.getTime());
    expect((Math.max(...times) - Math.min(...times)) / 86400000).toBeGreaterThan(40);
    expect(messages.every((message) => message.date.getUTCFullYear() === 2026)).toBe(true);
    expect(messages.some((message) => message.quoted.hasQuotedHistory)).toBe(true);
    expect(messages.find((message) => message.html)?.html).not.toContain("tracking.example.net");
    expect(
      messages
        .flatMap((message) => message.attachments)
        .map((attachment) => attachment.contentType)
        .sort(),
    ).toEqual(["application/pdf", "image/png"]);
    expect((await client.folders(account)).map((folder) => folder.title)).toEqual(
      expect.arrayContaining(["Starred", "Important", "Travel", "Garden club"]),
    );
  });
});

describe("Round two client regressions", () => {
  it("reports an unexpected archive failure without retrying it", async () => {
    const { client } = setup();
    const error = new Error("connection lost");
    const load = vi.spyOn(client.store, "load").mockRejectedValue(error);
    const iri = `${client.root(account)}messages/missing.ttl#it`;
    expect(await client.archive([iri])).toEqual({ done: [], failed: [{ iri, error }] });
    expect(load).toHaveBeenCalledOnce();
    load.mockRestore();
  });
  it.each([
    "archive",
    "message",
    "inbox",
  ] as const)("keeps Inbox-only mail discoverable after repeated %s conflicts and reconciles on retry", async (failing) => {
    let blocked = false;
    let failureUrl = "";
    const attempts: string[] = [];
    const { client, inbox, pod } = setup((fetch) => async (input, init) => {
      const url = String(input);
      if (blocked && init?.method === "PUT") {
        attempts.push(url);
        if (url === failureUrl) return new Response(null, { status: 412 });
      }
      return fetch(input, init);
    });
    await client.importMailbox(
      account,
      bytes(mailboxFixture(1).replace(/X-Gmail-Labels:.*/, "X-Gmail-Labels: Inbox")),
    );
    const row = (await client.threads(account, inbox)).items[0]!;
    const message = (await client.thread(row.iri)).messages[0]!;
    const destination = folderIriFromKey(client.root(account), "archive");
    failureUrl = documentOf(
      failing === "archive" ? destination : failing === "message" ? message.iri : inbox,
    );
    blocked = true;
    const result = await client.archive([message.iri]);
    expect(result.done).toEqual([]);
    expect(result.failed).toMatchObject([{ iri: message.iri, error: { code: "conflict" } }]);
    expect(attempts[0]).toBe(documentOf(destination));
    expect(attempts.filter((url) => url === failureUrl)).toHaveLength(2);
    // A new client simulates a refresh, with no optimistic state or recovery closure.
    const reader = new MailClient(pod.fetch, root);
    const sourcePage = await reader.threads(account, inbox);
    const destinationPage = await reader.threads(account, destination);
    expect(sourcePage.total + destinationPage.total).toBeGreaterThan(0);
    expect(await reader.search(account, "Garden")).toHaveLength(1);
    if (failing === "archive") expect(sourcePage.total).toBe(1);
    else expect(destinationPage.total).toBe(1);
    blocked = false;
    expect(await client.archive([message.iri])).toEqual({ done: [message.iri], failed: [] });
    expect((await reader.threads(account, inbox)).total).toBe(0);
    expect((await reader.threads(account, destination)).total).toBe(1);
    expect((await reader.thread(row.iri)).messages[0]?.labels).toEqual([destination]);
  });
  it("reconciles a partial archive with fresh validators and preserves a concurrent edit", async () => {
    const { client, inbox } = await imported(1);
    const row = (await client.threads(account, inbox)).items[0]!;
    const message = (await client.thread(row.iri)).messages[0]!;
    const original = client.store.save.bind(client.store);
    let conflict = true;
    const save = vi.spyOn(client.store, "save").mockImplementation(async (loaded, dataset) => {
      if (conflict && loaded.url === documentOf(inbox)) {
        conflict = false;
        const concurrent = await client.store.load(loaded.url);
        concurrent.mailbox.folder(inbox).title = "Concurrent title";
        await original(concurrent);
        // The old validator really fails at the transport, after Archive and message were saved.
      }
      return original(loaded, dataset);
    });
    expect(await client.archive([message.iri])).toEqual({ done: [message.iri], failed: [] });
    expect(save.mock.calls.filter(([doc]) => doc.url === documentOf(inbox))).toHaveLength(2);
    expect((await client.store.load(documentOf(inbox))).mailbox.folder(inbox).title).toBe(
      "Concurrent title",
    );
    expect((await client.threads(account, inbox)).total).toBe(0);
    save.mockRestore();
  });
  it("falls back per message for accepted NUL text while retaining the text and original", async () => {
    const { client, inbox } = setup();
    expect(
      await client.importMailbox(
        account,
        bytes(mailboxFixture(2).replace("Hello friends,", "Hello\0friends,")),
      ),
    ).toMatchObject({ messages: 2, failed: 0 });
    const row = (await client.threads(account, inbox)).items[0]!;
    const messages = (await client.thread(row.iri)).messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.text).toContain("Hello\0friends,");
    expect(messages[0]?.quoted.visibleText).toContain("Hello\uFFFDfriends,");
    expect(messages[0]?.truncated).toBe(true);
    expect(messages[1]?.quoted.hasQuotedHistory).toBe(true);
    expect(await (await client.binaryFetch(messages[0]!.originalUrl!)).text()).toContain(
      "Hello\0friends,",
    );
    const iris = messages.map((message) => message.iri);
    expect((await client.markRead(iris, true)).failed).toEqual([]);
    await client.star(iris[0]!, true);
    expect((await client.archive(iris)).failed).toEqual([]);
  });
  it("searches decoded sender, To and Cc names as well as their addresses, including the owner", async () => {
    const { client, inbox, pod } = setup();
    await client.importMailbox(
      account,
      bytes(
        mailboxFixture(1)
          .replace("Mira Vale", "=?UTF-8?Q?Ada_Moss?=")
          .replace("mira@example.org", "a@example.org")
          .replace("Garden friends", "=?UTF-8?Q?Ren=C3=A9_Leaf?="),
      ),
    );
    const iri = (await client.threads(account, inbox)).items[0]!.iri;
    const owner = new MailClient(pod.fetch, root, "mailto:a@example.org");
    for (const reader of [client, owner])
      for (const query of [
        "from:Ada",
        'from:"Ada Moss"',
        "from:a@example.org",
        "to:René",
        "to:friends@example.org",
        "to:Alex",
        "to:alex@example.org",
        "Moss",
      ])
        expect((await reader.search(account, query)).map((row) => row.iri)).toEqual([iri]);
  });
});

it("falls back to addresses when headers have no display names", async () => {
  const { client, inbox } = setup();
  await client.importMailbox(
    account,
    bytes(
      "From sender@example.org Thu Jan 01 00:00:00 2026\nFrom: sender@example.org\nTo: reader@example.net\nCc: cc@example.org\n\nHello\n",
    ),
  );
  const row = (await client.threads(account, inbox)).items[0]!;
  expect(row.participants).toEqual(["sender@example.org", "reader@example.net", "cc@example.org"]);
  expect((await client.thread(row.iri)).messages[0]).toMatchObject({
    from: "sender@example.org",
    to: ["reader@example.net"],
    cc: ["cc@example.org"],
  });
  expect(await client.search(account, "from:sender@example.org")).toHaveLength(1);
  expect(await client.search(account, "to:reader@example.net")).toHaveLength(1);
});
it("keeps folder-list network, server and access errors distinct from an empty account", async () => {
  for (const status of [401, 403, 500]) {
    const { client } = setup(() => async () => new Response(null, { status }));
    await expect(client.folders(account)).rejects.toMatchObject(
      status === 500 ? { status } : { code: "forbidden", status },
    );
  }
  const { client } = setup();
  vi.spyOn(client.store, "list").mockRejectedValue(new Error("network"));
  await expect(client.folders(account)).rejects.toThrow("network");
});
it("counts an unread conversation even when the label is on a read member only", async () => {
  const { client, inbox } = await imported(2);
  const thread = await client.thread((await client.threads(account, inbox)).items[0]!.iri);
  const label = await client.createLabel(account, "Read reply");
  expect(thread.messages[1]?.read).toBe(true);
  await client.label(thread.messages[1]!.iri, label, true);
  // The unread root can even have no folder: it is still part of this conversation.
  for (const folder of thread.messages[0]!.labels)
    await client.label(thread.messages[0]!.iri, folder, false);
  expect((await client.folders(account)).find((folder) => folder.iri === label)).toMatchObject({
    total: 1,
    unread: 1,
  });
});
