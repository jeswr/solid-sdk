// AUTHORED-BY Codex GPT-6.1-Sol
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
    expect(folders[0]).toMatchObject({ total: 50, unread: 25, system: true });
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
      participants: [
        "noel@example.org",
        "friends@example.org",
        "alex@example.org",
        "mira@example.org",
      ],
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
    expect((await client.folders(account))[0]?.unread).toBe(5);
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
  it("uses attachment fallbacks and surfaces failed binary metadata requests", async () => {
    const { client, inbox } = await imported(5);
    const row = (await client.threads(account, inbox)).items[0]!;
    const view = await client.thread(row.iri);
    const message = view.messages[3]!;
    const { Attachment } = await import("../src/apps/mail/lib/model");
    const loaded = await client.store.load(documentOf(message.iri));
    const metadata = new Attachment(message.attachments[0]!.url, loaded.mailbox, DataFactory);
    metadata.name = undefined;
    metadata.contentType = undefined;
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
    await expect(client.thread(row.iri)).rejects.toThrow("Couldn't load an attachment");
  });
});
