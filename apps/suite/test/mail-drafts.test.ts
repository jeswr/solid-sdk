// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { parseRecipients } from "../src/apps/mail/components/compose";
import { folderIriFromKey, MailClient } from "../src/apps/mail/lib/client";
import {
  createDraft,
  discardDraft,
  draftFields,
  isAppDraft,
  MailboxDataset,
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
const ID = "0b5c6c4e-1d2f-4a3b-8c9d-0e1f2a3b4c5d";
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
    const first = await client.saveDraft(account, input);
    const iri = first.iri;
    expect(iri).toMatch(/\/mail\/personal\/messages\/draft-[\da-f-]{36}\.ttl#it$/);
    expect(first.etag).toEqual(expect.any(String));
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
    const read = await client.draft(iri);
    expect(read).toMatchObject({ ...input, iri, thread: page.items[0]?.iri, etag: first.etag });
    const second = await client.saveDraft(
      account,
      { ...input, subject: "", cc: ["carol@example.net"] },
      read,
    );
    expect(second.etag).not.toBe(first.etag);
    const edited = await client.draft(iri);
    expect(edited).toMatchObject({ subject: "", cc: ["carol@example.net"] });
    expect((await client.thread(edited.thread)).subject).toBe("(No subject)");
    // A save or discard from a stale tab never overwrites the newer version.
    await expect(client.saveDraft(account, input, first)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(client.discardDraft(first)).rejects.toMatchObject({ code: "conflict" });
    // A second draft gets its own documents.
    const other = await client.saveDraft(account, { ...input, subject: "Second" });
    expect((await client.threads(account, drafts)).total).toBe(2);
    await client.discardDraft(second);
    expect((await client.threads(account, drafts)).items.map((row) => row.subject)).toEqual([
      "Second",
    ]);
    expect(pod.snapshot().resources.some(([url]) => url === iri.split("#")[0])).toBe(false);
    await expect(client.draft(iri)).rejects.toMatchObject({ code: "not-found" });
    await expect(client.saveDraft("work", input, other)).rejects.toThrow(/same account/);
    // A link to something that is not mail fails as a rejected promise, not a throw.
    await expect(client.draft("https://elsewhere.example/x.ttl#it")).rejects.toThrow();
  });

  it("only treats this app's own drafts under Drafts as editable", async () => {
    const { client, mailRoot } = setup();
    const saved = await client.saveDraft(account, input);
    // Moving the message out of Drafts (as sending would) makes it read-only here.
    await client.label(saved.iri, folderIriFromKey(mailRoot, "drafts"), false);
    await expect(client.draft(saved.iri)).rejects.toMatchObject({ code: "not-found" });
    await expect(client.saveDraft(account, input, saved)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(client.discardDraft(saved)).rejects.toMatchObject({ code: "not-found" });
    for (const bad of [
      `${mailRoot}messages/imported.ttl#it`,
      `${mailRoot}messages/draft-x.ttl#it`,
      `${mailRoot}messages/draft-${ID}.ttl`,
    ])
      await expect(client.draft(bad)).rejects.toMatchObject({ code: "not-found" });
    expect(isAppDraft(mailRoot, `${mailRoot}threads/draft-${ID}.ttl#it`, "threads")).toBe(true);
    expect(isAppDraft(mailRoot, `${mailRoot}threads/draft-${ID}.ttl#it`)).toBe(false);
    await expect(
      createDraft(client.store, mailRoot, me, input, "../x", new Date()),
    ).rejects.toThrow(/Invalid draft/);
  });

  it("refuses to overwrite existing documents, retries the shared folder and surfaces delete failures", async () => {
    const { client, mailRoot, pod } = setup();
    const at = new Date("2026-11-02T10:00:00Z");
    await createDraft(client.store, mailRoot, me, input, ID, at);
    await expect(createDraft(client.store, mailRoot, me, input, ID, at)).rejects.toMatchObject({
      code: "conflict",
    });
    // Thread document already present (an interrupted earlier attempt).
    await pod.fetch(`${mailRoot}messages/draft-${ID}.ttl`, { method: "DELETE" });
    await expect(createDraft(client.store, mailRoot, me, input, ID, at)).rejects.toMatchObject({
      code: "conflict",
    });
    // Another tab changing the Drafts folder between our read and write is retried.
    let conflicts = 1;
    const racing = setup(
      (fetch) => async (url, init) =>
        init?.method === "PUT" && String(url).includes("system:drafts") && conflicts-- > 0
          ? new Response(null, { status: 412 })
          : fetch(url, init),
    );
    const raced = await racing.client.saveDraft(account, input);
    expect((await racing.client.draft(raced.iri)).subject).toBe("Plans");
    expect((await racing.client.threads(account, racing.drafts)).total).toBe(1);
    // A folder that keeps changing eventually fails visibly; a later save refiles the draft.
    conflicts = 3;
    await expect(
      racing.client.saveDraft(account, { ...input, subject: "Lost" }),
    ).rejects.toMatchObject({ code: "conflict" });
    for (const status of [403, 412, 500]) {
      const failing = setup(
        (fetch) => async (url, init) =>
          init?.method === "DELETE" ? new Response(null, { status }) : fetch(url, init),
      );
      const saved = await failing.client.saveDraft(account, input);
      await expect(failing.client.discardDraft(saved)).rejects.toMatchObject({
        code: status === 403 ? "forbidden" : status === 412 ? "conflict" : "http",
        status,
      });
    }
    const deletes: (string | null)[] = [];
    const gone = setup((fetch) => async (url, init) => {
      if (init?.method !== "DELETE") return fetch(url, init);
      deletes.push(new Headers(init.headers).get("if-match"));
      return new Response(null, { status: 404 });
    });
    const doomed = await gone.client.saveDraft(account, input);
    await gone.client.discardDraft(doomed);
    expect(deletes).toEqual([doomed.etag, null]);
  });

  it("reads sparse drafts, repairs a lost Drafts entry and never retitles foreign threads", async () => {
    const { client, mailRoot, drafts } = setup();
    const url = `${mailRoot}messages/draft-${ID}.ttl`;
    const mailbox = new MailboxDataset(new Store(), DataFactory);
    const message = mailbox.createMessage(`${url}#it`);
    message.folderIris.add(drafts);
    await client.store.save({ mailbox, url, etag: null, exists: false });
    const sparse = await readDraft(client.store, mailRoot, `${url}#it`);
    expect(sparse).toMatchObject({
      iri: `${url}#it`,
      thread: `${url}#it`,
      to: [],
      cc: [],
      subject: "",
      text: "",
      updated: new Date(0),
    });
    // No thread to retitle; the missing Drafts entry is created by the save.
    const updated = await updateDraft(client.store, mailRoot, sparse, input, new Date());
    expect((await client.threads(account, drafts)).total).toBe(0);
    expect(
      (await client.store.load(drafts.split("#")[0] as string)).mailbox
        .folder(drafts)
        .messageIris.has(`${url}#it`),
    ).toBe(true);
    const remove = vi.fn(async () => undefined);
    await discardDraft(client.store, mailRoot, updated, remove);
    expect(remove).toHaveBeenCalledTimes(1);
    // A draft pointing at a shared thread neither retitles nor deletes that thread.
    const saved = await client.saveDraft(account, input);
    const thread = (await client.draft(saved.iri)).thread;
    await client.store.mutate(thread.split("#")[0] as string, (box) => {
      for (const quad of [...box]) box.delete(quad);
    });
    const retitled = await updateDraft(
      client.store,
      mailRoot,
      saved,
      { ...input, subject: "Again" },
      new Date(),
    );
    const shared = `${mailRoot}threads/shared.ttl`;
    await client.store.save({
      mailbox: Object.assign(new MailboxDataset(new Store(), DataFactory)),
      url: shared,
      etag: null,
      exists: false,
    });
    const linked = await client.store.load(saved.iri.split("#")[0] as string);
    linked.mailbox.message(saved.iri).partOfThread = `${shared}#it`;
    await client.store.save(linked);
    const latest = await updateDraft(
      client.store,
      mailRoot,
      { iri: saved.iri, etag: linked.etag },
      { ...input, subject: "Third" },
      new Date(),
    );
    expect(retitled.etag).not.toBe(latest.etag);
    const removed: string[] = [];
    await discardDraft(client.store, mailRoot, latest, async (target) => {
      removed.push(target);
    });
    expect(removed).toEqual([saved.iri.split("#")[0]]);
    const untitled = await client.saveDraft(account, { ...input, subject: "" });
    expect((await client.thread((await client.draft(untitled.iri)).thread)).subject).toBe(
      "(No subject)",
    );
  });
});
