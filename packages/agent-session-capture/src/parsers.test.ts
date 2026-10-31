// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { digest, parseClaudeTranscript, parseCodexTranscript } from "./parsers.js";

const stamp = "2026-10-25T12:00:00.000Z";
const jsonl = (values: unknown[]) => values.map((v) => JSON.stringify(v)).join("\r\n");
const claudeRow = (message: unknown, extra = {}) => ({
  type: "assistant",
  timestamp: stamp,
  message,
  ...extra,
});
const codexRow = (payload: unknown, extra = {}) => ({
  type: "response_item",
  timestamp: stamp,
  payload,
  ...extra,
});

describe("real-shaped redacted JSONL", () => {
  it.each([
    ["claude", parseClaudeTranscript, ["user", "assistant", "tool", "assistant"]],
    ["codex", parseCodexTranscript, ["user", "tool", "tool", "assistant"]],
  ] as const)("captures %s text and tool names without hidden data or mirror events", (name, parser, roles) => {
    const input = readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), "utf8");
    const parsed = parser(input);
    expect(parsed.projectDirectories).toEqual(["/fixture-project"]);
    expect(parsed.conversation.provider).toBe(name);
    expect(parsed.conversation.messages.map((m) => m.role)).toEqual(roles);
    expect(JSON.stringify(parsed)).not.toContain("DROP_");
    expect(parsed.conversation.messages.at(-1)?.text).toBe("The project looks good.");
    expect(parser(`${input}\n{"incomplete"`)).toEqual(parsed);
    expect(parser(input + input)).toEqual(parsed);
    expect(parsed.conversation.messages.every((m) => /^[a-f0-9]{64}$/.test(m.id ?? ""))).toBe(true);
  });

  it("redacts text, tool names and opaque identifiers without retaining source IDs", () => {
    const input = jsonl([
      claudeRow(
        {
          role: "assistant",
          content: [
            { type: "text", text: "sk-fixture-token" },
            { type: "tool_use", name: "ghp_fixture" },
          ],
        },
        { sessionId: "sk-source-session", uuid: "ghp_sourceId" },
      ),
    ]);
    const parsed = parseClaudeTranscript(input);
    expect(parsed.conversation.messages.map((m) => m.text)).toEqual([
      "[REDACTED TOKEN]",
      "[REDACTED TOKEN]",
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/sk-|ghp_/);
  });

  it.each([
    "claude",
    "codex",
  ] as const)("preserves %s block and row order on timestamp ties, including duplicates and appends", (provider) => {
    const parser = provider === "claude" ? parseClaudeTranscript : parseCodexTranscript;
    const row = (id: string, texts: string[]) => {
      const message = { role: "assistant", content: texts.map((text) => ({ type: "text", text })) };
      return provider === "claude"
        ? claudeRow(message, { uuid: id })
        : codexRow({ ...message, type: "message", id });
    };
    const texts = Array.from({ length: 20 }, (_, index) => `Block ${index}`);
    const first = row("first-row", texts);
    const entries = [first, first, row("second-row", ["Next row"])];
    const parsed = parser(jsonl(entries)).conversation.messages;
    expect(parsed.map((message) => message.text)).toEqual([...texts, "Next row"]);
    // ChatWriter orders timestamp ties by ID; listings need not follow write order.
    expect(
      [...parsed].reverse().sort((a, b) => (a.id as string).localeCompare(b.id as string)),
    ).toEqual(parsed);
    expect(parser(jsonl([first])).conversation.messages).toEqual(parsed.slice(0, texts.length));
    expect(
      parser(jsonl([...entries, row("appended-row", ["Appended"])])).conversation.messages.slice(
        0,
        parsed.length,
      ),
    ).toEqual(parsed);
    expect(new Set(parsed.map((message) => message.createdAt))).toEqual(new Set([stamp]));
  });

  it("keeps stable IDs when a transcript grows and accepts fallback IDs and normalized zones", () => {
    const first = claudeRow(
      { id: "message-1", role: "assistant", content: "Hi" },
      { timestamp: "2026-10-25T13:00:00+01:00" },
    );
    const second = claudeRow({ role: "assistant", content: [{ type: "text", text: "Bye" }] });
    const parsed = parseClaudeTranscript(jsonl([first, second]), "source");
    expect(parsed.conversation.conversationId).toBe(digest(["claude", "source"]));
    expect(parsed.conversation.messages[0]).toEqual(
      parseClaudeTranscript(jsonl([first]), "source").conversation.messages[0],
    );
    expect(parsed.conversation.messages[0]?.createdAt).toBe(stamp);
    expect(parsed.conversation.messages[1]?.id).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.conversation.messages[1]?.id).not.toBe(parsed.conversation.messages[0]?.id);
    const shell = parseCodexTranscript(
      jsonl([
        codexRow({ type: "local_shell_call", id: "shell-id", action: { command: "DROP_COMMAND" } }),
      ]),
    );
    expect(shell.conversation.messages[0]?.text).toBe("shell");
  });

  it.each([
    parseClaudeTranscript,
    parseCodexTranscript,
  ])("ignores malformed rows and JSON primitives", (parser) => {
    expect(parser('null\n[]\n4\n"hi"\ntrue\ninvalid\n').conversation.messages).toEqual([]);
  });

  it("rejects mixed session IDs rather than crossing project boundaries", () => {
    expect(() => parseClaudeTranscript(jsonl([{ sessionId: "a" }, { sessionId: "b" }]))).toThrow(
      "Mixed",
    );
    expect(() =>
      parseCodexTranscript(
        jsonl([
          { type: "session_meta", payload: { id: "a" } },
          { type: "session_meta", payload: { id: "b" } },
        ]),
      ),
    ).toThrow("Mixed");
  });

  it("drops invalid/missing timestamps, roles, content, and unsafe tool names", () => {
    const invalidTimes = [
      undefined,
      123,
      "not-time",
      "2026-99-25T12:00:00Z",
      "2026-10-25T12:00:00",
    ];
    const messages = [
      ...invalidTimes.map((timestamp) =>
        claudeRow({ role: "user", content: "DROP" }, { timestamp }),
      ),
      claudeRow({ role: "system", content: "DROP_SYSTEM" }),
      claudeRow(null),
      claudeRow({
        role: "assistant",
        content: [
          null,
          {},
          { type: "text", text: 2 },
          { type: "text", text: "" },
          { type: "tool_use", name: "bad tool" },
        ],
      }),
      claudeRow({ role: "user", content: [{ type: "tool_use", name: "DROP_USER_TOOL" }] }),
    ];
    expect(parseClaudeTranscript(jsonl(messages)).conversation.messages).toEqual([]);
    const payloads = [
      ...invalidTimes.map((timestamp) =>
        codexRow(
          { type: "message", role: "user", content: [{ type: "input_text", text: "DROP" }] },
          { timestamp },
        ),
      ),
      codexRow(null),
      codexRow({ type: "message", role: "system", content: [] }),
      codexRow({ type: "message", role: "user", content: "DROP" }),
      codexRow({
        type: "message",
        role: "assistant",
        content: [null, { type: "image", text: "DROP" }, { type: "text" }],
      }),
      codexRow({ type: "function_call", name: "bad tool" }),
    ];
    expect(parseCodexTranscript(jsonl(payloads)).conversation.messages).toEqual([]);
  });
});
