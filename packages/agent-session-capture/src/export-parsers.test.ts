// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { readFile } from "fs/promises";
import { describe, expect, it } from "vitest";
import { parseChatgptExport, parseClaudeExport } from "./export-parsers.js";
import { MAX_BYTES } from "./io.js";
import { digest } from "./parsers.js";

const fixture = (provider: string) =>
  readFile(new URL(`./fixtures/${provider}-export.json`, import.meta.url), "utf8");
const chat = (message: unknown, extra: object = {}) =>
  JSON.stringify([{ id: "chat", mapping: { node: { message } }, ...extra }]);
const message = (extra: object = {}) => ({
  author: { role: "user" },
  content: { parts: ["Hello"] },
  ...extra,
});
const claude = (extra: object = {}) =>
  JSON.stringify([{ uuid: "chat", chat_messages: [{ sender: "human", text: "Hello" }], ...extra }]);

describe("bounded export parsers", () => {
  it.each(["chatgpt", "claude"])("uses shared chunk-aware PEM continuation for %s", (provider) => {
    const body = `${"fixtureKeyMaterial".repeat(4)}\n`.repeat(26);
    const parts = ["intro\n-----BEGIN PGP PRIVATE ", "KEY BLOCK-----\n", body];
    const footer = "more body\n-----END PGP PRIVATE KEY BLOCK-----\nAfter";
    const parsed =
      provider === "chatgpt"
        ? parseChatgptExport(
            chat(message(), {
              title: "My title",
              mapping: {
                first: { message: message({ id: "one", create_time: 1, content: { parts } }) },
                last: {
                  message: message({ id: "two", create_time: 2, content: { parts: [footer] } }),
                },
              },
            }),
          )
        : parseClaudeExport(
            claude({
              name: "My title",
              chat_messages: [
                {
                  uuid: "one",
                  sender: "human",
                  content: parts.map((text) => ({ type: "text", text })),
                },
                { uuid: "two", sender: "assistant", text: footer },
              ],
            }),
          );
    expect(parsed[0]?.title).toBe("My title");
    expect(parsed[0]?.messages).toHaveLength(2);
    expect(parsed[0]?.messages[0]?.text).toBe("intro\n[REDACTED]\n[REDACTED]\n[REDACTED]");
    expect(parsed[0]?.messages[1]?.text).toBe("[REDACTED PRIVATE KEY]\nAfter");
  });

  it.each([
    "chatgpt",
    "claude",
  ])("redacts %s title, message and content-part boundaries", (provider) => {
    const parts = ["000000000000 Safe ghp", "_fixtureToken123 Safe ghp_fixture"];
    const parsed =
      provider === "chatgpt"
        ? parseChatgptExport(
            chat(message(), {
              title: "AKIA0000",
              mapping: {
                a: { message: message({ id: "a", content: { parts } }) },
                b: { message: message({ id: "b", content: { parts: ["Token123"] } }) },
              },
            }),
          )
        : parseClaudeExport(
            claude({
              name: "AKIA0000",
              chat_messages: [
                {
                  uuid: "a",
                  sender: "human",
                  content: parts.map((text) => ({ type: "text", text })),
                },
                { uuid: "b", sender: "assistant", text: "Token123" },
              ],
            }),
          );
    expect(parsed[0]?.title).toBe("[REDACTED]");
    expect(parsed[0]?.messages.map((message) => message.text)).toEqual([
      "[REDACTED] Safe [REDACTED]\n[REDACTED] Safe [REDACTED TOKEN]",
      "[REDACTED]",
    ]);
  });
  it("ports all ChatGPT mapping branches in timestamp order, with opaque IDs and text only", async () => {
    const text = await fixture("chatgpt");
    const parsed = parseChatgptExport(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "A fixture question.\nMore text.", "2026-10-25T12:00:00.000Z"],
      ["assistant", "A fixture answer.", "2026-10-25T12:00:01.000Z"],
    ]);
    expect(parsed[0]?.conversationId).toBe(
      digest(["chatgpt-export", "chatgpt-fixture-conversation"]),
    );
    expect(parsed[0]?.messages.every((m) => /^[a-f0-9]{64}$/.test(m.id as string))).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("DROP_");
    expect(parseChatgptExport(JSON.stringify({ conversations: JSON.parse(text) }))).toEqual(parsed);
  });
  it.each([
    "python",
    "browser",
    "functions.search",
  ])("drops ChatGPT assistant text directed to %s", (recipient) => {
    for (const contentType of ["text", "multimodal_text"])
      expect(
        parseChatgptExport(
          chat(
            message({
              author: { role: "assistant" },
              recipient,
              content: { content_type: contentType, parts: ["DROP_TOOL_ARGUMENTS"] },
            }),
          ),
        ),
      ).toEqual([]);
  });
  it.each([undefined, "all"])("retains ChatGPT turns with recipient %s", (recipient) => {
    for (const role of ["user", "assistant"])
      expect(
        parseChatgptExport(chat(message({ author: { role }, recipient })))[0]?.messages.map(
          (turn) => [turn.role, turn.text],
        ),
      ).toEqual([[role, "Hello"]]);
  });
  it("filters tool-directed ChatGPT messages before extracting their content", () => {
    expect(
      parseChatgptExport(
        chat(
          message({
            author: { role: "assistant" },
            recipient: "python",
            content: { content_type: "text", parts: Array(10001).fill("DROP_TOOL_ARGUMENTS") },
          }),
        ),
      ),
    ).toEqual([]);
  });
  it("parses Claude.ai text blocks and legacy text without attachments, tools or thinking", async () => {
    const parsed = parseClaudeExport(await fixture("claude"));
    expect(parsed[0]?.messages.map((m) => m.text)).toEqual([
      "A fixture question.",
      "A fixture answer.",
    ]);
    expect(parsed[0]?.provider).toBe("claude");
    expect(JSON.stringify(parsed)).not.toContain("DROP_");
    expect(
      parseClaudeExport(
        claude({ chat_messages: [{ sender: "assistant", content: [], text: "Fallback" }] }),
      )[0]?.messages[0]?.text,
    ).toBe("Fallback");
  });
  it("redacts both provider titles and messages before returning", () => {
    for (const parsed of [
      parseChatgptExport(
        chat(message({ content: { parts: ["sk-fixture-secret"] } }), {
          title: "ghp_fixture_secret",
        }),
      ),
      parseClaudeExport(
        claude({
          name: "ghp_fixture_secret",
          chat_messages: [{ sender: "assistant", text: "sk-fixture-secret" }],
        }),
      ),
    ]) {
      expect(parsed[0]?.title).toBe("[REDACTED TOKEN]");
      expect(parsed[0]?.messages[0]?.text).toBe("[REDACTED TOKEN]");
    }
  });
  it("uses deterministic dates and source identity fallbacks, and de-duplicates message IDs", () => {
    expect(parseChatgptExport(chat(message()))[0]?.messages[0]?.createdAt).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(
      parseChatgptExport(chat(message(), { create_time: 1792929600 }))[0]?.messages[0]?.createdAt,
    ).toBe("2026-10-25T12:00:00.000Z");
    const text = claude({
      created_at: "2026-10-25T13:00:00+01:00",
      chat_messages: [
        { sender: "human", text: "One", uuid: "same" },
        { sender: "human", text: "Two", uuid: "same" },
      ],
    });
    expect(parseClaudeExport(text)[0]?.messages).toHaveLength(1);
    expect(parseClaudeExport(text)[0]?.messages[0]?.createdAt).toBe("2026-10-25T12:00:00.000Z");
    expect(
      parseChatgptExport(chat(message(), { id: null, conversation_id: "other" }))[0]
        ?.conversationId,
    ).toBe(digest(["chatgpt-export", "other"]));
    const anonymous = chat(message(), { id: null });
    expect(parseChatgptExport(anonymous)).toEqual(parseChatgptExport(anonymous));
  });
  it.each([
    {},
    null,
    [],
    { conversations: {} },
    "broken",
  ])("rejects invalid top levels: %j", (value) => {
    if (Array.isArray(value)) expect(parseChatgptExport(JSON.stringify(value))).toEqual([]);
    else expect(() => parseChatgptExport(JSON.stringify(value))).toThrow();
  });
  it("rejects syntax errors, oversized bytes, conversations, messages and content", () => {
    expect(() => parseChatgptExport("{")).toThrow();
    expect(() => parseChatgptExport(" ".repeat(MAX_BYTES + 1))).toThrow(/limit/);
    expect(() => parseChatgptExport(JSON.stringify(Array(10001).fill(null)))).toThrow(/limit/);
    expect(() => parseClaudeExport(claude({ chat_messages: Array(100001).fill(null) }))).toThrow(
      /limit/,
    );
    expect(() =>
      parseChatgptExport(chat(message({ content: { parts: Array(10001).fill("x") } }))),
    ).toThrow(/limit/);
    expect(() =>
      parseClaudeExport(
        claude({
          chat_messages: [
            { sender: "assistant", content: Array(10001).fill({ type: "thinking" }) },
          ],
        }),
      ),
    ).toThrow(/limit/);
  });
  it("skips malformed nodes and unsupported roles, content and dates without coercion", () => {
    expect(
      parseChatgptExport(JSON.stringify([null, [], {}, { mapping: [] }, { mapping: { a: null } }])),
    ).toEqual([]);
    expect(
      parseClaudeExport(JSON.stringify([{}, { chat_messages: {} }, { chat_messages: [null] }])),
    ).toEqual([]);
    for (const content of [
      null,
      { parts: null },
      { parts: [null, 1, {}, { text: 4 }, { type: "image", text: "DROP" }] },
      { content_type: "reasoning", parts: ["DROP"] },
    ])
      expect(parseChatgptExport(chat(message({ content })))).toEqual([]);
    expect(parseChatgptExport(chat(message({ channel: "reasoning" })))).toEqual([]);
    expect(
      parseChatgptExport(chat(message({ create_time: 1e100 }), { create_time: "invalid" }))[0]
        ?.messages[0]?.createdAt,
    ).toBe("1970-01-01T00:00:00.000Z");
    expect(
      parseChatgptExport(
        chat(message({ content: { parts: [{ text: "Plain object" }] } }), { title: " " }),
      )[0]?.title,
    ).toBe("Untitled conversation");
    expect(
      parseClaudeExport(
        claude({
          created_at: "2026-99-99T00:00:00Z",
          chat_messages: [
            { sender: "human", text: "Hello", created_at: "unparsed" },
            { sender: "assistant", content: [{ type: "text", text: "" }] },
            { sender: "tool", text: "DROP" },
          ],
        }),
      )[0]?.messages[0]?.createdAt,
    ).toBe("1970-01-01T00:00:00.000Z");
    expect(parseClaudeExport(claude({ chat_messages: [{ sender: "human" }] }))).toEqual([]);
  });
});
