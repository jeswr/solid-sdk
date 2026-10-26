// AUTHORED-BY Claude Opus 5.5
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import type { ImportContext } from "../core/types.js";
import { rawMessage } from "../gmail/fixtures.js";
import { attachmentSlug, folderSlug, messageSlug, pathId, threadSlug } from "./paths.js";
import { MailCollection, MailMessage } from "./vocab.js";
import { createMailWriter, type MailFolder, MailParseError, type MailWriter } from "./writer.js";

const ROOT = `${TEST_POD_ROOT}integrations/takeout/`;

async function withWriter(
  run: (mail: MailWriter, ctx: ImportContext) => Promise<void>,
  pod = createMemoryPod(),
  known?: readonly MailFolder[],
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
      fetch: pod.fetch,
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
const ME = "me@example.test";
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
