// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { MAX_BODY_CHARS } from "../core/export-fields.js";
import { MAX_JSON_RECORD_BYTES } from "../core/file-json.js";
import { sha256Hex32 } from "../core/slug.js";
import { fileImport, memoryFile, streamedBytesFile, TEST_POD_ROOT } from "../core/testing.js";
import { CLASSES, Message } from "../core/vocab.js";
import {
  attachmentName,
  flattenText,
  parseTelegramMessage,
  telegramFileAdapter,
} from "./file-adapter.js";

const ROOT = `${TEST_POD_ROOT}integrations/telegram/`;
/** One document per chat, named by a fixed-length hash of the chat id. */
async function chatDoc(id: string): Promise<string> {
  return `${ROOT}social/telegram/${await sha256Hex32(id)}.ttl`;
}
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// Synthetic single-chat export (Telegram Desktop machine-readable JSON layout).
const SINGLE = {
  name: "Synthetic Group",
  type: "private_supergroup",
  id: 1001,
  messages: [
    {
      id: 1,
      type: "service",
      date: "2024-01-01T09:00:00",
      date_unixtime: "1704099600",
      actor: "Synthetic Owner",
      action: "create_group",
      text: "",
    },
    {
      id: 2,
      type: "message",
      date: "2024-01-01T10:00:00",
      date_unixtime: "1704103200",
      from: "Synthetic Alice",
      from_id: "user1",
      text: "Hello 🌍",
    },
    {
      id: 3,
      type: "message",
      date: "2024-01-01T10:05:00",
      date_unixtime: "1704103500",
      edited: "2024-01-01T10:06:00",
      edited_unixtime: "1704103560",
      from: "Synthetic Bob",
      reply_to_message_id: 2,
      text: [
        "Reply with ",
        { type: "bold", text: "bold" },
        " and ",
        { type: "link", text: "https://example.org" },
      ],
      photo: "photos/photo_1@01-01-2024_10-05-00.jpg",
      thumbnail: "(File not included. Change data exporting settings to download.)",
    },
    {
      id: 4,
      type: "message",
      date: "2024-01-01T11:00:00",
      from: "Synthetic Alice",
      forwarded_from: "Synthetic Channel",
      reply_to_message_id: 999,
      text: "Forwarded",
      file: "files/report.pdf",
    },
  ],
};

function messages(ds: DatasetCore): Message[] {
  return [...ds]
    .filter((q) => q.predicate.value === RDF_TYPE && q.object.value === CLASSES.Message)
    .map((q) => new Message(q.subject.value, ds, DataFactory))
    .sort((a, b) => (a.dateCreated?.getTime() ?? 0) - (b.dateCreated?.getTime() ?? 0));
}

describe("telegram file adapter", () => {
  it("maps a single-chat export onto the WhatsApp message model", async () => {
    const { pod, report } = await fileImport(
      telegramFileAdapter,
      streamedBytesFile("result.json", JSON.stringify(SINGLE, null, 1)),
    );
    const Doc = await chatDoc("1001");
    expect(report.categories).toEqual(["social"]);
    expect(report.written.map((w) => w.url)).toEqual([Doc]);
    expect(report.skipped).toBeUndefined();
    const [hello, reply, forwarded] = messages(pod.dataset(Doc));
    expect(messages(pod.dataset(Doc))).toHaveLength(3);
    expect(hello?.text).toBe("Hello 🌍");
    expect(hello?.sender).toBe("Synthetic Alice");
    expect(hello?.dateCreated?.toISOString()).toBe("2024-01-01T10:00:00.000Z");
    expect(hello?.conversation).toBe("Synthetic Group");
    expect(reply?.text).toBe("Reply with bold and https://example.org");
    expect(reply?.dateModified?.toISOString()).toBe("2024-01-01T10:06:00.000Z");
    expect(reply?.inReplyTo).toBe(hello?.value);
    expect([...(reply?.attachmentNames ?? [])]).toEqual(["photo_1@01-01-2024_10-05-00.jpg"]);
    // No date_unixtime: the zone-less date is read as UTC.
    expect(forwarded?.dateCreated?.toISOString()).toBe("2024-01-01T11:00:00.000Z");
    expect(forwarded?.forwardedFrom).toBe("Synthetic Channel");
    expect(forwarded?.sender).toBe("Synthetic Alice");
    // The replied-to message is not in the export: no dangling link.
    expect(forwarded?.inReplyTo).toBeUndefined();
    expect([...(forwarded?.attachmentNames ?? [])]).toEqual(["report.pdf"]);
    expect(pod.get(report.indexUrl)).toContain(CLASSES.Message);
    // The chat key is in each fragment's readable part.
    const key = (await chatDoc("1001")).split("/").pop()?.replace(".ttl", "");
    expect(hello?.value).toBe(`${Doc}#msg-${key}-2`);
  });

  it("keeps chats of a full account export apart", async () => {
    const full = {
      about: "Synthetic export",
      personal_information: { first_name: "Synthetic", phone_number: "+00 000" },
      contacts: { list: [{ first_name: "Ignored" }] },
      chats: {
        about: "chats",
        list: [
          {
            name: "First Chat",
            id: 1,
            messages: [
              { id: 1, type: "message", date_unixtime: "1704103200", from: "A", text: "one" },
            ],
          },
          {
            name: "Second Chat",
            id: 2,
            messages: [
              { id: 1, type: "message", date_unixtime: "1704103300", from: "B", text: "two" },
              {
                id: 2,
                type: "message",
                date_unixtime: "1704103400",
                from: "B",
                text: "reply",
                reply_to_message_id: 1,
              },
            ],
          },
        ],
      },
      left_chats: {
        list: [
          {
            name: "Left Chat",
            id: 3,
            messages: [
              { id: 1, type: "message", date_unixtime: "1704103500", from: "C", text: "bye" },
            ],
          },
        ],
      },
    };
    const { pod, report } = await fileImport(
      telegramFileAdapter,
      streamedBytesFile("result.json", JSON.stringify(full), 13),
    );
    const docs = [await chatDoc("1"), await chatDoc("2"), await chatDoc("3")];
    expect(report.written.map((w) => w.url).sort()).toEqual([...docs].sort());
    const all = docs.flatMap((doc) => messages(pod.dataset(doc)));
    expect(all.map((m) => [m.conversation, m.text])).toEqual([
      ["First Chat", "one"],
      ["Second Chat", "two"],
      ["Second Chat", "reply"],
      ["Left Chat", "bye"],
    ]);
    expect(new Set(all.map((m) => m.value)).size).toBe(4);
    expect(all[2]?.inReplyTo).toBe(all[1]?.value);
    for (const doc of docs)
      expect([...pod.dataset(doc)].some((q) => q.object.value === "Ignored")).toBe(false);
    // One Type Index registration covers the per-chat container.
    expect(pod.get(report.indexUrl)).toContain(`${ROOT}social/telegram/`);
  });

  it("dedups repeated messages and re-imports idempotently", async () => {
    const dup = { ...SINGLE, messages: [...SINGLE.messages, SINGLE.messages[1]] };
    const file = streamedBytesFile("result.json", JSON.stringify(dup));
    const { pod, report } = await fileImport(telegramFileAdapter, file);
    const Doc = await chatDoc("1001");
    expect(messages(pod.dataset(Doc))).toHaveLength(3);
    expect(report.state?.counts.items).toBe(3);
    const before = [...pod.dataset(Doc)].length;
    const again = await fileImport(telegramFileAdapter, file, { pod });
    expect([...pod.dataset(Doc)].length).toBe(before);
    expect(again.report.state?.counts).toEqual(report.state?.counts);
  });

  it("skips and counts malformed and oversized messages", async () => {
    const hostile = `{"name":"Hostile","id":7,"messages":[
      "not an object",
      {"type":"message","text":"no id"},
      {"id":-1,"type":"message","text":"negative"},
      {"id":1.5,"type":"message","text":"fraction"},
      {"id":2,"text":"no type"},
      {"id":3,"type":"message","text":"${"x".repeat(MAX_JSON_RECORD_BYTES)}"},
      {"id":4,"type":"message","date_unixtime":"7258118400","date":"2024-02-30T10:00:00","edited_unixtime":"1e9","text":"kept"}
    ]}`;
    const { pod, report } = await fileImport(
      telegramFileAdapter,
      streamedBytesFile("result.json", hostile, 65536),
    );
    const Doc = await chatDoc("7");
    expect(report.skipped).toBe(6);
    expect(report.state?.counts.skipped).toBe(6);
    const [kept] = messages(pod.dataset(Doc));
    expect(messages(pod.dataset(Doc))).toHaveLength(1);
    expect(kept?.text).toBe("kept");
    expect(kept?.dateCreated).toBeUndefined();
    expect(kept?.dateModified).toBeUndefined();
  });

  it("never resolves prototype keys or records hostile attachment paths", async () => {
    const json = `{"name":"Proto","id":"chat_1","messages":[
      {"id":1,"type":"message","__proto__":{"text":"polluted","from":"Mallory"},"constructor":{"prototype":{"x":1}},
       "photo":"../../etc/passwd","file":"/etc/shadow","thumbnail":"C:\\\\Windows\\\\win.ini"},
      {"id":2,"type":"message","text":"ok","photo":"photos/../../secret.jpg","file":"file:///etc/passwd","thumbnail":"data:image/png;base64,AAAA"},
      {"id":3,"type":"message","text":"ok","photo":"photos\\\\nested\\\\pic.jpg"}
    ]}`;
    const { pod } = await fileImport(telegramFileAdapter, streamedBytesFile("result.json", json));
    const Doc = await chatDoc("chat_1");
    const [first, second, third] = [...messages(pod.dataset(Doc))].sort((a, b) =>
      a.value.localeCompare(b.value),
    );
    expect(first?.text).toBeUndefined();
    expect(first?.sender).toBeUndefined();
    expect([...(first?.attachmentNames ?? [])]).toEqual([]);
    expect([...(second?.attachmentNames ?? [])]).toEqual([]);
    expect([...(third?.attachmentNames ?? [])]).toEqual(["pic.jpg"]);
    expect(({} as Record<string, unknown>).text).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("replaces only the re-exported chat when a single chat follows an account export", async () => {
    const account = JSON.stringify({
      chats: {
        list: [
          {
            name: "Alice",
            id: 1,
            messages: [
              { id: 1, type: "message", text: "a" },
              { id: 2, type: "message", text: "b" },
            ],
          },
          { name: "Bob", id: 2, messages: [{ id: 3, type: "message", text: "c" }] },
        ],
      },
    });
    const { pod } = await fileImport(
      telegramFileAdapter,
      streamedBytesFile("result.json", account),
    );
    const bob = JSON.stringify({
      name: "Bob",
      id: 2,
      messages: [
        { id: 3, type: "message", text: "c" },
        { id: 4, type: "message", text: "d" },
      ],
    });
    const { report } = await fileImport(
      telegramFileAdapter,
      streamedBytesFile("result.json", bob),
      { pod },
    );
    expect(report.written.map((w) => w.url)).toEqual([await chatDoc("2")]);
    expect(messages(pod.dataset(await chatDoc("1"))).map((m) => m.text)).toEqual(["a", "b"]);
    expect(messages(pod.dataset(await chatDoc("2"))).map((m) => m.text)).toEqual(["c", "d"]);
  });

  it("links replies only within the same chat", async () => {
    const json = JSON.stringify({
      chats: {
        list: [
          {
            name: "Group",
            type: "private_supergroup",
            id: 1001,
            messages: [
              { id: 5, type: "message", date_unixtime: "1700000000", text: "local 5" },
              {
                id: 9,
                type: "message",
                date_unixtime: "1700000100",
                text: "reply to another chat's 5",
                reply_to_peer_id: "channel2",
                reply_to_message_id: 5,
              },
              {
                id: 10,
                type: "message",
                date_unixtime: "1700000200",
                text: "reply naming this chat",
                reply_to_peer_id: "channel1001",
                reply_to_message_id: 5,
              },
              {
                id: 11,
                type: "message",
                date_unixtime: "1700000300",
                text: "unreadable peer",
                reply_to_peer_id: { id: 1001 },
                reply_to_message_id: 5,
              },
            ],
          },
        ],
      },
    });
    const { pod } = await fileImport(telegramFileAdapter, streamedBytesFile("result.json", json));
    const [local, cross, same, odd] = messages(pod.dataset(await chatDoc("1001")));
    expect(cross?.text).toBe("reply to another chat's 5");
    expect(cross?.inReplyTo).toBeUndefined();
    expect(same?.inReplyTo).toBe(local?.value);
    expect(odd?.inReplyTo).toBeUndefined();
  });

  it("skips and counts an account chat without an id, keeping messages in their own chat", async () => {
    const json = JSON.stringify({
      chats: {
        list: [
          { name: "Alice", id: 1, messages: [{ id: 5, type: "message", text: "to alice" }] },
          {
            type: "personal_chat",
            messages: [
              { id: 5, type: "message", text: "to bob" },
              { id: 6, type: "message", text: "bob 6" },
            ],
          },
          // Messages before the chat's name and id still belong to this chat.
          { messages: [{ id: 5, type: "message", text: "to carol" }], name: "Carol", id: 3 },
        ],
      },
    });
    const { pod, report } = await fileImport(
      telegramFileAdapter,
      streamedBytesFile("result.json", json, 3),
    );
    expect(report.skipped).toBe(1);
    expect(report.written.map((w) => w.url).sort()).toEqual(
      [await chatDoc("1"), await chatDoc("3")].sort(),
    );
    expect(messages(pod.dataset(await chatDoc("1"))).map((m) => m.text)).toEqual(["to alice"]);
    const [carol] = messages(pod.dataset(await chatDoc("3")));
    expect([carol?.text, carol?.conversation]).toEqual(["to carol", "Carol"]);
  });

  it("caps message text and refuses invalid JSON", async () => {
    const long = {
      name: "Long",
      id: 9,
      messages: [{ id: 1, type: "message", text: "y".repeat(MAX_BODY_CHARS + 9) }],
    };
    const { pod } = await fileImport(
      telegramFileAdapter,
      memoryFile("result.json", JSON.stringify(long)),
    );
    expect(messages(pod.dataset(await chatDoc("9")))[0]?.text?.length).toBe(MAX_BODY_CHARS);
    await expect(
      fileImport(telegramFileAdapter, memoryFile("result.json", '{"messages":[{"id":1,')),
    ).rejects.toThrow();
    await expect(
      fileImport(
        telegramFileAdapter,
        memoryFile("result.json", '{"messages":[{"id":1,"type":"service"}]}'),
      ),
    ).rejects.toThrow("No importable records");
  });
});

describe("telegram helpers", () => {
  it("flattens entity arrays and ignores non-text parts", () => {
    expect(flattenText(["a", { type: "bold", text: "b" }, { type: "x" }, 5, null, "c"])).toBe(
      "abc",
    );
    expect(flattenText({ text: "object" })).toBeUndefined();
    expect(flattenText(undefined)).toBeUndefined();
  });

  it("keeps only safe relative attachment names", () => {
    expect(attachmentName("video_files/clip.mp4")).toBe("clip.mp4");
    for (const value of [
      "../x.jpg",
      "a/./b.jpg",
      "/abs.jpg",
      "\\\\server\\share.jpg",
      "D:\\pic.jpg",
      "https://example.org/x.jpg",
      "photos/a\u0000.jpg",
      "photos/",
      "(File not included.)",
      42,
      `${"n".repeat(600)}.jpg`,
    ])
      expect(attachmentName(value), String(value)).toBeUndefined();
  });

  it("classifies service, malformed and ordinary messages", () => {
    expect(parseTelegramMessage({ id: 1, type: "service" })).toBe("service");
    expect(parseTelegramMessage([])).toBeUndefined();
    expect(parseTelegramMessage({ id: 1, type: "message" })).toMatchObject({
      id: 1,
      attachments: [],
    });
  });
});
