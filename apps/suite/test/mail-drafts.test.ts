// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { parseRecipients } from "../src/apps/mail/components/compose";
import { folderIriFromKey, MailClient } from "../src/apps/mail/lib/client";
import {
  createDraft,
  discardDraft,
  draftFields,
  MailboxDataset,
  MailError,
  readDraft,
  updateDraft,
} from "../src/apps/mail/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://alice.demo.pod/";
const me = `${root}profile/card#me`;
const account = "personal";
function setup(wrap?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch) {
  const pod = createDemoPod({ root });
  const client = new MailClient(wrap ? wrap(pod.fetch) : pod.fetch, root, me);
  const mailRoot = client.root(account);
  return { pod, client, mailRoot, drafts: folderIriFromKey(mailRoot, "drafts") };
}
const input = { to: ["bob@example.org"], cc: [], subject: "Plans", text: "See you Saturday." };

describe("mail drafts", () => {
  it("parses comma, semicolon and newline separated recipients, keeping bracketed addresses", () => {
    expect(
      parseRecipients(" Bob <bob@example.org>, carol@example.net;\n\n dan@example.com "),
    ).toEqual(["bob@example.org", "carol@example.net", "dan@example.com"]);
    expect(parseRecipients("")).toEqual([]);
  });
  it("validates and normalises fields without accepting malformed addresses", () => {
    expect(
      draftFields({
        to: [" bob@example.org ", "bob@example.org", ""],
        cc: ["carol@example.net"],
        subject: "Line\r\nbreak",
        text: "Body",
      }),
    ).toEqual({
      to: ["bob@example.org"],
      cc: ["carol@example.net"],
      subject: "Line break",
      text: "Body",
    });
    expect(() => draftFields({ ...input, to: ["not an address"] })).toThrow(/Not an email/);
    expect(() => draftFields({ ...input, to: [`${"a".repeat(250)}@example.org`] })).toThrow(
      /Not an email/,
    );
    expect(() => draftFields({ ...input, cc: "x" as never })).toThrow(/Too many/);
    expect(() =>
      draftFields({ ...input, to: Array.from({ length: 101 }, (_, i) => `p${i}@example.org`) }),
    ).toThrow(/Too many/);
    expect(() => draftFields({ ...input, subject: "s".repeat(999) })).toThrow(/Subject/);
    expect(() => draftFields({ ...input, text: "t".repeat(1024 * 1024 + 1) })).toThrow(/Message/);
  });

  it("saves, lists, reads, edits and discards a draft through the client", async () => {
    const { client, pod, drafts } = setup();
    const iri = await client.saveDraft(account, input);
    expect(iri).toMatch(/\/mail\/personal\/messages\/draft-[\w-]+\.ttl#it$/);
    const folders = await client.folders(account);
    expect(folders.find((folder) => folder.key === "drafts")).toMatchObject({
      title: "Drafts",
      total: 1,
      unread: 0,
    });
    const page = await client.threads(account, drafts);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ subject: "Plans", unread: false });
    const view = await client.thread(page.items[0]?.iri as string);
    expect(view.messages[0]).toMatchObject({
      draft: true,
      subject: "Plans",
      to: ["bob@example.org"],
    });
    expect(await client.draft(iri)).toMatchObject({ ...input, iri, thread: page.items[0]?.iri });
    await client.saveDraft(account, { ...input, subject: "", cc: ["carol@example.net"] }, iri);
    const edited = await client.draft(iri);
    expect(edited).toMatchObject({ subject: "", cc: ["carol@example.net"] });
    expect((await client.thread(edited.thread)).subject).toBe("(No subject)");
    // A second draft gets its own documents.
    const other = await client.saveDraft(account, { ...input, subject: "Second" });
    expect((await client.threads(account, drafts)).total).toBe(2);
    await client.discardDraft(iri);
    expect((await client.threads(account, drafts)).items.map((row) => row.subject)).toEqual([
      "Second",
    ]);
    expect(pod.snapshot().resources.some(([url]) => url === iri.split("#")[0])).toBe(false);
    await expect(client.draft(iri)).rejects.toMatchObject({ code: "not-found" });
    await expect(client.saveDraft("work", input, other)).rejects.toThrow(/same account/);
  });

  it("never edits or discards mail outside Drafts", async () => {
    const { client, mailRoot } = setup();
    const iri = await client.saveDraft(account, input);
    // Moving the message out of Drafts (as sending would) makes it read-only here.
    await client.label(iri, folderIriFromKey(mailRoot, "drafts"), false);
    await expect(client.draft(iri)).rejects.toMatchObject({ code: "not-found" });
    await expect(client.saveDraft(account, input, iri)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(client.discardDraft(iri)).rejects.toMatchObject({ code: "not-found" });
    for (const bad of [`${mailRoot}messages/imported.ttl#it`, `${mailRoot}messages/draft-x.ttl`])
      await expect(client.draft(bad)).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses to overwrite existing documents and surfaces delete failures", async () => {
    const { client, mailRoot, pod } = setup();
    const at = new Date("2026-11-02T10:00:00Z");
    await createDraft(client.store, mailRoot, me, input, "fixed", at);
    await expect(createDraft(client.store, mailRoot, me, input, "fixed", at)).rejects.toMatchObject(
      { code: "conflict" },
    );
    // Thread document already present (an interrupted earlier attempt with another message id).
    await pod.fetch(`${mailRoot}messages/draft-fixed.ttl`, { method: "DELETE" });
    await expect(createDraft(client.store, mailRoot, me, input, "fixed", at)).rejects.toMatchObject(
      { code: "conflict" },
    );
    for (const status of [403, 500]) {
      const failing = setup(
        (fetch) => async (url, init) =>
          init?.method === "DELETE" ? new Response(null, { status }) : fetch(url, init),
      );
      const iri = await failing.client.saveDraft(account, input);
      await expect(failing.client.discardDraft(iri)).rejects.toMatchObject({
        code: status === 403 ? "forbidden" : "http",
        status,
      });
    }
    const gone = setup(
      (fetch) => async (url, init) =>
        init?.method === "DELETE" ? new Response(null, { status: 404 }) : fetch(url, init),
    );
    await gone.client.discardDraft(await gone.client.saveDraft(account, input));
  });

  it("reads sparse drafts and tolerates missing threads, titles and folder entries", async () => {
    const { client, mailRoot, drafts } = setup();
    const url = `${mailRoot}messages/draft-sparse.ttl`;
    const mailbox = new MailboxDataset(new Store(), DataFactory);
    const message = mailbox.createMessage(`${url}#it`);
    message.folderIris.add(drafts);
    await client.store.save({ mailbox, url, etag: null, exists: false });
    expect(await readDraft(client.store, mailRoot, `${url}#it`)).toEqual({
      iri: `${url}#it`,
      thread: `${url}#it`,
      to: [],
      cc: [],
      subject: "",
      text: "",
      updated: new Date(0),
    });
    // No thread to retitle; no Drafts folder entry to remove; thread outside drafts kept.
    await updateDraft(client.store, mailRoot, `${url}#it`, input, new Date());
    const remove = vi.fn(async () => undefined);
    await discardDraft(client.store, mailRoot, `${url}#it`, remove);
    expect(remove).toHaveBeenCalledTimes(1);
    // A draft whose thread document lacks the thread subject is still updated.
    const iri = await client.saveDraft(account, input);
    const thread = (await client.draft(iri)).thread;
    await client.store.mutate(thread.split("#")[0] as string, (box) => {
      for (const quad of [...box]) box.delete(quad);
    });
    await updateDraft(client.store, mailRoot, iri, { ...input, subject: "Again" }, new Date());
    const linked = await client.store.load(iri.split("#")[0] as string);
    linked.mailbox.message(iri).partOfThread = `${mailRoot}threads/shared.ttl#it`;
    await client.store.save(linked);
    const removed: string[] = [];
    await discardDraft(client.store, mailRoot, iri, async (target) => {
      removed.push(target);
    });
    expect(removed).toEqual([iri.split("#")[0]]);
    const untitled = await client.saveDraft(account, { ...input, subject: "" });
    expect((await client.thread((await client.draft(untitled)).thread)).subject).toBe(
      "(No subject)",
    );
    expect(MailError).toBeDefined();
  });
});
