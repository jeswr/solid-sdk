// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { folderIriFromKey, MailClient } from "../src/apps/mail/lib/client";
import { folderCounts, loadThreads, pageThreads } from "../src/apps/mail/lib/model";
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
