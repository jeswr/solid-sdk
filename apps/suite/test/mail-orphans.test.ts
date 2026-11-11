// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { folderIriFromKey, MailClient } from "../src/apps/mail/lib/client";
import {
  folderCounts,
  loadFolders,
  loadThreads,
  MailStore,
  Message,
  pageThreads,
} from "../src/apps/mail/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { emptyMailbox } from "./mail/helpers";

const root = "https://mail.example/mail/personal/";
const folder = `${root}folders/system:inbox.ttl#it`;
const missing = `${root}threads/missing.ttl#it`;

describe("mail rows without loaded threads", () => {
  it("pages single-message rows alongside real threads with stable identities and ties", () => {
    const mailbox = emptyMailbox();
    const inbox = mailbox.createFolder(folder);
    const thread = mailbox.createThread(`${root}threads/real.ttl#it`);
    for (const [id, link, date] of [
      ["z", missing, "2026-06-03"],
      ["b", undefined, "2026-06-02"],
      ["a", missing, "2026-06-02"],
      ["real", thread.value, "2026-06-01"],
    ] as const) {
      const m = mailbox.createMessage(`${root}messages/${id}.ttl#it`);
      m.partOfThread = link;
      m.dateSent = new Date(date);
      // Cover both membership directions, and both at once without duplication.
      if (id !== "a") inbox.addMessage(m.value);
      if (id !== "b") m.folderIris.add(folder);
    }
    const reply = mailbox.createMessage(`${root}messages/reply.ttl#it`);
    thread.addMessage(reply.value); // No partOfThread, but covered by a real thread.
    inbox.addMessage(reply.value);
    const outside = mailbox.createMessage(`${root}messages/outside.ttl#it`);
    outside.partOfThread = missing;
    const ids = ["z", "a", "b"].map((id) => `${root}messages/${id}.ttl#it`);
    ids.push(thread.value);
    const page = pageThreads(mailbox, folder, 0, 2);
    expect(page.items.map((row) => row.id)).toEqual(ids.slice(0, 2));
    expect(page).toMatchObject({ total: 4, next: 2 });
    expect(page.items.every((row) => row.thread === undefined && row.messages.length === 1)).toBe(
      true,
    );
    expect(pageThreads(mailbox, folder, 2, 2).items.map((row) => row.id)).toEqual(ids.slice(2));
    expect(pageThreads(mailbox, folder, 2, 2).next).toBeNull();
    expect(pageThreads(mailbox, folder, 4, 2)).toEqual({ items: [], total: 4, next: null });
    expect(pageThreads(mailbox, folder).items.map((row) => row.id)).toEqual(ids);
    expect(pageThreads(mailbox, folder).items.at(-1)?.messages).toHaveLength(2);
  });

  it.each([
    missing,
    undefined,
  ])("lists and opens a lone message with thread %s through the fixture store", async (link) => {
    const pod = createDemoPod({ root: "https://mail.example/" });
    const client = new MailClient(pod.fetch, "https://mail.example/");
    const iri = `${root}messages/orphan.ttl#it`;
    const loaded = await client.store.load(iri.split("#")[0] as string, true);
    const message = loaded.mailbox.createMessage(iri);
    message.partOfThread = link;
    message.folderIris.add(folder);
    message.sender = "mailto:alice@example.org";
    message.subjectLine = "Still reachable";
    message.body = "One message to read.";
    message.dateSent = new Date("2026-06-01T12:00:00Z");
    await client.store.save(loaded);
    const inbox = await client.store.load(folder.split("#")[0] as string, true);
    inbox.mailbox.createFolder(folder).addMessage(iri);
    await client.store.save(inbox);
    expect(folderCounts(inbox.mailbox)[0]?.total).toBe(1);
    expect((await loadThreads(client.store, folder)).items[0]).toMatchObject({
      id: iri,
      thread: undefined,
    });
    expect((await client.folders("personal")).find((f) => f.iri === folder)).toMatchObject({
      total: 1,
      unread: 1,
    });
    const page = await client.threads("personal", folder);
    expect(page).toMatchObject({
      total: 1,
      next: null,
      items: [
        {
          iri,
          count: 1,
          unread: true,
          subject: "Still reachable",
          snippet: "One message to read.",
          participants: ["alice@example.org"],
        },
      ],
    });
    expect((await client.threads("personal", folder)).items[0]?.iri).toBe(iri);
    expect((await client.thread(iri)).messages.map((m) => m.iri)).toEqual([iri]);
    expect((await client.search("personal", "reachable")).map((row) => row.iri)).toEqual([iri]);
    expect(await client.markRead([iri], true)).toEqual({ done: [iri], failed: [] });
    expect((await client.thread(iri)).messages[0]?.read).toBe(true);
    const label = await client.createLabel("personal", "Work");
    await client.label(iri, label, true);
    await client.label(iri, folder, false);
    expect((await client.threads("personal", label)).items[0]?.iri).toBe(iri);
    expect((await client.threads("personal", folder)).total).toBe(0);
    await client.label(iri, folder, true);
    expect(await client.archive([iri])).toEqual({ done: [iri], failed: [] });
    expect((await client.threads("personal", folder)).total).toBe(0);
    expect(
      (await client.threads("personal", folderIriFromKey(root, "archive"))).items[0]?.iri,
    ).toBe(iri);
  });
});

it.each([
  401, 403, 404, 410,
])("keeps readable messages reachable when thread metadata returns %i", async (status) => {
  const pod = createDemoPod({ root: "https://mail.example/" });
  const client = new MailClient(
    async (input, init) =>
      String(input).includes("threads/missing.ttl")
        ? new Response(null, { status })
        : pod.fetch(input, init),
    "https://mail.example/",
  );
  const loaded = await client.store.load(`${root}messages/orphan.ttl`, true);
  const message = loaded.mailbox.createMessage(`${loaded.url}#it`);
  message.partOfThread = missing;
  message.subjectLine = "reachable";
  await client.store.save(loaded);
  const inbox = await client.store.load(folder.split("#")[0]!, true);
  inbox.mailbox.createFolder(folder).addMessage(message.value);
  await client.store.save(inbox);
  expect((await client.folders("personal")).find((f) => f.iri === folder)?.unread).toBe(1);
  expect((await client.threads("personal", folder)).items.map((row) => row.iri)).toEqual([
    message.value,
  ]);
  expect((await client.search("personal", "reachable")).map((row) => row.iri)).toEqual([
    message.value,
  ]);
});

it("indexes 1,000 threads across eight folders within a linear access budget", async () => {
  const mailbox = emptyMailbox();
  const url = `${root}all.ttl`;
  const folders = Array.from({ length: 8 }, (_, i) => mailbox.createFolder(`${url}#folder-${i}`));
  for (let i = 0; i < 1000; i++) {
    const thread = mailbox.createThread(`${url}#thread-${i}`);
    for (let j = 0; j < 2; j++) {
      const message = mailbox.createMessage(`${url}#message-${i}-${j}`);
      message.partOfThread = thread.value;
      thread.addMessage(message.value);
      for (const folder of folders) folder.addMessage(message.value);
    }
  }
  const store = new MailStore(vi.fn(), "https://mail.example/");
  vi.spyOn(store, "list").mockResolvedValue([url]);
  vi.spyOn(store, "load").mockResolvedValue({ mailbox, url, exists: true, etag: '"1"' });
  const getter = Object.getOwnPropertyDescriptor(Message.prototype, "partOfThread")!.get!;
  let reads = 0;
  const spy = vi.spyOn(Message.prototype, "partOfThread", "get").mockImplementation(function (
    this: Message,
  ) {
    if (++reads > 20_000) throw new Error("Repeated whole-mailbox thread scans");
    return getter.call(this);
  });
  try {
    const start = performance.now();
    expect((await loadFolders(store, root)).map((f) => f.unreadThreads)).toEqual(
      Array(8).fill(1000),
    );
    reads = 0;
    expect(pageThreads(mailbox, folders[0]!.value).total).toBe(1000);
    expect(performance.now() - start).toBeLessThan(15_000);
  } finally {
    spy.mockRestore();
  }
});

it("searches healthy threads and each orphan together, while surfacing server failures", async () => {
  const pod = createDemoPod({ root: "https://mail.example/" });
  let broken = false;
  const client = new MailClient(
    async (input, init) =>
      broken && String(input).includes("threads/missing.ttl")
        ? new Response(null, { status: 500 })
        : pod.fetch(input, init),
    "https://mail.example/",
  );
  const loaded = await client.store.load(`${root}messages/search.ttl`, true);
  const inbox = await client.store.load(folder.split("#")[0] as string, true);
  const collection = inbox.mailbox.createFolder(folder);
  const thread = await client.store.load(`${root}threads/healthy.ttl`, true);
  const healthy = thread.mailbox.createThread(`${thread.url}#it`);
  for (const [id, link] of [
    ["a", missing],
    ["b", missing],
    ["c", undefined],
    ["d", healthy.value],
    ["e", healthy.value],
  ] as const) {
    const message = loaded.mailbox.createMessage(`${loaded.url}#${id}`);
    message.subjectLine = "reachable";
    message.partOfThread = link;
    collection.addMessage(message.value);
    if (link === healthy.value) healthy.addMessage(message.value);
  }
  await client.store.save(loaded);
  await client.store.save(inbox);
  await client.store.save(thread);
  const rows = await client.search("personal", "reachable");
  expect(rows.map((row) => [row.iri, row.count])).toEqual([
    ...["a", "b", "c"].map((id) => [`${loaded.url}#${id}`, 1]),
    [healthy.value, 2],
  ]);
  const folders = await client.folders("personal");
  vi.spyOn(client, "folders").mockResolvedValue(folders);
  broken = true;
  await expect(client.search("personal", "reachable")).rejects.toMatchObject({ status: 500 });
});

it("preserves both rows when inconsistent thread documents reference the same message", () => {
  const mailbox = emptyMailbox();
  const inbox = mailbox.createFolder(folder);
  const a = mailbox.createThread(`${root}threads/a.ttl#it`);
  const b = mailbox.createThread(`${root}threads/b.ttl#it`);
  const message = mailbox.createMessage(`${root}messages/shared.ttl#it`);
  message.partOfThread = a.value;
  b.addMessage(message.value);
  inbox.addMessage(message.value);
  const rows = pageThreads(mailbox, folder);
  expect(rows.items.map((row) => [row.id, row.messages.map((m) => m.value)])).toEqual([
    [a.value, [message.value]],
    [b.value, [message.value]],
  ]);
  expect(folderCounts(mailbox)[0]).toMatchObject({ total: 1, unread: 1, unreadThreads: 2 });
});
