// AUTHORED-BY Claude Opus 5.5
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import type { ImportContext } from "../core/types.js";
import { rawMessage } from "../gmail/fixtures.js";
import { attachmentSlug, emlSlug, folderSlug, messageSlug, pathId, threadSlug } from "./paths.js";
import { MailCollection, MailMessage } from "./vocab.js";
import { createMailWriter, type MailFolder, MailParseError, type MailWriter } from "./writer.js";

const ROOT = `${TEST_POD_ROOT}integrations/takeout/`;
const ME = "me@example.test";

async function withWriter(
  run: (mail: MailWriter, ctx: ImportContext) => Promise<void>,
  pod = createMemoryPod(),
  known?: readonly MailFolder[],
  fetch: typeof globalThis.fetch = pod.fetch,
) {
  await runImport({
    adapter: {
      metadata: {
        id: "takeout",
        name: "T",
        tier: "C",
        authKind: "export-file",
        scopes: [],
        categories: ["mail"],
        whatYouGet: "",
        requirements: [],
      },
      fixtures: () => [],
      async import(ctx) {
        const mail = createMailWriter(ctx, "me@example.test");
        await run(mail, ctx);
        await mail.flush(known);
        return {};
      },
    },
    podWriter: createFetchPodWriter({
      adapterId: "takeout",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch,
    }),
    mode: "demo",
  });
  return pod;
}

const raw = (id: string, extra: string[] = []) =>
  Uint8Array.from(
    atob(
      rawMessage([`Message-ID: <${id}@x.test>`, ...extra, "Subject: S", "", "B"])
        .replace(/-/g, "+")
        .replace(/_/g, "/"),
    ),
    (c) => c.charCodeAt(0),
  );

/** A MailWriter over the pod without this process's import session (another host). */
function foreign(pod: ReturnType<typeof createMemoryPod>): MailWriter {
  const writer = createFetchPodWriter({
    adapterId: "takeout",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const etags = new Map<string, string | undefined>();
  return createMailWriter(
    {
      resolve: writer.resolve,
      async read(slug) {
        const found = await writer.read(slug);
        etags.set(slug, found?.etag);
        return found?.dataset;
      },
      write: (doc) =>
        writer.write(
          doc,
          etags.get(doc.slug) ? { ifMatch: etags.get(doc.slug) } : { ifNoneMatch: "*" },
        ),
      writeBinary: async (doc) =>
        (writer.writeBinary as NonNullable<typeof writer.writeBinary>)(doc),
      remove: async (slug) => (writer.remove as NonNullable<typeof writer.remove>)(slug),
    },
    ME,
  );
}

describe("mail paths", () => {
  it("matches the MAI-01 layout and escaping", () => {
    expect(pathId("a~b%c/d:e")).toBe("a~7Eb~25c~2Fd~3Ae");
    expect(messageSlug("me@x", "<1@x>")).toBe("mail/me~40x/messages/~3C1~40x~3E.ttl");
    expect(threadSlug("me@x", "t")).toBe("mail/me~40x/threads/t.ttl");
    expect(folderSlug("me@x", "Inbox")).toBe("mail/me~40x/folders/system:inbox.ttl");
    expect(folderSlug("me@x", "Work:2026")).toBe("mail/me~40x/folders/Work~3A2026.ttl");
    expect(attachmentSlug("me@x", "<1@x>", 2)).toBe("mail/attachments/me~40x/~3C1~40x~3E-2");
  });

  it.each(["", " ", ".", ".."])("rejects the empty or dot account %j", (account) => {
    expect(() => messageSlug(account, "1")).toThrow(TypeError);
  });
});

const INBOX = { key: "Inbox", title: "Inbox" };
const SENT = { key: "Sent", title: "Sent" };
const url = (slug: string) => `${ROOT}${slug}`;
const membersOf = (pod: ReturnType<typeof createMemoryPod>, slug: string) =>
  [...new MailCollection(`${url(slug)}#it`, pod.dataset(url(slug)), DataFactory).members].sort();

describe("MailWriter", () => {
  it("derives threads from References, then In-Reply-To, without a source thread key", async () => {
    const pod = await withWriter(async (mail) => {
      await mail.add({ raw: raw("a"), folders: [INBOX], read: true, fallbackId: "f1" });
      await mail.add({
        raw: raw("b", ["In-Reply-To: <a@x.test>"]),
        folders: [INBOX],
        read: false,
        fallbackId: "f2",
      });
      // A reply to b keeps the root from References, not its direct parent.
      await mail.add({
        raw: raw("c", ["References: <a@x.test>\r\n <b@x.test>", "In-Reply-To: <b@x.test>"]),
        folders: [INBOX],
        read: false,
        fallbackId: "f3",
      });
    });
    expect(membersOf(pod, threadSlug(ME, "<a@x.test>"))).toHaveLength(3);
    expect(pod.get(url(threadSlug(ME, "<b@x.test>")))).toBeUndefined();
    const first = url(messageSlug(ME, "<a@x.test>"));
    expect(new MailMessage(`${first}#it`, pod.dataset(first), DataFactory).dateRead).toEqual(
      new Date(0),
    );
  });

  it("ignores malformed Message-ID headers and keeps empty system folders", async () => {
    const pod = await withWriter(async (mail) => {
      const stored = await mail.add({
        raw: raw("two> <ids"),
        folders: [INBOX, { key: "Projects", title: "Projects" }],
        read: true,
        fallbackId: "fallback-1",
      });
      expect(stored.slug).toBe(messageSlug(ME, "fallback-1"));
      expect(stored.thread).toBe(`${url(threadSlug(ME, "fallback-1"))}#it`);
      await mail.flush();
      await mail.removeMessage(stored.slug);
      await mail.removeMessage(stored.slug, stored.thread);
    });
    const inbox = folderSlug(ME, "Inbox");
    expect(pod.get(url(inbox))).toBeDefined();
    expect(membersOf(pod, inbox)).toEqual([]);
    expect(pod.get(url(folderSlug(ME, "Projects")))).toBeUndefined();
    expect(pod.get(url(threadSlug(ME, "fallback-1")))).toBeUndefined();
  });

  it("keeps a colliding Message-ID from another source item under its fallback id", async () => {
    const pod = await withWriter(async (mail) => {
      const first = await mail.add({
        raw: raw("same", ["Subject: one"]),
        folders: [INBOX],
        read: true,
        fallbackId: "src-1",
        sourceUrl: "https://source.test/1",
      });
      const second = await mail.add({
        raw: raw("same", ["Subject: two"]),
        folders: [INBOX],
        read: true,
        fallbackId: "src-2",
        sourceUrl: "https://source.test/2",
      });
      const again = await mail.add({
        raw: raw("same"),
        folders: [INBOX],
        read: true,
        fallbackId: "src-1",
        sourceUrl: "https://source.test/1",
      });
      expect(first.slug).toBe(messageSlug(ME, "<same@x.test>"));
      expect(second.slug).toBe(messageSlug(ME, "src-2"));
      expect(again.slug).toBe(first.slug);
    });
    expect(pod.bytes(url(messageSlug(ME, "src-2").replace(/\.ttl$/, ".eml")))).toBeDefined();
    expect(membersOf(pod, folderSlug(ME, "Inbox"))).toHaveLength(2);
  });

  it("repairs folder and thread membership when a run is replayed after a crash", async () => {
    const pod = createMemoryPod();
    const item = (folders: { key: string; title: string }[]) => ({
      raw: raw("r"),
      folders,
      read: true,
      fallbackId: "r",
    });
    await withWriter(async (mail) => void (await mail.add(item([INBOX]))), pod);
    // Crashed run: the message moved to Sent, but flush never ran.
    await withWriter(async (mail) => {
      await mail.add(item([SENT]));
      throw new Error("crash");
    }, pod).catch(() => undefined);
    const slug = messageSlug(ME, "<r@x.test>");
    expect(membersOf(pod, folderSlug(ME, "Inbox"))).toEqual([`${url(slug)}#it`]);
    // The replay sees only the already-moved document; the known folders still repair Inbox.
    await withWriter(async (mail) => void (await mail.add(item([SENT]))), pod, [INBOX, SENT]);
    expect(membersOf(pod, folderSlug(ME, "Inbox"))).toEqual([]);
    expect(membersOf(pod, folderSlug(ME, "Sent"))).toEqual([`${url(slug)}#it`]);
  });

  it("drops thread members whose documents are gone, and renames folders", async () => {
    const pod = createMemoryPod();
    const label = (title: string) => ({ key: "Label_1", title });
    await withWriter(async (mail) => {
      await mail.add({
        raw: raw("t1"),
        folders: [label("Old")],
        read: true,
        fallbackId: "x",
        threadKey: "t",
      });
      await mail.add({
        raw: raw("t2"),
        folders: [label("Old")],
        read: true,
        fallbackId: "y",
        threadKey: "t",
      });
    }, pod);
    await withWriter(async (mail, ctx) => {
      await ctx.remove(messageSlug(ME, "<t1@x.test>"));
      await mail.add({
        raw: raw("t2"),
        folders: [label("New")],
        read: true,
        fallbackId: "y",
        threadKey: "t",
      });
    }, pod);
    expect(membersOf(pod, threadSlug(ME, "t"))).toEqual([
      `${url(messageSlug(ME, "<t2@x.test>"))}#it`,
    ]);
    const folder = url(folderSlug(ME, "Label_1"));
    expect(new MailCollection(`${folder}#it`, pod.dataset(folder), DataFactory).title).toBe("New");
  });

  it("follows a parent's stored thread for In-Reply-To chains without References", async () => {
    const pod = await withWriter(async (mail) => {
      await mail.add({ raw: raw("p1"), folders: [INBOX], read: true, fallbackId: "1" });
      await mail.add({
        raw: raw("p2", ["In-Reply-To: <p1@x.test>"]),
        folders: [INBOX],
        read: true,
        fallbackId: "2",
      });
      const third = await mail.add({
        raw: raw("p3", ["In-Reply-To: <p2@x.test>"]),
        folders: [INBOX],
        read: true,
        fallbackId: "3",
      });
      expect(third.thread).toBe(`${url(threadSlug(ME, "<p1@x.test>"))}#it`);
    });
    expect(membersOf(pod, threadSlug(ME, "<p1@x.test>"))).toHaveLength(3);
  });

  it("replaces bytes an interrupted write left without an owning message document", async () => {
    const pod = createMemoryPod();
    const eml = emlSlug(ME, "<own@x.test>");
    await withWriter(async (_mail, ctx) => {
      await ctx.writeBinary({ slug: eml, contentType: "message/rfc822", body: raw("own") });
      await ctx.writeBinary({
        slug: attachmentSlug(ME, "<own@x.test>", 0),
        contentType: "text/plain",
        body: new TextEncoder().encode("stale"),
      });
    }, pod);
    const fresh = raw("own", ["Subject: fresh"]);
    await withWriter(
      async (mail) =>
        void (await mail.add({
          raw: fresh,
          folders: [INBOX],
          read: true,
          fallbackId: "b",
          sourceUrl: "https://source.test/b",
        })),
      pod,
    );
    expect(pod.bytes(url(eml))).toEqual(fresh);
  });

  it("drops memberships of labels that vanished while a run was interrupted", async () => {
    const pod = createMemoryPod();
    const item = (folders: { key: string; title: string }[]) => ({
      raw: raw("gone"),
      folders,
      read: true,
      fallbackId: "g",
    });
    const label = { key: "Label_9", title: "Gone" };
    await withWriter(async (mail) => void (await mail.add(item([label]))), pod);
    await withWriter(async (mail) => {
      await mail.add(item([]));
      throw new Error("crash");
    }, pod).catch(() => undefined);
    await withWriter(async (mail) => void (await mail.add(item([]))), pod, []);
    expect(pod.get(url(folderSlug(ME, "Label_9")))).toBeUndefined();
  });

  it("follows the stored thread of a partial References root", async () => {
    const pod = await withWriter(async (mail) => {
      await mail.add({ raw: raw("q1"), folders: [INBOX], read: true, fallbackId: "1" });
      await mail.add({
        raw: raw("q2", ["In-Reply-To: <q1@x.test>"]),
        folders: [INBOX],
        read: true,
        fallbackId: "2",
      });
      await mail.add({
        raw: raw("q3", ["References: <q2@x.test>", "In-Reply-To: <q2@x.test>"]),
        folders: [INBOX],
        read: true,
        fallbackId: "3",
      });
    });
    expect(membersOf(pod, threadSlug(ME, "<q1@x.test>"))).toHaveLength(3);
  });

  it("lets the first committed message document own the bytes of a shared Message-ID", async () => {
    const pod = createMemoryPod();
    const doc = url(messageSlug(ME, "<race@x.test>"));
    const second = raw("race", ["Subject: second"]);
    let raced = false;
    // Import A reads first; import B commits the same Message-ID before A's document write.
    const racing: typeof fetch = async (input, init) => {
      if (!raced && String(input) === doc && init?.method === "PUT") {
        raced = true;
        // Another process (a second host) imports the same Message-ID meanwhile.
        await foreign(pod).add({
          raw: second,
          folders: [INBOX],
          read: true,
          fallbackId: "b",
          sourceUrl: "https://source.test/b",
        });
      }
      return pod.fetch(input, init);
    };
    await expect(
      withWriter(
        async (mail) =>
          void (await mail.add({
            raw: raw("race", ["Subject: first"]),
            folders: [INBOX],
            read: true,
            fallbackId: "a",
            sourceUrl: "https://source.test/a",
          })),
        pod,
        undefined,
        racing,
      ),
    ).rejects.toThrow();
    expect(pod.bytes(url(emlSlug(ME, "<race@x.test>")))).toEqual(second);
    expect(new MailMessage(`${doc}#it`, pod.dataset(doc), DataFactory).subjectLine).toBe("second");
  });

  it("sends an overlapping import of another item to its fallback once a document is committed", async () => {
    const pod = createMemoryPod();
    const eml = url(emlSlug(ME, "<race2@x.test>"));
    const first = raw("race2", ["Subject: first"]);
    let raced = false;
    const racing: typeof fetch = async (input, init) => {
      if (!raced && String(input) === eml && init?.method === "PUT") {
        raced = true;
        await foreign(pod).add({
          raw: raw("race2", ["Subject: second"]),
          folders: [INBOX],
          read: true,
          fallbackId: "b2",
          sourceUrl: "https://source.test/b2",
        });
      }
      return pod.fetch(input, init);
    };
    await withWriter(
      async (mail) =>
        void (await mail.add({
          raw: first,
          folders: [INBOX],
          read: true,
          fallbackId: "a2",
          sourceUrl: "https://source.test/a2",
        })),
      pod,
      undefined,
      racing,
    );
    expect(pod.bytes(eml)).toEqual(first);
    expect(pod.get(url(messageSlug(ME, "b2")))).toBeDefined();
  });

  it("retires dropped attachments before replacing the document that records them", async () => {
    const pod = createMemoryPod();
    const withFile = (files: number) =>
      raw("att", [
        'Content-Type: multipart/mixed; boundary="b"',
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "body",
        ...Array.from({ length: files }, (_, n) => [
          "--b",
          `Content-Type: application/pdf; name="f${n}.pdf"`,
          "Content-Disposition: attachment",
          "",
          `file ${n}`,
        ]).flat(),
        "--b--",
      ]);
    const item = (files: number) => ({
      raw: withFile(files),
      folders: [INBOX],
      read: true,
      fallbackId: "t",
    });
    await withWriter(async (mail) => void (await mail.add(item(2))), pod);
    const second = url(attachmentSlug(ME, "<att@x.test>", 1));
    expect(pod.bytes(second)).toBeDefined();
    // The DELETE fails: the message document still records the attachment for the replay.
    const failing: typeof fetch = async (input, init) =>
      init?.method === "DELETE" && String(input) === second
        ? new Response(null, { status: 500 })
        : pod.fetch(input, init);
    await expect(
      withWriter(async (mail) => void (await mail.add(item(1))), pod, undefined, failing),
    ).rejects.toThrow();
    const doc = url(messageSlug(ME, "<att@x.test>"));
    expect(
      new MailMessage(`${doc}#it`, pod.dataset(doc), DataFactory).attachments.has(second),
    ).toBe(true);
    await withWriter(async (mail) => void (await mail.add(item(1))), pod);
    expect(pod.bytes(second)).toBeUndefined();
  });

  it("keeps a stored message's thread when its parent arrives later", async () => {
    const pod = createMemoryPod();
    const reply = {
      raw: raw("late-child", ["In-Reply-To: <late-parent@x.test>"]),
      folders: [INBOX],
      read: true,
      fallbackId: "c",
    };
    await withWriter(async (mail) => void (await mail.add(reply)), pod);
    await withWriter(async (mail) => {
      await mail.add({ raw: raw("late-parent"), folders: [INBOX], read: true, fallbackId: "p" });
      const again = await mail.add(reply);
      expect(again.thread).toBe(`${url(threadSlug(ME, "<late-parent@x.test>"))}#it`);
    }, pod);
    // The provisional thread is the parent id, which the parent also uses: one conversation.
    expect(membersOf(pod, threadSlug(ME, "<late-parent@x.test>"))).toHaveLength(2);
  });

  it("rejects unparseable MIME with MailParseError", async () => {
    let nested = "";
    for (let i = 0; i < 300; i++)
      nested += `Content-Type: multipart/mixed; boundary="b${i}"\n\n--b${i}\n`;
    await withWriter(async (mail) => {
      await expect(
        mail.add({
          raw: new TextEncoder().encode(nested),
          folders: [],
          read: true,
          fallbackId: "n",
        }),
      ).rejects.toBeInstanceOf(MailParseError);
    });
  });
});
