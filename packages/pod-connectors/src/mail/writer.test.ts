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
import { createMailWriter, type MailWriter } from "./writer.js";

const ROOT = `${TEST_POD_ROOT}integrations/takeout/`;

async function withWriter(run: (mail: MailWriter, ctx: ImportContext) => Promise<void>) {
  const pod = createMemoryPod();
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
        await mail.flush();
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

describe("MailWriter", () => {
  it("derives threads from In-Reply-To without a source thread key", async () => {
    const pod = await withWriter(async (mail) => {
      await mail.add({ raw: raw("a"), folders: ["Inbox"], read: true, fallbackId: "f1" });
      await mail.add({
        raw: raw("b", ["In-Reply-To: <a@x.test>"]),
        folders: ["Inbox"],
        read: false,
        fallbackId: "f2",
      });
    });
    const thread = `${ROOT}${threadSlug("me@example.test", "<a@x.test>")}`;
    expect(
      [...new MailCollection(`${thread}#it`, pod.dataset(thread), DataFactory).members].length,
    ).toBe(2);
    const first = `${ROOT}${messageSlug("me@example.test", "<a@x.test>")}`;
    expect(new MailMessage(`${first}#it`, pod.dataset(first), DataFactory).dateRead).toEqual(
      new Date(0),
    );
  });

  it("ignores malformed Message-ID headers and keeps empty system folders", async () => {
    const pod = await withWriter(async (mail) => {
      const slug = await mail.add({
        raw: raw("two> <ids"),
        folders: ["Inbox", "Projects"],
        read: true,
        fallbackId: "fallback-1",
      });
      expect(slug).toBe(messageSlug("me@example.test", "fallback-1"));
      expect(await mail.threadMessages("fallback-1")).toEqual([slug]);
      await mail.flush();
      await mail.removeMessage(slug);
      await mail.removeMessage(slug);
      expect(await mail.threadMessages("fallback-1")).toEqual([]);
    });
    const inbox = `${ROOT}${folderSlug("me@example.test", "Inbox")}`;
    expect(pod.get(inbox)).toBeDefined();
    expect(new MailCollection(`${inbox}#it`, pod.dataset(inbox), DataFactory).members.size).toBe(0);
    expect(pod.get(`${ROOT}${folderSlug("me@example.test", "Projects")}`)).toBeUndefined();
  });
});
