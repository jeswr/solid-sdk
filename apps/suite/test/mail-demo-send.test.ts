// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { folderIriFromKey, MailClient } from "../src/apps/mail/lib/client";
import { documentOf, MailError, sendDemoDraft } from "../src/apps/mail/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const storage = "https://alice.demo.pod/";
const me = `${storage}profile/card#me`;
const account = "personal";
const fields = { to: ["bob@example.org"], cc: [], subject: "Plans", text: "See you Saturday." };
const now = new Date("2026-11-11T12:34:56Z");
function setup(wrap: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch = (f) => f) {
  const pod = createDemoPod({ root: storage });
  const fetch = vi.fn(wrap(pod.fetch));
  const client = new MailClient(fetch, storage, me, "demo");
  const root = client.root(account);
  return {
    pod,
    fetch,
    client,
    root,
    drafts: folderIriFromKey(root, "drafts"),
    sent: folderIriFromKey(root, "sent"),
  };
}

describe("demo Send", () => {
  it("moves both memberships to a newly created Sent, stamps the date and updates the thread", async () => {
    const { client, fetch, drafts, sent, root } = setup();
    const saved = await client.saveDraft(account, fields);
    const draft = await client.draft(saved.iri);
    const threadBefore = await client.store.load(documentOf(draft.thread));
    fetch.mockClear();
    expect(await sendDemoDraft(client.store, root, saved, now)).toBe(saved.iri);
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(writes).toHaveLength(4);
    expect(writes.map(([url]) => String(url))).toEqual([
      documentOf(saved.iri),
      documentOf(draft.thread),
      documentOf(sent),
      documentOf(drafts),
    ]);
    expect(new Headers(writes[0]?.[1]?.headers).get("if-match")).toBe(saved.etag);
    expect(new Headers(writes[1]?.[1]?.headers).get("if-match")).toBe(threadBefore.etag);
    expect(new Headers(writes[2]?.[1]?.headers).get("if-none-match")).toBe("*");
    for (const [url, init] of fetch.mock.calls) {
      expect(String(url).startsWith(root)).toBe(true);
      expect(init?.method ?? "GET").toMatch(/^(GET|PUT)$/);
      if (init?.method === "PUT") {
        const headers = new Headers(init.headers);
        expect(headers.has("if-match") || headers.get("if-none-match") === "*").toBe(true);
      }
    }
    const message = (await client.store.load(documentOf(saved.iri))).mailbox.message(saved.iri);
    expect(message.dateSent).toEqual(now);
    expect(message.sender).toBeUndefined();
    expect(message.folderIris.has(drafts)).toBe(false);
    expect(message.folderIris.has(sent)).toBe(true);
    expect(message.partOfThread).toBe(draft.thread);
    const thread = (await client.store.load(documentOf(draft.thread))).mailbox.thread(draft.thread);
    expect(thread.title).toBe(fields.subject);
    expect([...thread.messageIris]).toEqual([saved.iri]);
    expect(thread.created).toEqual(now);
    expect(thread.modified).toEqual(now);
    expect((await client.threads(account, drafts)).total).toBe(0);
    const page = await client.threads(account, sent);
    expect(page.items).toMatchObject([{ iri: draft.thread, latest: now, count: 1, unread: false }]);
    expect((await client.thread(draft.thread)).messages).toMatchObject([
      { iri: saved.iri, draft: false, date: now, from: "Unknown sender", labels: [sent] },
    ]);
    const counts = await client.folders(account);
    expect(counts.find((f) => f.key === "drafts")).toMatchObject({ total: 0, unread: 0 });
    expect(counts.find((f) => f.key === "sent")).toMatchObject({
      title: "Sent",
      total: 1,
      unread: 0,
    });
    await expect(client.draft(saved.iri)).rejects.toMatchObject({ code: "not-found" });
    await expect(client.sendDemo(saved.iri, saved.etag)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("keeps a known sender, other labels, existing Sent members and the thread creation date", async () => {
    const { client, sent } = setup();
    const previous = await client.saveDraft(account, fields);
    await client.sendDemo(previous.iri, previous.etag);
    const saved = await client.saveDraft(account, { ...fields, to: [], cc: ["cara@example.org"] });
    const label = await client.createLabel(account, "Garden");
    await client.label(saved.iri, label, true);
    const loaded = await client.store.load(documentOf(saved.iri));
    loaded.mailbox.message(saved.iri).sender = "mailto:alice@example.org";
    await client.store.save(loaded);
    const draft = await client.draft(saved.iri);
    const created = new Date("2026-01-01T00:00:00Z");
    await client.store.mutate(documentOf(draft.thread), (box) => {
      box.thread(draft.thread).created = created;
    });
    expect(await client.sendDemo(saved.iri, loaded.etag)).toBe(saved.iri);
    const view = await client.thread(draft.thread);
    expect(view.messages[0]).toMatchObject({
      from: "alice@example.org",
      to: [],
      cc: ["cara@example.org"],
      labels: expect.arrayContaining([label, sent]),
    });
    expect((await client.threads(account, sent)).total).toBe(2);
    expect((await client.folders(account)).find((f) => f.iri === label)?.total).toBe(1);
    const thread = (await client.store.load(documentOf(draft.thread))).mailbox.thread(draft.thread);
    expect(thread.created).toEqual(created);
  });

  it("repairs a sparse app draft's missing thread using the normal sent thread shape", async () => {
    const { client, root } = setup();
    const saved = await client.saveDraft(account, fields);
    const draft = await client.draft(saved.iri);
    await client.store.mutate(documentOf(saved.iri), (box) => {
      const message = box.message(saved.iri);
      message.partOfThread = undefined;
      message.subjectLine = undefined;
      message.body = undefined;
      message.sender = undefined;
    });
    await client.binaryFetch(documentOf(draft.thread), { method: "DELETE" });
    const latest = await client.draft(saved.iri);
    await sendDemoDraft(client.store, root, latest, now);
    const thread = await client.thread(draft.thread);
    expect(thread.subject).toBe("(No subject)");
    expect(thread.messages).toMatchObject([{ iri: saved.iri, text: "", draft: false }]);
  });

  it.each([
    undefined,
    "solid",
    "extension",
  ] as const)("refuses session mode %s before any I/O", async (mode) => {
    const { pod, root } = setup();
    const fetch = vi.fn(pod.fetch);
    const client = new MailClient(fetch, storage, me, mode);
    await expect(client.sendDemo(`${root}messages/anything.ttl#it`, '"etag"')).rejects.toEqual(
      new MailError("forbidden", 403),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects imported/non-draft messages, no recipients and invalid stored fields without writes", async () => {
    const { client, fetch, root, drafts } = setup();
    for (const iri of [`${root}messages/imported.ttl#it`, `${root}messages/draft-x.ttl#it`])
      await expect(client.sendDemo(iri, null)).rejects.toMatchObject({ code: "not-found" });
    const empty = await client.saveDraft(account, { ...fields, to: [] });
    fetch.mockClear();
    await expect(client.sendDemo(empty.iri, empty.etag)).rejects.toThrow(/recipient/);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    const saved = await client.saveDraft(account, fields);
    const loaded = await client.store.load(documentOf(saved.iri));
    const message = loaded.mailbox.message(saved.iri);
    message.to.add("mailto:not-an-address");
    await client.store.save(loaded);
    await expect(client.sendDemo(saved.iri, loaded.etag)).rejects.toThrow(/Not an email/);
    message.to.delete("mailto:not-an-address");
    message.partOfThread = `${root}threads/shared.ttl#it`;
    await client.store.save(loaded);
    await expect(client.sendDemo(saved.iri, loaded.etag)).rejects.toThrow(/Invalid draft thread/);
    message.folderIris.delete(drafts);
    await client.store.save(loaded);
    await expect(client.sendDemo(saved.iri, loaded.etag)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("rejects invalid dates, stale caller ETags and missing validators without overwriting edits", async () => {
    const { client, root } = setup();
    const saved = await client.saveDraft(account, fields);
    await expect(sendDemoDraft(client.store, root, saved, new Date("invalid"))).rejects.toThrow(
      /Invalid send date/,
    );
    const latest = await client.saveDraft(account, { ...fields, text: "Newer edit" }, saved);
    await expect(client.sendDemo(saved.iri, saved.etag)).rejects.toMatchObject({
      code: "conflict",
      status: 412,
    });
    expect((await client.draft(saved.iri)).text).toBe("Newer edit");
    const noValidator = setup((fetch) => async (url, init) => {
      const response = await fetch(url, init);
      response.headers.delete("etag");
      return response;
    });
    const unsafe = await noValidator.client.saveDraft(account, fields);
    await expect(noValidator.client.sendDemo(unsafe.iri, null)).rejects.toMatchObject({
      code: "no-validator",
    });
    expect((await client.draft(saved.iri)).etag).toBe(latest.etag);
  });

  it("surfaces a message PUT race as conflict before changing thread or folders", async () => {
    let armed = false;
    const { client, fetch, drafts, sent } = setup(
      (fetch) => async (url, init) =>
        armed && init?.method === "PUT" && String(url).includes("/messages/")
          ? new Response(null, { status: 412 })
          : fetch(url, init),
    );
    const saved = await client.saveDraft(account, fields);
    armed = true;
    fetch.mockClear();
    await expect(client.sendDemo(saved.iri, saved.etag)).rejects.toMatchObject({
      code: "conflict",
      status: 412,
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect((await client.threads(account, drafts)).total).toBe(1);
    expect((await client.threads(account, sent)).total).toBe(0);
  });

  it.each([
    "sent",
    "drafts",
  ])("re-reads a racing %s folder and preserves unrelated members", async (kind) => {
    let conflicts = 0;
    const { client, drafts, sent } = setup(
      (fetch) => async (url, init) =>
        init?.method === "PUT" && String(url).includes(`system:${kind}`) && conflicts-- > 0
          ? new Response(null, { status: 412 })
          : fetch(url, init),
    );
    const first = await client.saveDraft(account, fields);
    const other = await client.saveDraft(account, { ...fields, subject: "Other draft" });
    conflicts = 1;
    await client.sendDemo(first.iri, first.etag);
    expect((await client.threads(account, drafts)).items.map((t) => t.subject)).toEqual([
      "Other draft",
    ]);
    expect((await client.threads(account, sent)).items.map((t) => t.subject)).toEqual(["Plans"]);
    expect((await client.draft(other.iri)).subject).toBe("Other draft");
  });

  it.each([
    412, 500,
  ])("surfaces a Sent folder failure (%s) instead of claiming success", async (status) => {
    let armed = false;
    const { client } = setup(
      (fetch) => async (url, init) =>
        armed && init?.method === "PUT" && String(url).includes("system:sent")
          ? new Response(null, { status })
          : fetch(url, init),
    );
    const saved = await client.saveDraft(account, fields);
    armed = true;
    await expect(client.sendDemo(saved.iri, saved.etag)).rejects.toMatchObject({
      code: status === 412 ? "conflict" : "http",
      status,
    });
  });
});
