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
const codexMeta = (id: unknown, extra = {}) => ({
  type: "session_meta",
  payload: { id, cwd: "/fixture-project", ...extra },
});

describe("real-shaped redacted JSONL", () => {
  it.each([
    "claude",
    "codex",
  ] as const)("redacts credentials split across %s capture blocks and rows", (provider) => {
    const texts = ["AKIA0000", "000000000000 Safe ghp_fixture", "Token123"];
    const blocks = (values: string[]) => values.map((text) => ({ type: "text", text }));
    const rows =
      provider === "claude"
        ? [
            claudeRow({ role: "assistant", content: blocks(texts.slice(0, 2)) }, { uuid: "a" }),
            claudeRow({ role: "user", content: blocks(texts.slice(2)) }, { uuid: "b" }),
          ]
        : [
            codexRow({
              type: "message",
              role: "assistant",
              id: "a",
              content: blocks(texts.slice(0, 2)),
            }),
            codexRow({ type: "message", role: "user", id: "b", content: blocks(texts.slice(2)) }),
          ];
    const parser = provider === "claude" ? parseClaudeTranscript : parseCodexTranscript;
    expect(parser(jsonl(rows)).conversation.messages.map((message) => message.text)).toEqual([
      "[REDACTED]",
      "[REDACTED] Safe [REDACTED TOKEN]",
      "[REDACTED]",
    ]);
  });
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
  ] as const)("uses shared conversation redaction for URL right context and long PEM bodies in %s", (provider) => {
    const texts = [
      "https://bob:hunter2",
      "@h.test/",
      "-----BEGIN PRIVATE KEY-----\n",
      `${"fixtureKeyMaterial\n".repeat(26)}-----END PRIVATE KEY-----\nSafe`,
    ];
    const content = texts.map((text) => ({ type: "text", text }));
    const rows =
      provider === "claude"
        ? [claudeRow({ role: "user", content })]
        : [codexRow({ type: "message", role: "user", content })];
    const parser = provider === "claude" ? parseClaudeTranscript : parseCodexTranscript;
    expect(parser(jsonl(rows)).conversation.messages.map((message) => message.text)).toEqual([
      "https://bob:[REDACTED]",
      "@h.test/",
      "[REDACTED PRIVATE KEY]",
      "[REDACTED PRIVATE KEY]\nSafe",
    ]);
  });

  it.each([
    "claude",
    "codex",
  ] as const)("preserves %s source order and IDs across duplicates, appends and trimming", (provider) => {
    const parser = provider === "claude" ? parseClaudeTranscript : parseCodexTranscript;
    const row = (id: string, texts: string[]) => {
      const message = { role: "assistant", content: texts.map((text) => ({ type: "text", text })) };
      return provider === "claude"
        ? claudeRow(message, { uuid: id })
        : codexRow({ ...message, type: "message", id });
    };
    const texts = Array.from({ length: 20 }, (_, index) => `Block ${index}`);
    const first = row("first-row", texts);
    const second = row("second-row", ["Next row"]);
    const entries = [first, first, second];
    const parsed = parser(jsonl(entries)).conversation.messages;
    expect(parsed.map((message) => message.text)).toEqual([...texts, "Next row"]);
    expect(parser(jsonl([second])).conversation.messages).toEqual(parsed.slice(texts.length));
    expect(parser(jsonl([first])).conversation.messages).toEqual(parsed.slice(0, texts.length));
    expect(
      parser(jsonl([...entries, row("appended-row", ["Appended"])])).conversation.messages.slice(
        0,
        parsed.length,
      ),
    ).toEqual(parsed);
    expect(new Set(parsed.map((message) => message.createdAt))).toEqual(new Set([stamp]));
  });

  it("distinguishes native Codex messages by serialized fields and deduplicates replayed rollouts", () => {
    const payload = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Repeated text" }],
    };
    const first = codexRow(payload);
    const later = codexRow(payload, { timestamp: "2026-10-25T12:00:01.000Z" });
    const user = codexRow({ ...payload, role: "user" });
    const final = codexRow({ ...payload, phase: "final_answer" });
    const entries = [codexMeta("session"), first, later, user, final];
    const parsed = parseCodexTranscript(jsonl([...entries, ...entries])).conversation.messages;
    expect(parsed.map((message) => message.text)).toEqual(Array(4).fill("Repeated text"));
    expect(new Set(parsed.map((message) => message.id)).size).toBe(4);
    expect(parseCodexTranscript(jsonl([later, user, final])).conversation.messages).toEqual(
      parsed.slice(1),
    );
  });

  it("retains identical ID-less Codex occurrences with stable retry, append and trim identities", () => {
    const repeated = codexRow({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Repeated text" }],
    });
    const earlier = codexRow({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Earlier request" }],
    });
    const entries = [codexMeta("session"), earlier, repeated, repeated];
    const parsed = parseCodexTranscript(jsonl(entries));
    expect(parsed.conversation.messages.map((message) => message.text)).toEqual([
      "Earlier request",
      "Repeated text",
      "Repeated text",
    ]);
    expect(new Set(parsed.conversation.messages.map((message) => message.id)).size).toBe(3);
    expect(parseCodexTranscript(jsonl(entries))).toEqual(parsed);
    expect(parseCodexTranscript(jsonl([...entries, ...entries]))).toEqual(parsed);
    expect(
      parseCodexTranscript(jsonl(entries.filter((entry) => entry !== earlier))).conversation
        .messages,
    ).toEqual(parsed.conversation.messages.slice(1));
    const appended = parseCodexTranscript(jsonl([...entries, repeated])).conversation.messages;
    expect(appended.slice(0, 3)).toEqual(parsed.conversation.messages);
    expect(new Set(appended.map((message) => message.id)).size).toBe(4);
  });

  it.each([
    "turn_context",
    "task_started",
    "turn_started",
  ])("uses %s turn IDs to preserve identical inherited rows after trimming earlier turns", (type) => {
    const turn = (turnId: unknown) =>
      type === "turn_context"
        ? { type, payload: { turn_id: turnId } }
        : { type: "event_msg", payload: { type, turn_id: turnId } };
    const payload = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Continue" }],
    };
    const repeated = codexRow(payload);
    const metadata = [codexMeta("child", { forked_from_id: "parent" }), codexMeta("parent")];
    const firstTurn = [turn("first-turn"), repeated];
    const retained = [turn("second-turn"), repeated, turn("second-turn"), repeated];
    const entries = [...metadata, ...firstTurn, ...retained];
    const parsed = parseCodexTranscript(jsonl(entries));
    expect(parsed.conversation.messages.map((message) => message.text)).toEqual(
      Array(3).fill("Continue"),
    );
    expect(new Set(parsed.conversation.messages.map((message) => message.id)).size).toBe(3);
    expect(parseCodexTranscript(jsonl([...entries, ...entries]))).toEqual(parsed);
    expect(parseCodexTranscript(jsonl([...metadata, ...retained])).conversation.messages).toEqual(
      parsed.conversation.messages.slice(1),
    );
    expect(
      parseCodexTranscript(jsonl([...entries, turn(null), turn(3), turn(""), repeated])),
    ).toEqual(parseCodexTranscript(jsonl([...entries, repeated])));
    const explicit = codexRow({ ...payload, id: "explicit-message" });
    expect(
      parseCodexTranscript(jsonl([turn("first"), explicit, turn("second"), explicit])).conversation
        .messages,
    ).toHaveLength(1);
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
    ["web_search_call", "web_search"],
    ["image_generation_call", "image_generation"],
  ])("captures native %s names while dropping arguments, results and event mirrors", (type, name) => {
    const call = codexRow({
      type,
      id: "native-call",
      status: "completed",
      name: "DROP_UNTRUSTED_NAME",
      action: { type: "search", query: "DROP_QUERY" },
      revised_prompt: "DROP_PROMPT",
      result: "DROP_IMAGE_RESULT",
      arguments: "DROP_ARGUMENTS",
    });
    const parsed = parseCodexTranscript(
      jsonl([
        call,
        call,
        { type: "event_msg", timestamp: stamp, payload: { type, text: "DROP_EVENT_MIRROR" } },
        codexRow({ type: `${type}_output`, output: "DROP_OUTPUT" }),
      ]),
    );
    expect(parsed.conversation.messages).toEqual([
      { id: expect.stringMatching(/^[a-f0-9]{64}$/), role: "tool", text: name, createdAt: stamp },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("DROP_");
    const withoutId = parseCodexTranscript(jsonl([codexRow({ type })]));
    expect(withoutId.conversation.messages.map((message) => message.text)).toEqual([name]);
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

  it.each([
    false,
    true,
  ])("keeps the first Codex thread identity and validates inherited metadata (nested=%s)", (nested) => {
    const entries = [
      codexMeta("child", { cwd: "/child-project", forked_from_id: "parent" }),
      codexMeta("parent", { forked_from_id: nested ? "ancestor" : null }),
      ...(nested ? [codexMeta("ancestor", { cwd: "/ancestor-project" })] : []),
      codexRow({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Inherited request" }],
      }),
      { type: "turn_context", payload: { cwd: "/current-project" } },
      codexRow({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Fork answer" }],
      }),
    ];
    const parsed = parseCodexTranscript(jsonl(entries), "fallback-path");
    expect(parsed.conversation.conversationId).toBe(digest(["codex", "child"]));
    expect(parsed.projectDirectories).toEqual([
      "/child-project",
      "/fixture-project",
      ...(nested ? ["/ancestor-project"] : []),
      "/current-project",
    ]);
    expect(parsed.conversation.messages.map((message) => message.text)).toEqual([
      "Inherited request",
      "Fork answer",
    ]);
    expect(parseCodexTranscript(jsonl([...entries, ...entries]), "other-path")).toEqual(parsed);
    expect(parseCodexTranscript(jsonl([entries[0]])).conversation.conversationId).toBe(
      parsed.conversation.conversationId,
    );
  });

  it.each([
    [codexMeta(undefined), codexMeta("later")],
    [codexMeta(1)],
    [codexMeta("")],
    [codexMeta("child", { forked_from_id: 1 })],
    [codexMeta("child", { forked_from_id: "" })],
    [codexMeta("child", { forked_from_id: "child" })],
    [codexMeta("child", { forked_from_id: "parent" }), codexMeta("unrelated")],
    [
      codexMeta("child", { forked_from_id: "parent" }),
      codexMeta("parent", { forked_from_id: "child" }),
    ],
    [
      codexMeta("child", { forked_from_id: "parent" }),
      codexMeta("child", { forked_from_id: "unrelated" }),
    ],
    [
      codexMeta("child", { forked_from_id: "parent" }),
      codexMeta("ancestor"),
      codexMeta("parent", { forked_from_id: "ancestor" }),
    ],
    [codexMeta("child", { forked_from_id: "parent" }), codexMeta("parent"), codexMeta("unrelated")],
  ])("rejects invalid or unrelated Codex fork metadata %#", (...entries) => {
    expect(() => parseCodexTranscript(jsonl(entries))).toThrow();
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
