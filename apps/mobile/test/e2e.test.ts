// AUTHORED-BY GPT-5.6 Codex
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CAPABILITIES,
  checkFixture,
  checkIOSNavigation,
  checkNavigation,
  checkRejectedShare,
  checkTextShare,
  checkTextShareDelivery,
  FRAME_PROBES,
  IOS_FRAME_PROBES,
  parseDevtoolsSockets,
  quoteAndroidShell,
} from "../e2e/checks.ts";
import { verifyRejectedShare, waitForTextShare } from "../e2e/share-probes.ts";

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

const passingIOS = () => ({
  ...passing(),
  platform: "ios",
  listenerSubscriptionRequested: true,
  ios: {
    top: {
      webkitBridge: { status: "resolved", callbackId: "mob07-top-unique", data: { batches: [] } },
      prompt: { status: "response", value: "false" },
    },
    responses: [] as object[],
  },
  hostile: {
    origin: foreign,
    attempts: {
      webkitBridge: { status: "no-response", callbackId: "mob07-hostile-unique", observedMs: 2000 },
      prompt: { status: "no-response", observedMs: 2000, value: null },
    },
  },
});

describe("iOS native-effect assertions", () => {
  const verdict = (value: unknown) => checkFixture(value, suite, foreign, "ios");
  test("accepts visible handlers with silence and successful identical top-frame controls", () => {
    expect(verdict(passingIOS())).toEqual([]);
    expect(checkFixture(passingIOS(), suite, foreign).length).toBeGreaterThan(0);
    expect(verdict(passing()).length).toBeGreaterThan(0);
  });
  test.each([
    true,
    false,
    undefined,
  ])("iOS verdicts ignore listener subscription fields (%j)", (value) => {
    expect(
      verdict({ ...passingIOS(), listenerReady: value, listenerSubscriptionRequested: value }),
    ).toEqual([]);
    const broken = { ...passingIOS(), topBridge: false };
    expect(
      verdict({ ...broken, listenerReady: value, listenerSubscriptionRequested: value }),
    ).toEqual(verdict(broken));
  });
  test("a listenerReady claim alone supplies no iOS evidence", () => {
    const claimed = { platform: "ios", listenerReady: true };
    expect(verdict(claimed)).toEqual(verdict({ platform: "ios" }));
    expect(verdict(claimed)).toContain("Top-frame SuiteShareIntake.getPending failed");
    for (const key of CAPABILITIES)
      expect(verdict(claimed)).toContain(`Missing capability: ${key}`);
    for (const key of IOS_FRAME_PROBES) {
      expect(verdict(claimed)).toContain(
        `iOS iframe isolation is vacuous: ${key} top-frame control failed`,
      );
    }
    expect(checkIOSNavigation(claimed, suite, `${foreign}/foreign.html`).length).toBeGreaterThan(0);
    expect(checkRejectedShare(claimed, claimed).length).toBeGreaterThan(0);
  });
  test.each(
    IOS_FRAME_PROBES,
  )("rejects absent, malformed, exposed and short-window %s evidence", (key) => {
    for (const attempt of [
      undefined,
      null,
      {},
      { status: "unavailable" },
      { status: "response" },
      { status: "error" },
      { status: "no-response", observedMs: 1999 },
    ]) {
      const value = passingIOS();
      Object.assign(value.hostile.attempts, { [key]: attempt });
      expect(verdict(value)).toContain(
        `Hostile frame native effect accessible or unproven: ${key}`,
      );
    }
  });
  test.each(
    IOS_FRAME_PROBES,
  )("silence is vacuous when the %s top-frame control also fails", (key) => {
    for (const control of [undefined, {}, { status: "no-response" }, { status: "error" }]) {
      const value = passingIOS();
      Object.assign(value.ios.top, { [key]: control });
      expect(verdict(value)).toContain(
        `iOS iframe isolation is vacuous: ${key} top-frame control failed`,
      );
    }
    const value = passingIOS();
    value.topBridge = false;
    expect(verdict(value)).toContain(
      `iOS iframe isolation is vacuous: ${key} top-frame control failed`,
    );
  });
  test("also detects hostile replies delivered to the main document, including rejections", () => {
    for (const success of [true, false]) {
      const value = passingIOS();
      value.ios.responses.push({
        callbackId: value.hostile.attempts.webkitBridge.callbackId,
        success,
      });
      expect(verdict(value)).toContain(
        "Hostile frame native effect accessible or unproven: webkitBridge",
      );
    }
  });
  test("requires a fresh hostile callback id and a response history", () => {
    const value = passingIOS();
    Object.assign(value.ios.top.webkitBridge, {
      callbackId: value.hostile.attempts.webkitBridge.callbackId,
    });
    expect(verdict(value)).toContain(
      "Hostile frame native effect accessible or unproven: webkitBridge",
    );
    Object.assign(value.ios, { responses: undefined });
    expect(verdict(value)).toContain("Missing iOS native response history");
  });
  test("cannot accept a malformed native getPending or prompt response as a control", () => {
    for (const patch of [{ data: {} }, { status: "response" }]) {
      const value = passingIOS();
      Object.assign(value.ios.top.webkitBridge, patch);
      expect(verdict(value)).toContain(
        "iOS iframe isolation is vacuous: webkitBridge top-frame control failed",
      );
    }
    const value = passingIOS();
    value.ios.top.prompt.value = "garbage";
    expect(verdict(value)).toContain(
      "iOS iframe isolation is vacuous: prompt top-frame control failed",
    );
  });
});

describe("iOS navigation document evidence", () => {
  const evidence = () => {
    const before = {
      page: "navigation",
      origin: suite,
      href: `${suite}/navigation.html?manual=1`,
      documentId: "original",
      done: false,
      navigation: { attempted: false },
    };
    const after = {
      ...before,
      done: true,
      navigation: { attempted: true, refused: true, target: `${foreign}/foreign.html` },
    };
    return { before, after, reactivated: { ...after } };
  };
  const verdict = (value: unknown) => checkIOSNavigation(value, suite, `${foreign}/foreign.html`);
  test("requires the same navigation document after refusal and foregrounding", () => {
    expect(verdict(evidence())).toEqual([]);
    for (const key of ["after", "reactivated"] as const) {
      const value = evidence();
      value[key].documentId = "reloaded";
      expect(verdict(value)).toContain(`Navigation document did not survive: ${key}`);
    }
  });
  test("rejects missing, pre-completed and foreign-document evidence", () => {
    expect(verdict({}).length).toBeGreaterThan(0);
    const value = evidence();
    value.before.done = true;
    expect(verdict(value)).toContain("Missing pre-navigation document identity");
    value.after.origin = foreign;
    expect(verdict(value)).toContain(
      "Foreign top-frame navigation was allowed or refusal was not proven",
    );
  });
});

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
    for (const status of [undefined, "exposed", "posted", "success", true, "timeout", "error"]) {
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
  test("does not accept arbitrary exceptions as isolation evidence", () => {
    const result = passing();
    result.hostile.attempts = Object.fromEntries(
      FRAME_PROBES.map((key) => [key, { status: "rejected" }]),
    );
    for (const key of FRAME_PROBES) {
      expect(checkFixture(result, suite, foreign)).toContain(
        `Hostile frame native surface accessible or unproven: ${key}`,
      );
    }
  });
  test.each([
    '"SuiteShareIntake" plugin is not implemented on web',
    '"SuiteShareIntake.getPending()" is not implemented on android',
  ])("accepts only the known missing-plugin rejection: %s", (message) => {
    const result = passing();
    Object.assign(result.hostile.attempts, {
      capacitorPlugin: { status: "rejected", code: "UNIMPLEMENTED", message },
    });
    expect(checkFixture(result, suite, foreign)).toEqual([]);
    for (const patch of [
      { code: undefined },
      { code: "UNAVAILABLE" },
      { message: "Blocked" },
      { message: '"OtherPlugin" plugin is not implemented on web' },
    ]) {
      const invalid = structuredClone(result);
      Object.assign(invalid.hostile.attempts, {
        capacitorPlugin: { ...invalid.hostile.attempts.capacitorPlugin, ...patch },
      });
      expect(checkFixture(invalid, suite, foreign)).toContain(
        "Hostile frame native surface accessible or unproven: capacitorPlugin",
      );
    }
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
  test("requires exactly one matching notification in the surviving document", () => {
    expect(checkTextShareDelivery([batch()], [batch()], "shared text", "doc", "doc")).toEqual([]);
    for (const events of [
      [],
      undefined,
      [batch(), batch()],
      [batch("different text")],
      [{ ...batch(), id: "different-id" }],
    ]) {
      expect(
        checkTextShareDelivery([batch()], events, "shared text", "doc", "doc").length,
      ).toBeGreaterThan(0);
    }
  });
  test("allows pending alone only when the document identity changed", () => {
    expect(checkTextShareDelivery([batch()], [], "shared text", "old", "new")).toEqual([]);
    expect(checkTextShareDelivery([batch()], [batch()], "shared text", "old", "new")).toEqual([]);
    for (const [before, after] of [
      [undefined, "new"],
      ["old", undefined],
      ["old", ""],
    ]) {
      expect(checkTextShareDelivery([batch()], [], "shared text", before, after)).toContain(
        "Missing share document identity",
      );
    }
    expect(
      checkTextShareDelivery([batch()], [batch("wrong")], "shared text", "old", "new").length,
    ).toBeGreaterThan(0);
  });
});

describe("share receiver completion", () => {
  afterEach(() => vi.useRealTimers());

  // A bounded version of the driver's polling seam, with the same retry-on-error behavior.
  const poll = async <T>(label: string, probe: () => Promise<T>): Promise<T> => {
    let last: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        return await probe();
      } catch (error) {
        last = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${label}: ${String(last)}`);
  };

  test.each([
    false,
    true,
  ])("waits for a delayed file request before checking rejection (incorrectly accepted: %s)", async (acceptFile) => {
    vi.useFakeTimers();
    const shares = {
      documentId: "doc",
      pending: [] as ReturnType<typeof batch>[],
      events: [] as ReturnType<typeof batch>[],
    };
    let queue = Promise.resolve();
    const sendRejected = vi.fn(async () => {
      queue = queue.then(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (acceptFile) {
          shares.pending.push(batch("rejected sentinel"));
          shares.events.push(batch("rejected sentinel"));
        }
      });
    });
    const sendControl = vi.fn(async () => {
      queue = queue.then(() => {
        const control = { ...batch("fresh control"), id: "control" };
        shares.pending.push(control);
        shares.events.push(control);
      });
    });
    const acknowledge = vi.fn(async () => {
      shares.pending = [];
      shares.events = [];
      return shares;
    });
    const refresh = vi.fn(async () => structuredClone(shares));
    let settled = false;
    const outcome = verifyRejectedShare("fresh control", "doc", {
      sendRejected,
      sendControl,
      refresh,
      acknowledge,
      poll,
    }).then(
      (result) => {
        settled = true;
        return { result, error: undefined };
      },
      (error: Error) => {
        settled = true;
        return { result: undefined, error };
      },
    );
    await vi.advanceTimersByTimeAsync(30);
    expect(sendRejected).toHaveBeenCalledBefore(sendControl);
    expect(refresh).toHaveBeenCalled();
    expect(shares.pending).toEqual([]);
    expect(settled).toBe(false);
    expect(acknowledge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    const result = await outcome;
    if (acceptFile) {
      expect(result.error?.message).toContain("Expected exactly one pending share batch");
      expect(acknowledge).not.toHaveBeenCalled();
    } else {
      expect(result.error).toBeUndefined();
      expect(result.result?.control.pending[0]?.id).toBe("control");
      expect(acknowledge).toHaveBeenCalledWith("control");
      expect(result.result?.cleared.pending).toEqual([]);
    }
  });

  test("fails when notification delivery is disabled in the surviving document", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => ({ documentId: "doc", pending: [batch()], events: [] }));
    const failure = expect(
      waitForTextShare("shared text", "doc", { refresh, poll }),
    ).rejects.toThrow("Expected exactly one matching shareReceived event");
    await vi.advanceTimersByTimeAsync(100);
    await failure;
  });

  test("waits for a delayed notification after pending is already visible", async () => {
    vi.useFakeTimers();
    const shares = {
      documentId: "doc",
      pending: [batch()],
      events: [] as ReturnType<typeof batch>[],
    };
    setTimeout(() => shares.events.push(batch()), 40);
    let settled = false;
    const delivery = waitForTextShare("shared text", "doc", {
      refresh: async () => structuredClone(shares),
      poll,
    }).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(30);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect((await delivery).events).toEqual([batch()]);
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
