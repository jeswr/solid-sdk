// AUTHORED-BY GPT-5.6 Codex
import { describe, expect, test } from "vitest";
import {
  CAPABILITIES,
  checkFixture,
  checkNavigation,
  checkRejectedShare,
  checkTextShare,
  FRAME_PROBES,
  parseDevtoolsSockets,
  quoteAndroidShell,
} from "../e2e/checks.ts";

const suite = "http://localhost:4173";
const foreign = "http://localhost:4174";
const passing = () => ({
  page: "index",
  done: true,
  origin: suite,
  topBridge: true,
  listenerReady: true,
  errors: [],
  capabilities: Object.fromEntries(CAPABILITIES.map((key) => [key, true])),
  hostile: {
    origin: foreign,
    attempts: Object.fromEntries(FRAME_PROBES.map((key) => [key, { status: "unavailable" }])),
  },
});
const batch = (text = "shared text") => ({ id: "batch-1", items: [{ kind: "text", text }] });

describe("app DevTools socket selection", () => {
  test("extracts only the exact app PID, strips @, deduplicates and handles CRLF", () => {
    const unix = [
      "Num RefCount Protocol Flags Type St Inode Path",
      "0: 2 0 10000 1 1 123 @webview_devtools_remote_42",
      "1: 2 0 10000 1 1 124 @webview_devtools_remote_420",
      "2: 2 0 10000 1 1 125 @chrome_devtools_remote",
      "3: 2 0 10000 1 1 126 @webview_devtools_remote_42",
      "4: 2 0 10000 1 1 127 @webview_devtools_remote_42;evil",
      "5: 2 0 10000 1 1 128 /webview_devtools_remote_42",
    ].join("\r\n");
    expect(parseDevtoolsSockets(unix, "42")).toEqual(["webview_devtools_remote_42"]);
    expect(parseDevtoolsSockets(unix, "99")).toEqual([]);
    expect(parseDevtoolsSockets("", "42")).toEqual([]);
  });
  test.each([
    "",
    "0",
    "-1",
    "42 43",
    "42\n",
    "042",
    "42;echo",
    "NaN",
  ])("refuses invalid PID %j", (pid) => {
    expect(() => parseDevtoolsSockets("", pid)).toThrow("PID");
  });
});

describe("fixture result assertions fail closed", () => {
  test("accepts complete evidence", () =>
    expect(checkFixture(passing(), suite, foreign)).toEqual([]));
  test.each([undefined, null, [], {}, "true"])("rejects malformed result %j", (value) => {
    expect(checkFixture(value, suite, foreign).length).toBeGreaterThan(0);
  });
  test.each(CAPABILITIES)("requires %s to be true", (key) => {
    for (const value of [false, undefined, "true"]) {
      const result = passing();
      Object.assign(result.capabilities, { [key]: value });
      expect(checkFixture(result, suite, foreign)).toContain(`Missing capability: ${key}`);
    }
  });
  test.each([
    { done: false },
    { page: "foreign" },
    { origin: foreign },
    { topBridge: false },
    { listenerReady: false },
    { errors: ["failed"] },
    { errors: undefined },
    { hostile: null },
    { hostile: { origin: suite, attempts: {} } },
  ])("rejects incomplete or failed evidence %j", (patch) => {
    expect(checkFixture({ ...passing(), ...patch }, suite, foreign).length).toBeGreaterThan(0);
  });
  test("will not accept a same-origin iframe", () => {
    expect(checkFixture(passing(), suite, suite)).toContain(
      "Missing cross-origin hostile frame evidence",
    );
  });
  test.each(FRAME_PROBES)("requires failure evidence for %s", (key) => {
    for (const status of [undefined, "exposed", "posted", "success", true, "timeout"]) {
      const result = passing();
      Object.assign(result.hostile.attempts, { [key]: { status } });
      expect(checkFixture(result, suite, foreign)).toContain(
        `Hostile frame native surface accessible or unproven: ${key}`,
      );
    }
    const missing = passing();
    delete missing.hostile.attempts[key];
    expect(checkFixture(missing, suite, foreign).length).toBeGreaterThan(0);
  });
  test("allows explicit rejection", () => {
    const result = passing();
    result.hostile.attempts = Object.fromEntries(
      FRAME_PROBES.map((key) => [key, { status: "rejected" }]),
    );
    expect(checkFixture(result, suite, foreign)).toEqual([]);
  });
  test("allows a non-responding plugin wrapper only with every native surface absent", () => {
    const result = passing();
    result.hostile.attempts.capacitorPlugin = { status: "no-response" };
    expect(checkFixture(result, suite, foreign)).toEqual([]);
    for (const key of FRAME_PROBES.filter((key) => key !== "capacitorPlugin")) {
      const exposed = structuredClone(result);
      exposed.hostile.attempts[key] = { status: "rejected" };
      expect(checkFixture(exposed, suite, foreign)).toContain(
        "Hostile frame native surface accessible or unproven: capacitorPlugin",
      );
    }
  });
});

describe("share evidence", () => {
  test("requires exactly one batch and one text item, including exact whitespace", () => {
    expect(checkTextShare([batch()], "shared text")).toEqual([]);
    expect(checkTextShare([batch(" shared text ")], "shared text").length).toBeGreaterThan(0);
  });
  test.each([
    null,
    {},
    [],
    [batch(), batch()],
    [null],
    [{ items: batch().items }],
    [{ id: "", items: batch().items }],
    [{ id: "1", items: [] }],
    [{ id: "1", items: [null] }],
    [{ id: "1", items: [batch().items[0], batch().items[0]] }],
    [{ id: "1", items: [{ kind: "url", text: "shared text" }] }],
    [{ id: "1", items: [{ kind: "text", text: "other" }] }],
  ])("rejects malformed or different accepted share %j", (value) => {
    expect(checkTextShare(value, "shared text").length).toBeGreaterThan(0);
  });
  test("rejecting a stream means no file, no fallback text and no notification", () => {
    expect(checkRejectedShare([], [])).toEqual([]);
    for (const [pending, events] of [
      [null, []],
      [[], null],
      [[batch()], []],
      [[], [batch()]],
      [{}, {}],
    ]) {
      expect(checkRejectedShare(pending, events).length).toBeGreaterThan(0);
    }
  });
});

describe("navigation evidence", () => {
  const target = `${foreign}/foreign.html`;
  const result = () => ({
    page: "navigation",
    done: true,
    origin: suite,
    navigation: { attempted: true, refused: true, target },
  });
  test("accepts a completed attempt that left the document on the suite origin", () => {
    expect(checkNavigation(result(), suite, target)).toEqual([]);
  });
  test.each([
    null,
    {},
    { ...result(), done: false },
    { ...result(), origin: foreign },
    { ...result(), page: "index" },
    { ...result(), navigation: {} },
    { ...result(), navigation: { attempted: false, refused: true, target } },
    { ...result(), navigation: { attempted: true, refused: false, target } },
    { ...result(), navigation: { attempted: true, refused: true, target: suite } },
  ])("refuses missing, stale or foreign-page evidence %j", (value) => {
    expect(checkNavigation(value, suite, target).length).toBeGreaterThan(0);
  });
});

describe("adb remote shell quoting", () => {
  test.each([
    ["", "''"],
    ["simple", "'simple'"],
    ["spaces and 'quotes'", "'spaces and '\\''quotes'\\'''"],
    [
      '"double" $HOME `id` $(id); & | > * \\ newline\nΩ',
      "'\"double\" $HOME `id` $(id); & | > * \\ newline\nΩ'",
    ],
  ])("single-quotes the complete remote argument: %j", (value, expected) => {
    expect(quoteAndroidShell(value)).toBe(expected);
  });
  test("refuses NUL", () => expect(() => quoteAndroidShell("a\0b")).toThrow("NUL"));
});
