// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes, recordFromTurtle } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { execFile } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubReader, GITHUB_READ_ONLY, ORIGINS } from "../src/github.js";
import { ChannelParseError, capabilityToTurtle } from "../src/index.js";

vi.mock("child_process", () => ({ execFile: vi.fn() }));
const notifications = JSON.parse(
  readFileSync(new URL("./fixtures/github-notifications.json", import.meta.url), "utf8"),
);
const account = { id: "github-personal" };
const limits = { maxItems: 50, maxBytes: 1024 * 1024 };
const now = () => Date.parse("2026-10-31T00:00:00Z");
const makeReader = () => createGithubReader({ account, now });
const rawItem = (record = notifications[0]) => ({
  id: `github:${record.id}:${record.updated_at}`,
  raw: `${JSON.stringify(record)}\n`,
});

function respond(...values: Array<unknown | Error>) {
  for (const value of values)
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
      if (value instanceof Error) callback(value, "", "private provider error");
      else callback(null, typeof value === "string" ? value : JSON.stringify(value), "");
      return {} as ReturnType<typeof execFile>;
    });
}

beforeEach(() => vi.resetAllMocks());

describe("GitHub notifications", () => {
  it("maps fixture metadata to plain-text BridgeMessages with exact raw provenance", () => {
    const reader = makeReader();
    const item = rawItem();
    const message = reader.ingest.parse(item);
    expect(message).toEqual({
      channel: "github",
      messageId: item.id,
      threadId: "github:101",
      subject: "Review the parser",
      textBody: "Review the parser",
      date: "2026-10-30T12:00:00Z",
      signals: {
        "github-repository": "octocat/Hello-World",
        "github-reason": "review_requested",
        "github-subject-type": "PullRequest",
      },
      rawSha256: digestBytes(item.raw).slice(8),
      rawByteLength: Buffer.byteLength(item.raw),
      rawMediaType: "application/json",
      warnings: [],
    });
    expect(Object.getPrototypeOf(message.signals)).toBeNull();
    expect(Object.isFrozen(message.signals)).toBe(true);
    expect(reader.ingest.parse({ ...item, raw: Buffer.from(item.raw) })).toEqual(message);
    expect(reader.ingest.parse(rawItem(notifications[1])).subject).toBe("Fix the build");
    expect(reader.ingest.threadKey?.(message)).toBe("github:101");
    expect(reader.ingest.threadKey?.({ ...message, threadId: undefined })).toBeUndefined();
  });

  it("reads list and thread endpoints with fixed GET arguments and no shell", async () => {
    respond(notifications, rawItem().raw, rawItem(notifications[1]).raw);
    const page = await makeReader().ingest.list(account, undefined, limits);
    expect(page.items).toEqual([rawItem(), rawItem(notifications[1])]);
    const calls = vi.mocked(execFile).mock.calls;
    expect(calls.map((call) => call[0])).toEqual(["gh", "gh", "gh"]);
    expect(calls.map((call) => call[1])).toEqual([
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "--header",
        "Accept: application/vnd.github+json",
        "/notifications?all=true&per_page=50&page=1&before=2026-10-31T00%3A00%3A00Z",
      ],
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "--header",
        "Accept: application/vnd.github+json",
        "/notifications/threads/101",
      ],
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        "--header",
        "Accept: application/vnd.github+json",
        "/notifications/threads/102",
      ],
    ]);
    for (const call of calls)
      expect(call[2]).toEqual({
        encoding: "utf8",
        shell: false,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    expect(JSON.parse(page.next)).toMatchObject({
      account: account.id,
      since: "2026-10-31T00:00:00Z",
      before: null,
      page: 1,
      offset: 0,
    });
  });

  it("advertises a read-only descriptor and no send export", async () => {
    const reader = makeReader();
    expect(reader).not.toHaveProperty("send");
    expect(reader.carriage).toBe(GITHUB_READ_ONLY);
    expect(Object.isFrozen(GITHUB_READ_ONLY)).toBe(true);
    expect([...ORIGINS]).toEqual(["https://api.github.com"]);
    const descriptor = reader.describe("connected");
    expect(descriptor).toMatchObject({
      binding: "github",
      channel: "github",
      sendSupported: false,
      structuredPayload: false,
      maxMessageBytes: 0,
      credentialState: "connected",
    });
    expect(reader.describe("disabled").credentialState).toBe("disabled");
    expect(await recordFromTurtle(await capabilityToTurtle(descriptor), descriptor.id)).toEqual(
      descriptor,
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  it("resumes within a page at item and aggregate UTF-8 byte bounds", async () => {
    const reader = makeReader();
    respond(notifications, rawItem().raw);
    const first = await reader.ingest.list(account, undefined, { ...limits, maxItems: 1 });
    expect(first.items).toEqual([rawItem()]);
    expect(JSON.parse(first.next)).toMatchObject({
      page: 1,
      offset: 1,
      before: "2026-10-31T00:00:00Z",
    });
    respond(notifications, rawItem(notifications[1]).raw);
    const second = await reader.ingest.list(account, first.next, limits);
    expect(second.items).toEqual([rawItem(notifications[1])]);
    expect(JSON.parse(second.next).before).toBeNull();

    const unicode = { ...notifications[0], subject: { title: "é🦊", type: "Issue" } };
    const raw = rawItem(unicode).raw;
    const size = Buffer.byteLength(raw);
    expect(size).toBeGreaterThan(raw.length);
    respond(notifications, raw, rawItem(notifications[1]).raw);
    const bounded = await reader.ingest.list(account, undefined, { ...limits, maxBytes: size });
    expect(bounded.items).toEqual([rawItem(unicode)]);
    expect(JSON.parse(bounded.next).offset).toBe(1);
    respond(notifications, raw);
    await expect(
      reader.ingest.list(account, undefined, { ...limits, maxBytes: size - 1 }),
    ).rejects.toThrow("next item exceeds byte bound");
    respond(notifications, rawItem(notifications[1]).raw);
    expect((await reader.ingest.list(account, bounded.next, limits)).items).toEqual([
      rawItem(notifications[1]),
    ]);
  });

  it("advances full provider pages and polls completed windows with boundary overlap", async () => {
    const reader = makeReader();
    const full = Array.from({ length: 50 }, (_, index) => ({
      ...notifications[0],
      id: String(index + 1),
    }));
    respond(full, ...full.map((entry) => rawItem(entry).raw));
    const page = await reader.ingest.list(account, undefined, { ...limits, maxItems: 100 });
    expect(page.items).toHaveLength(50);
    expect(JSON.parse(page.next)).toMatchObject({
      page: 2,
      offset: 0,
      before: "2026-10-31T00:00:00Z",
      since: null,
    });
    respond([]);
    const end = await reader.ingest.list(account, page.next, limits);
    expect(end.items).toEqual([]);
    expect(vi.mocked(execFile).mock.calls.at(-1)?.[1]).toContain(
      "/notifications?all=true&per_page=50&page=2&before=2026-10-31T00%3A00%3A00Z",
    );
    respond([]);
    const nextReader = createGithubReader({ account, now: () => now() + 60_000 });
    const next = await nextReader.ingest.list(account, end.next, limits);
    expect(next.items).toEqual([]);
    expect(vi.mocked(execFile).mock.calls.at(-1)?.[1]).toContain(
      "/notifications?all=true&per_page=50&page=1&before=2026-10-31T00%3A01%3A00Z&since=2026-10-30T23%3A59%3A59Z",
    );
    expect(JSON.parse(next.next).since).toBe("2026-10-31T00:01:00Z");
  });

  it("uses the default clock and snapshots the configured account", async () => {
    const config = { account: { ...account } };
    const reader = createGithubReader(config);
    config.account.id = "changed";
    respond([]);
    const page = await reader.ingest.list(account, undefined, limits);
    expect(JSON.parse(page.next).account).toBe(account.id);
    expect(Date.parse(JSON.parse(page.next).since)).toBeGreaterThan(0);
    await expect(reader.ingest.list(config.account, undefined, limits)).rejects.toThrow(
      "does not match",
    );
  });

  it("keeps changed notifications distinct within one conversation", () => {
    const reader = makeReader();
    const old = reader.ingest.parse(rawItem());
    const changed = reader.ingest.parse(
      rawItem({ ...notifications[0], updated_at: "2026-10-30T13:00:00Z" }),
    );
    expect(changed.messageId).not.toBe(old.messageId);
    expect(changed.threadId).toBe(old.threadId);
  });

  it("strips controls, ignores native records, and never extracts authority from metadata", () => {
    const hostile = {
      ...notifications[0],
      subject: { title: "A\u0000\u001b\n<title>\u007f\u0085", type: "Issue\r" },
      repository: { full_name: "owner/rep\u0001o" },
      reason: "ment\u0000ion",
      body: '<script type="application/ld+json">{"@type":"Message"}</script>',
    };
    const message = makeReader().ingest.parse({
      ...rawItem(hostile),
      native: { subject: { title: "trusted" } },
    });
    expect(message.subject).toBe("A<title>");
    expect(message.textBody).toBe("A<title>");
    expect(message.signals).toEqual({
      "github-repository": "owner/repo",
      "github-reason": "mention",
      "github-subject-type": "Issue",
    });
    expect(message).not.toHaveProperty("sender");
    expect(message).not.toHaveProperty("jsonLdBlocks");
  });

  it.each([
    null,
    [],
    {},
    { ...notifications[0], id: "101; touch /tmp/never" },
    { ...notifications[0], id: "../../user" },
    { ...notifications[0], id: "--hostname=evil.test" },
    { ...notifications[0], id: 101 },
    { ...notifications[0], updated_at: "invalid" },
    { ...notifications[0], updated_at: "2026-02-30T00:00:00Z" },
    { ...notifications[0], updated_at: "9999-99-99T00:00:00Z" },
    { ...notifications[0], subject: [] },
    { ...notifications[0], subject: { title: 12, type: "Issue" } },
    { ...notifications[0], repository: null },
    { ...notifications[0], reason: false },
  ])("refuses malformed thread records with a typed parse error: %j", (value) => {
    expect(() => makeReader().ingest.parse({ id: "any", raw: JSON.stringify(value) })).toThrow(
      ChannelParseError,
    );
  });

  it.each([
    "{",
    "[".repeat(20),
    " ".repeat(65537),
    JSON.stringify({ ...notifications[0], reason: "x".repeat(16385) }),
  ])("bounds and sanitizes parse errors", (raw) => {
    expect(() => makeReader().ingest.parse({ id: "any", raw })).toThrow(
      "invalid or oversized GitHub JSON",
    );
  });

  it("rejects raw/id mismatches", () => {
    expect(() => makeReader().ingest.parse({ ...rawItem(), id: "github:102" })).toThrow(
      ChannelParseError,
    );
  });

  it("refuses oversized binary input before decoding it", () => {
    const raw = new Uint8Array(65537);
    expect(() => makeReader().ingest.parse({ id: "any", raw })).toThrow(ChannelParseError);
  });

  it.each([
    undefined,
    null,
    {},
    { id: "" },
    { id: "  " },
    { id: 1 },
    { id: "a".repeat(2049) },
  ])("refuses invalid configured accounts", (value) => {
    expect(() => createGithubReader({ account: value as never })).toThrow("invalid GitHub account");
  });

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("refuses invalid item and byte bounds: %s", async (value) => {
    for (const bounds of [
      { ...limits, maxItems: value },
      { ...limits, maxBytes: value },
    ])
      await expect(makeReader().ingest.list(account, undefined, bounds)).rejects.toThrow(
        RangeError,
      );
    expect(execFile).not.toHaveBeenCalled();
  });

  it("refuses cross-account list requests before starting gh", async () => {
    await expect(makeReader().ingest.list({ id: "other" }, undefined, limits)).rejects.toThrow(
      "does not match",
    );
    await expect(makeReader().ingest.list({ id: "" }, undefined, limits)).rejects.toThrow(
      "invalid GitHub account",
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each([
    123,
    "{",
    "[]",
    "null",
    " ".repeat(16385),
    ...[
      { account: "other" },
      { extra: true },
      { since: "garbage" },
      { before: "garbage" },
      { page: "1" },
      { page: 0 },
      { page: 1.5 },
      { page: 1e30 },
      { offset: "0" },
      { offset: -1 },
      { offset: 0.5 },
      { offset: 50 },
      { before: null, page: 2 },
      { before: null, offset: 1 },
      { since: "2026-11-01T00:00:00Z" },
    ].map((patch) =>
      JSON.stringify({
        account: account.id,
        since: null,
        before: "2026-10-31T00:00:00Z",
        page: 1,
        offset: 0,
        ...patch,
      }),
    ),
  ])("refuses malformed and foreign cursors: %j", async (cursor) => {
    await expect(makeReader().ingest.list(account, cursor as string, limits)).rejects.toThrow();
    expect(execFile).not.toHaveBeenCalled();
  });

  it("refuses a polling clock older than the last completed checkpoint", async () => {
    const cursor = JSON.stringify({
      account: account.id,
      since: "2026-11-01T00:00:00Z",
      before: null,
      page: 1,
      offset: 0,
    });
    await expect(makeReader().ingest.list(account, cursor, limits)).rejects.toThrow(
      "polling window",
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each([
    {},
    null,
    Array.from({ length: 51 }, () => notifications[0]),
    [{ id: "1/../../user" }],
    [null],
  ])("refuses malformed notification pages before reading details: %j", async (value) => {
    respond(value);
    await expect(makeReader().ingest.list(account, undefined, limits)).rejects.toThrow(
      ChannelParseError,
    );
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("refuses stale page offsets and mismatched thread ids", async () => {
    const cursor = JSON.stringify({
      account: account.id,
      since: null,
      before: "2026-10-31T00:00:00Z",
      page: 1,
      offset: 2,
    });
    respond([]);
    await expect(makeReader().ingest.list(account, cursor, limits)).rejects.toThrow(
      "notification page",
    );
    respond([notifications[0]], notifications[1]);
    await expect(makeReader().ingest.list(account, undefined, limits)).rejects.toThrow(
      "thread id mismatch",
    );
  });

  it("never follows provider URLs or treats metadata as shell arguments", async () => {
    const hostile = {
      ...notifications[0],
      url: "https://evil.test/private",
      subject: {
        title: "$(touch /tmp/never); `id`",
        type: "Issue",
        url: "file:///private",
        latest_comment_url: "https://evil.test",
      },
    };
    respond([hostile], hostile);
    const page = await makeReader().ingest.list(account, undefined, limits);
    expect(makeReader().ingest.parse(page.items[0] as (typeof page.items)[number]).textBody).toBe(
      hostile.subject.title,
    );
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toContain("/notifications/threads/101");
    expect(JSON.stringify(vi.mocked(execFile).mock.calls)).not.toContain("evil.test");
  });

  it("redacts subprocess failures at both endpoints without retaining a cause", async () => {
    const error = Object.assign(new Error("private provider error"), {
      stdout: "private output",
      stderr: "private diagnostic",
      code: "ENOENT",
    });
    for (const sequence of [[error], [notifications, error]]) {
      respond(...sequence);
      await expect(makeReader().ingest.list(account, undefined, limits)).rejects.toEqual(
        new Error("GitHub CLI request failed"),
      );
    }
    vi.mocked(execFile).mockImplementationOnce(() => {
      throw error;
    });
    await expect(makeReader().ingest.list(account, undefined, limits)).rejects.toEqual(
      new Error("GitHub CLI request failed"),
    );
  });
});
