// AUTHORED-BY Codex GPT-6.1-Sol
import {
  HTML_TEXT_TRUNCATION_NOTICE,
  MAX_HTML_CHARS,
  MAX_HTML_INPUT_CHARS,
} from "@jeswr/pod-connectors/mail";
import { describe, expect, it } from "vitest";
import { importMbox, parseEmail } from "../../src/apps/mail/lib/model/importer.js";

const storage = "https://pod.example/alice/";
const bytes = (text: string) => new TextEncoder().encode(text);
const rawHtml = (html: string) =>
  bytes(
    `Content-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from(html).toString("base64")}`,
  );

describe("shared HTML fallback through the Suite importer", () => {
  it.each([
    "script",
    "style",
    "head",
  ])("preserves Unicode inside and around skipped %s", async (tag) => {
    const unicode = "İẞe\u0301😀";
    const html = `<p>İstanbul ${unicode}</p><${tag.toUpperCase()}>${unicode.repeat(256)}</${tag.toUpperCase()}><p>Next ${unicode}</p>`;
    const raw = rawHtml(html);
    const item = await parseEmail(raw, storage, "personal", "unicode");
    expect(item.mailbox.message(item.message).body).toBe(`İstanbul ${unicode}\n\nNext ${unicode}`);
    expect(item.mailbox.message(item.message).bodyHtml).toBe(html);
    expect(item.bodyTruncated).toBeUndefined();
    expect(item.raw).toBe(raw);
    async function* source() {
      yield bytes("From sender@example.test Thu Jan 1 00:00:00 2026\n");
      yield raw;
    }
    for await (const imported of importMbox(source(), storage, "personal", () => "unicode")) {
      expect(imported.mailbox.message(imported.message).body).toBe(
        `İstanbul ${unicode}\n\nNext ${unicode}`,
      );
      expect(imported.bodyTruncated).toBeUndefined();
    }
  });

  it.each([
    ["<!--", "-->"],
    ["<STYLE>", "</STYLE>"],
  ])("reads visible text after a long leading %s", async (open, close) => {
    const html = `${open}${"x".repeat(MAX_HTML_CHARS + 1)}${close}<p>Readable</p>`;
    const item = await parseEmail(rawHtml(html), storage, "personal", "leading");
    expect(item.mailbox.message(item.message).body).toBe("Readable");
    expect(item.bodyTruncated).toBeUndefined();
  });

  it.each([
    "visible",
    "input",
    "empty",
  ])("reports the %s bound and retains HTML and source", async (bound) => {
    const html =
      bound === "visible"
        ? `<p>${"a".repeat(MAX_HTML_CHARS + 1)}</p>`
        : `${bound === "input" ? "<p>Before</p>" : ""}<!--${"x".repeat(MAX_HTML_INPUT_CHARS)}--><p>Beyond</p>`;
    const raw = rawHtml(html);
    const item = await parseEmail(raw, storage, "personal", bound);
    const text =
      bound === "visible" ? "a".repeat(MAX_HTML_CHARS) : bound === "input" ? "Before" : "";
    const message = item.mailbox.message(item.message);
    expect(message.body).toBe(
      text ? `${text}\n\n${HTML_TEXT_TRUNCATION_NOTICE}` : HTML_TEXT_TRUNCATION_NOTICE,
    );
    expect(message.bodyHtml).toBe(html);
    expect(item.raw).toBe(raw);
    expect(item.bodyTruncated).toBe(true);
    async function* source() {
      yield bytes("From sender@example.test Thu Jan 1 00:00:00 2026\n");
      yield raw;
    }
    const imported = [];
    for await (const result of importMbox(source(), storage, "personal", () => bound))
      imported.push(result);
    expect(imported).toHaveLength(1);
    expect(imported[0]?.bodyTruncated).toBe(true);
    expect(imported[0]?.mailbox.message(imported[0].message).body).toBe(message.body);
  });

  it("keeps a plain MIME alternative without a truncation notice", async () => {
    const item = await parseEmail(
      bytes(
        `Content-Type: multipart/alternative; boundary=x\n\n--x\nContent-Type: text/plain\n\nOriginal text\n--x\nContent-Type: text/html\n\n<p>${"a".repeat(MAX_HTML_CHARS + 1)}</p>\n--x--\n`,
      ),
      storage,
      "personal",
      "plain",
    );
    expect(item.mailbox.message(item.message).body).toBe("Original text");
    expect(item.bodyTruncated).toBeUndefined();
  });
});
