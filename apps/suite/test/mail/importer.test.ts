// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/noNonNullAssertion: Assertions establish fixture entries before use.
import { readFile } from "node:fs/promises";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { Attachment } from "../../src/apps/mail/lib/model/attachment.js";
import {
  archiveMessage,
  folderCounts,
  pageThreads,
  setMembership,
  threadMessages,
} from "../../src/apps/mail/lib/model/helpers.js";
import { htmlToText } from "../../src/apps/mail/lib/model/htmlText.js";
import { importMbox, parseEmail, splitMbox } from "../../src/apps/mail/lib/model/importer.js";
import { parseMailbox } from "../../src/apps/mail/lib/model/io.js";
import { MailboxDataset } from "../../src/apps/mail/lib/model/mailbox.js";
import {
  attachmentUrl,
  mailDocument,
  mailRoot,
  systemFolderDocument,
} from "../../src/apps/mail/lib/model/paths.js";
import { serialiseToTurtle } from "../../src/apps/mail/lib/model/serialise.js";

const storage = "https://pod.example/alice/";
const root = mailRoot(storage, "personal");
async function* chunks(data: Uint8Array, size = 37) {
  for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}
const bytes = (text: string) => new TextEncoder().encode(text);
const collect = async (input: AsyncIterable<unknown>) => {
  const result = [];
  for await (const item of input) result.push(item);
  return result;
};

describe("streaming mbox and Gmail Takeout", () => {
  it("maps 50 MIME messages into ten threads, counted folders, raw source and decoded attachments", async () => {
    const source = await readFile(new URL("./fixtures/fifty.mbox", import.meta.url));
    const mailbox = new MailboxDataset(new Store(), DataFactory);
    let count = 0;
    for await (const item of importMbox(chunks(source), storage, "personal", () => "fallback")) {
      count++;
      for (const quad of item.mailbox) mailbox.add(quad);
      const thread = mailbox.createThread(item.thread);
      thread.addMessage(item.message);
      for (const folder of item.folders) {
        const f = mailbox.createFolder(folder.iri);
        f.title = folder.title;
        f.addMessage(item.message);
      }
      if (count === 1) {
        expect(item.attachments).toHaveLength(1);
        expect([...new Uint8Array(item.attachments[0]!.content)]).toEqual([0, 1, 2, 255]);
        expect(item.attachments[0]!.url).toBe(
          attachmentUrl(storage, "personal", "<m0@example.org>", 0),
        );
        expect(item.attachments[0]!.name).toBe("../../secret.bin");
        expect(new TextDecoder().decode(item.raw)).toContain("\nFrom quoted body");
        const m = item.mailbox.message(item.message);
        expect(m.body).toContain("First message");
        expect([...m.attachments]).toEqual([item.attachments[0]!.url]);
        const metadata = new Attachment(item.attachments[0]!.url, item.mailbox, DataFactory);
        expect(metadata.name).toBe("../../secret.bin");
        expect(metadata.contentType).toBe("application/octet-stream");
        expect(metadata.types.size).toBe(1);
        metadata.name = undefined;
        metadata.contentType = undefined;
        expect(metadata.name).toBeUndefined();
        expect(metadata.contentType).toBeUndefined();
      }
    }
    expect(count).toBe(50);
    expect([...mailbox.threads]).toHaveLength(10);
    const counts = folderCounts(mailbox);
    expect(counts.map((x) => [x.folder.title, x.total, x.unread])).toEqual([
      ["Inbox", 50, 25],
      ["Work", 50, 25],
      ["Starred", 25, 0],
    ]);
    const inbox = `${systemFolderDocument(root, "inbox")}#it`;
    const page = pageThreads(mailbox, inbox, 0, 3);
    expect(page.total).toBe(10);
    expect(page.next).toBe(3);
    expect(page.items).toHaveLength(3);
    expect(page.items[0]!.messages[0]!.identifier).toBe("<m45@example.org>");
    expect(pageThreads(mailbox, inbox, 9, 3).next).toBeNull();
    const roundtrip = await parseMailbox(serialiseToTurtle(mailbox), root);
    expect([...roundtrip.messages]).toHaveLength(50);
    expect([...roundtrip.folders]).toHaveLength(3);
  });
  it("preserves CRLF, escaped From lines and non-UTF8 bytes at arbitrary chunk boundaries", async () => {
    const input = bytes("From a\r\nSubject: hi\r\n\r\n>>From x\r\n>From y\r\nend");
    const result = (await collect(splitMbox(chunks(input, 1)))) as Uint8Array[];
    expect(new TextDecoder().decode(result[0])).toBe("Subject: hi\r\n\r\n>From x\r\nFrom y\r\nend");
    const binary = new Uint8Array([...bytes("From a\n\n"), 255]);
    expect([...((await collect(splitMbox(chunks(binary)))) as Uint8Array[])[0]!]).toEqual([
      10, 255,
    ]);
    expect(await collect(splitMbox(chunks(new Uint8Array())))).toEqual([]);
    expect(await collect(splitMbox(chunks(bytes("From a\nFrom b\n"))))).toEqual([]);
  });
  it("rejects missing separators and oversized messages, including unterminated lines", async () => {
    await expect(collect(splitMbox(chunks(bytes("bad\n"))))).rejects.toThrow("separator");
    await expect(collect(splitMbox(chunks(bytes("bad"))))).rejects.toThrow("separator");
    await expect(collect(splitMbox(chunks(bytes("From a\nlong\n")), 3))).rejects.toThrow("limit");
    await expect(collect(splitMbox(chunks(bytes("From a\nlong")), 3))).rejects.toThrow("limit");
    await expect(collect(splitMbox(chunks(bytes("")), 0))).rejects.toThrow("limit");
  });
  it("bounds allocations for messages containing hundreds of thousands of short lines", async () => {
    const content = "\n".repeat(256 * 1024);
    const input = bytes(`From sender\n${content}`);
    const allocations: number[] = [];
    const OriginalBytes = Uint8Array;
    const originalSlice = Uint8Array.prototype.slice;
    const slice = vi.spyOn(Uint8Array.prototype, "slice").mockImplementation(function (
      this: Uint8Array,
      start,
      end,
    ) {
      const result = originalSlice.call(this, start, end);
      allocations.push(result.byteLength);
      return result;
    });
    vi.stubGlobal(
      "Uint8Array",
      new Proxy(OriginalBytes, {
        construct(target, args) {
          const result = Reflect.construct(target, args) as Uint8Array;
          allocations.push(result.byteLength);
          return result;
        },
      }),
    );
    let result: unknown[];
    try {
      result = await collect(splitMbox(chunks(input, input.length), content.length));
    } finally {
      vi.unstubAllGlobals();
      slice.mockRestore();
    }
    expect(result).toEqual([bytes(content)]);
    expect(allocations.length).toBeLessThan(32);
    expect(allocations.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(
      2 * content.length,
    );
  });
  it("enforces the decoded message limit independently of separator chunk boundaries", async () => {
    const input = bytes(
      "From sender\nabc\nFrom another sender with a long envelope\nxyz\nFrom last",
    );
    for (let size = 1; size <= input.length; size++) {
      const result = await collect(splitMbox(chunks(input, size), 4));
      expect(result).toEqual([bytes("abc\n"), bytes("xyz\n")]);
    }
    // An incomplete separator candidate must still count if it becomes content or ends at EOF.
    for (const tail of ["F", "Fr", "Fro", "From", "FromX", "Fx\n"]) {
      await expect(
        collect(splitMbox(chunks(bytes(`From sender\nabc\n${tail}`), 1), 4)),
      ).rejects.toThrow("limit");
    }
    await expect(collect(splitMbox(chunks(bytes("From"), 1)))).rejects.toThrow("separator");
    await expect(collect(splitMbox(chunks(bytes(">From sender\n"), 1)))).rejects.toThrow(
      "separator",
    );
  });
  it("unquotes complete leading quote runs on terminated and unterminated lines", async () => {
    for (const ending of ["\r\n", ""]) {
      const quoted = ">".repeat(1024);
      const content = `Subject: Quotes\n\n${quoted}From body${ending}`;
      const expected = bytes(`Subject: Quotes\n\n${quoted.slice(1)}From body${ending}`);
      const input = bytes(`From sender\n${content}`);
      for (const size of [1, 127, input.length]) {
        const result = await collect(splitMbox(chunks(input, size), expected.length));
        expect(result).toEqual([expected]);
        const item = await parseEmail(result[0] as Uint8Array, storage, "personal", "quoted");
        expect(item.raw).toEqual(expected);
        expect(item.mailbox.message(item.message).body?.trim()).toBe(`${quoted.slice(1)}From body`);
      }
    }
    for (const content of [">".repeat(20), `${">".repeat(20)}Fro`, `${">".repeat(20)}FromX\n`]) {
      expect(await collect(splitMbox(chunks(bytes(`From sender\n${content}`), 1)))).toEqual([
        bytes(content),
      ]);
    }
    for (const content of [">".repeat(6), ">".repeat(7), ">From x", ">>From "]) {
      await expect(
        collect(splitMbox(chunks(bytes(`From sender\n${content}`), 1), 5)),
      ).rejects.toThrow("limit");
    }
  });
  it("handles absent fields, grouped addresses, status flags, MIME filenames and fallback identifiers", async () => {
    const empty = await parseEmail(bytes("Subject: Blank\n\n"), storage, "personal", "fallback");
    expect(empty.id).toBe("fallback");
    expect(empty.folders[0]!.title).toBe("Inbox");
    expect(empty.mailbox.message(empty.message).sender).toBeUndefined();
    const item = await parseEmail(
      bytes(
        "From: A <a@example.org>\nTo: Team: A <a@example.org>, B <b@example.org>;\nCc: C <c@example.org>\nBcc: D <d@example.org>\nIn-Reply-To: <root>\nStatus: R\n\nHi",
      ),
      storage,
      "personal",
      "id",
    );
    const m = item.mailbox.message(item.message);
    expect(m.to.size).toBe(2);
    expect(m.cc.size).toBe(1);
    expect(m.bcc.size).toBe(1);
    expect(m.isRead).toBe(true);
    expect(item.thread).toBe(`${mailDocument(root, "threads", "<root>")}#it`);
    const unread = await parseEmail(
      bytes("X-Gmail-Labels: Unread, Archive\n\nHi"),
      storage,
      "personal",
      "id",
    );
    expect(unread.mailbox.message(unread.message).isRead).toBe(false);
    const attachment = await parseEmail(
      bytes("Content-Type: application/octet-stream\nContent-Disposition: attachment\n\nabc"),
      storage,
      "personal",
      "id",
    );
    expect(attachment.attachments[0]!.name).toBe("attachment");
  });
});

it("validates paths and keeps source-controlled identifiers inside their namespaces", () => {
  expect(mailRoot("https://pod.example/alice", "a/b")).toBe(
    "https://pod.example/alice/mail/a~2Fb/",
  );
  for (const storage of [
    "file:///tmp/",
    "https://u:p@pod.example/",
    "https://pod.example/?q",
    "https://pod.example/#x",
  ])
    expect(() => mailRoot(storage, "a")).toThrow();
  for (const account of ["", " ", ".", ".."]) expect(() => mailRoot(storage, account)).toThrow();
  expect(() => mailDocument(root, "messages", " ")).toThrow();
  expect(mailDocument(root, "threads", "../#?")).toContain("threads/..~2F~23~3F.ttl");
  expect(attachmentUrl("https://pod.example", "personal", "a", 0)).toBe(
    "https://pod.example/mail/attachments/personal/a-0",
  );
  const ids = ["a/b", "a%2Fb", "a~2Fb", "a\\b", "a%5Cb", "a~5Cb", "../#?", "café", "😀"];
  const accounts = ids.map((id) => mailRoot(storage, id));
  const documents = ids.map((id) => mailDocument(root, "messages", id));
  const attachments = ids.map((id) => attachmentUrl(storage, "personal", id, 0));
  for (const urls of [accounts, documents, attachments]) {
    expect(new Set(urls).size).toBe(ids.length);
    for (const url of urls) expect(assertWithinPodScope(storage, url)).toBe(url);
  }
  expect(attachmentUrl(storage, "personal", "a", 0)).not.toBe(
    attachmentUrl(storage, "personal", "a", 1),
  );
});

it("preserves decoded HTML and round-trips a readable text fallback", async () => {
  const html =
    "<html><head><style>hidden</style></head><body><p>Hello &amp; café</p><p>Next<br>line &#x1F600;</p><script>alert(1)</script></body></html>";
  const item = await parseEmail(
    bytes(
      `Content-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(html).toString("base64")}`,
    ),
    storage,
    "personal",
    "html-only",
  );
  const m = item.mailbox.message(item.message);
  expect(m.bodyHtml).toBe(html);
  expect(m.body).toBe("Hello & café\n\nNext\nline 😀");
  const restored = await parseMailbox(
    serialiseToTurtle(item.mailbox),
    item.message.replace(/#.*$/, ""),
  );
  expect(restored.message(item.message).bodyHtml).toBe(html);
  expect(restored.message(item.message).body).toBe(m.body);
  m.bodyHtml = undefined;
  expect(m.bodyHtml).toBeUndefined();
  const alternative = await parseEmail(
    bytes(
      "Content-Type: multipart/alternative; boundary=x\n\n--x\nContent-Type: text/plain\n\nOriginal text\n--x\nContent-Type: text/html\n\n<p>HTML alternative</p>\n--x--\n",
    ),
    storage,
    "personal",
    "alternative",
  );
  const both = alternative.mailbox.message(alternative.message);
  expect(both.body).toContain("Original text");
  expect(both.body).not.toContain("HTML alternative");
  expect(both.bodyHtml).toContain("<p>HTML alternative</p>");
});

it("reduces HTML to inert text with common entities, boundaries and invalid-codepoint handling", () => {
  expect(htmlToText("")).toBe("");
  expect(
    htmlToText(
      "<!--comment--><div> A\t <b>B</b> </div><br><p>&lt;x&gt; &quot;q&quot; &apos;y&apos;&nbsp;&#39; &#65; &#X42; &unknown;</p>",
    ),
  ).toBe(`A B\n\n<x> "q" 'y' ' A B &unknown;`);
  expect(htmlToText("&#0; &#55296; &#56319; &#1114112;")).toBe("� � � �");
});
it("counts both membership directions, keeps stable ordering and validates mutations and pages", () => {
  const mb = new MailboxDataset(new Store(), DataFactory);
  const inbox = mb.createFolder(`${root}inbox`),
    archive = mb.createFolder(`${root}archive`);
  inbox.addMessage(`${root}missing`);
  const a = mb.createMessage(`${root}a`),
    b = mb.createMessage(`${root}b`);
  a.folderIris.add(inbox.value);
  b.folderIris.add(inbox.value);
  expect(folderCounts(mb)[0]!.total).toBe(3);
  expect(folderCounts(mb)[0]!.unread).toBe(2);
  const t = mb.createThread(`${root}t`);
  t.addMessage(a.value);
  b.partOfThread = t.value;
  expect(threadMessages(mb, t.value).map((m) => m.value)).toEqual([a.value, b.value]);
  expect(threadMessages(mb, "absent")).toEqual([]);
  expect(pageThreads(mb, inbox.value).total).toBe(1);
  expect(pageThreads(mb, "absent").items).toEqual([]);
  for (const [offset, limit] of [
    [-1, 5],
    [0, 0],
    [0, 1.5],
    [NaN, 3],
  ])
    expect(() => pageThreads(mb, inbox.value, offset, limit)).toThrow();
  setMembership(mb, a.value, inbox.value, true);
  setMembership(mb, a.value, inbox.value, true);
  expect(inbox.has(a.value)).toBe(true);
  archiveMessage(mb, a.value, inbox.value, archive.value);
  expect(inbox.has(a.value)).toBe(false);
  expect(archive.has(a.value)).toBe(true);
  expect(a.folderIris.has(archive.value)).toBe(true);
  expect(() => setMembership(mb, "absent", inbox.value, true)).toThrow();
  expect(() => setMembership(mb, a.value, "absent", true)).toThrow();
  expect(() => archiveMessage(mb, a.value, "absent", archive.value)).toThrow();
  expect(() => archiveMessage(mb, a.value, inbox.value, "absent")).toThrow();
});

it("validates MIME dates and preserves Takeout flags and case-sensitive labels", async () => {
  await expect(
    parseEmail(bytes("Date: not-a-date\n\ntext"), storage, "personal", "id"),
  ).rejects.toThrow("date");
  await expect(parseEmail(bytes("\n"), storage, "personal", "")).rejects.toThrow("identifier");
  const item = await parseEmail(
    bytes("X-Gmail-Labels: Opened, Archived, Work, work, =?UTF-8?Q?caf=C3=A9?=\n\nHello"),
    storage,
    "personal",
    "id",
  );
  expect(item.mailbox.message(item.message).isRead).toBe(true);
  expect(item.folders.map((f) => f.title)).toEqual(["Work", "work", "café", "Archive"]);
  expect(new Set(item.folders.map((f) => f.iri)).size).toBe(4);
  const empty = await parseEmail(bytes("X-Gmail-Labels: \n\nHello"), storage, "personal", "id");
  expect(empty.folders).toEqual([]);
  const noAddress = await parseEmail(bytes("To: A Name\n\nHello"), storage, "personal", "id");
  expect(noAddress.mailbox.message(noAddress.message).to.size).toBe(0);
  const quoted = (await collect(splitMbox(chunks(bytes("From a\n>From ending"))))) as Uint8Array[];
  expect(new TextDecoder().decode(quoted[0])).toBe("From ending");
});
it("threads In-Reply-To-only chains through previously imported mail", async () => {
  const mbox = bytes(
    "From a\nMessage-ID: <a>\n\nA\nFrom b\nMessage-ID: <b>\nIn-Reply-To: <a>\n\nB\nFrom c\nMessage-ID: <c>\nIn-Reply-To: <b>\n\nC",
  );
  const items = (await collect(
    importMbox(chunks(mbox), storage, "personal", () => "id"),
  )) as Awaited<ReturnType<typeof parseEmail>>[];
  expect(new Set(items.map((i) => i.thread)).size).toBe(1);
});
it("sorts equal-dated threads stably and resolves message-side membership alone", () => {
  const mailbox = new MailboxDataset(new Store(), DataFactory);
  for (const id of ["b", "a"]) {
    const t = mailbox.createThread(root + id),
      m = mailbox.createMessage(`${root}message-${id}`);
    m.partOfThread = t.value;
    m.folderIris.add(`${root}folder`);
    m.dateSent = new Date("2026-10-24T00:00:00Z");
  }
  expect(pageThreads(mailbox, `${root}folder`).items.map((x) => x.thread.value)).toEqual([
    `${root}a`,
    `${root}b`,
  ]);
  expect(folderCounts(mailbox)).toEqual([]);
});
