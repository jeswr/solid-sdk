// AUTHORED-BY GPT-5.6 Codex
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CAPABILITIES,
  checkFixture,
  checkGatedUnwrap,
  checkIOSNavigation,
  checkNavigation,
  checkRejectedShare,
  checkSecureStoreFiles,
  checkSecureStoreFixture,
  checkTextShare,
  checkTextShareDelivery,
  FRAME_PROBES,
  IOS_FRAME_PROBES,
  parseDevtoolsSockets,
  quoteAndroidShell,
  SECURE_STORE_PROBES,
} from "../e2e/checks.ts";
import {
  attemptGatedUnwrap,
  enrollFingerprint,
  fingerprintEnrolled,
  uiTarget,
} from "../e2e/secure-store-probes.ts";
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

describe("secure-store evidence", () => {
  const evidence = () => {
    const marker = "p4-e2e-plaintext-marker-unique";
    return {
      secureStore: {
        marker,
        status: { available: true, userPresence: false, hardwareBacked: false },
        initial: { value: null, version: 0 },
        created: { version: 1 },
        read: { value: marker, version: 1 },
        staleCode: "stale",
        updated: { version: 2 },
        updatedRead: { value: `${marker}-updated`, version: 2 },
        removed: { value: null, version: 3 },
        beforeClear: [
          { value: marker, version: 4 },
          { value: marker, version: 1 },
        ],
        afterClear: [
          { value: null, version: 5 },
          { value: null, version: 5 },
        ],
        retainedSet: { version: 6 },
        retained: { value: marker, version: 6 },
      },
      hostile: {
        secureStore: Object.fromEntries(
          SECURE_STORE_PROBES.map((key) => [
            key,
            {
              callbackId: `p4-hostile-nonce-${key}`,
              status: "no-response",
              transport: false,
              observedMs: 2000,
            },
          ]),
        ),
      },
      secureStoreResponses: [],
    };
  };
  test("accepts actual round trips, stale rejection, tombstones, two-key clear and a live marker", () => {
    expect(checkSecureStoreFixture(evidence())).toEqual([]);
    for (const value of [undefined, null, [], {}, { secureStore: null }])
      expect(checkSecureStoreFixture(value).length).toBeGreaterThan(0);
  });
  test("rejects every missing or malformed native result", () => {
    for (const key of Object.keys(evidence().secureStore)) {
      for (const replacement of [undefined, {}, [], "bad", null]) {
        const value = evidence();
        Object.assign(value.secureStore, { [key]: replacement });
        expect(checkSecureStoreFixture(value).length, key).toBeGreaterThan(0);
      }
    }
    for (const patch of [
      { status: { available: false, userPresence: true, hardwareBacked: true } },
      { status: { available: true, userPresence: "false", hardwareBacked: false } },
      { status: { available: true, userPresence: false, hardwareBacked: "true" } },
      { initial: { value: "old", version: 0 } },
      { created: { version: 0 } },
      { created: { version: -1 } },
      { read: { value: "wrong", version: 1 } },
      { read: { value: evidence().secureStore.marker, version: 2 } },
      { read: { value: evidence().secureStore.marker, version: Number.NaN } },
      { staleCode: "failed" },
      { updated: { version: 1 } },
      { updatedRead: { value: "wrong", version: 2 } },
      { removed: { value: "retained", version: 3 } },
      { removed: { value: null, version: 2 } },
      { beforeClear: [] },
      {
        beforeClear: [
          { value: null, version: 4 },
          { value: "bad", version: 1 },
        ],
      },
      {
        afterClear: [
          { value: null, version: 4 },
          { value: null, version: 5 },
        ],
      },
      {
        afterClear: [
          { value: null, version: 5 },
          { value: "bad", version: 5 },
        ],
      },
      { retained: { value: null, version: 6 } },
      { retainedSet: { version: 1.5 } },
    ])
      expect(
        checkSecureStoreFixture({
          ...evidence(),
          secureStore: { ...evidence().secureStore, ...patch },
        }).length,
      ).toBeGreaterThan(0);
  });
  test.each(
    SECURE_STORE_PROBES,
  )("requires a full silent window and absent transport for %s", (key) => {
    for (const patch of [
      undefined,
      {},
      { status: "response" },
      { status: "error" },
      { transport: true },
      { observedMs: 1999 },
      { observedMs: Infinity },
      { observedMs: "2000" },
      { callbackId: "other" },
      { callbackId: "p4-hostile-nonce-androidBridge.get" },
    ]) {
      const value = evidence();
      Object.assign(value.hostile.secureStore, {
        [key]: patch === undefined ? undefined : { ...value.hostile.secureStore[key], ...patch },
      });
      if (
        key === "androidBridge.get" &&
        typeof patch === "object" &&
        patch?.callbackId === "p4-hostile-nonce-androidBridge.get"
      )
        continue;
      if (patch && Object.keys(patch).length === 0) continue;
      expect(checkSecureStoreFixture(value).length).toBeGreaterThan(0);
    }
    expect(
      checkSecureStoreFixture({ ...evidence(), secureStoreResponses: ["native error reply"] }),
    ).toContain("Hostile secure-store native reply reached the top frame or history missing");
    expect(
      checkSecureStoreFixture({ ...evidence(), secureStoreResponses: undefined }).length,
    ).toBeGreaterThan(0);
  });
  test("requires non-empty binary state and searches UTF-8 and UTF-16LE at unaligned offsets", () => {
    const marker = evidence().secureStore.marker;
    const path = `no_backup/securestore/${"a".repeat(64)}.bin`;
    const file = (bytes: Buffer) => ({ path, base64: bytes.toString("base64") });
    expect(checkSecureStoreFiles([file(Buffer.from([0, 255, 12, 33]))], marker)).toEqual([]);
    expect(
      checkSecureStoreFiles(
        [{ ...file(Buffer.from("ciphertext")), base64: "Y2lw\naGVydGV4dA==\n" }],
        marker,
      ),
    ).toEqual([]);
    for (const encoding of ["utf8", "utf16le"] as const) {
      const bytes = Buffer.concat([
        Buffer.from([255]),
        Buffer.from(marker, encoding),
        Buffer.from([0]),
      ]);
      expect(checkSecureStoreFiles([file(bytes)], marker).join()).toContain(`(${encoding})`);
    }
    for (const files of [
      [],
      [file(Buffer.alloc(0))],
      [{ path, base64: "garbage!" }],
      [{ path: "other.bin", base64: "YWJj" }],
    ])
      expect(checkSecureStoreFiles(files, marker).length).toBeGreaterThan(0);
    expect(checkSecureStoreFiles([file(Buffer.from("abc"))], "").length).toBeGreaterThan(0);
    expect(
      checkSecureStoreFiles(
        [
          file(Buffer.from("abc")),
          {
            path: "no_backup/securestore/leftover.tmp",
            base64: Buffer.from(marker).toString("base64"),
          },
        ],
        marker,
      ).length,
    ).toBeGreaterThan(0);
  });
  test("only explicit runner limitations skip; passes require prompt, input, value and version", () => {
    const value = "p4-e2e-gated-unique";
    const verdict = {
      status: "passed",
      promptObserved: true,
      authenticationSent: true,
      evidence: { stage: "done", value, committed: { version: 1 }, read: { value, version: 1 } },
    };
    expect(checkGatedUnwrap(verdict)).toEqual([]);
    expect(
      checkGatedUnwrap({ status: "not automatable", reason: "fingerprint enrollment unavailable" }),
    ).toEqual([]);
    for (const invalid of [
      null,
      {},
      { status: "failed", reason: "crypto failure" },
      { status: "not automatable" },
      { status: "not automatable", reason: " " },
      { ...verdict, promptObserved: false },
      { ...verdict, authenticationSent: false },
      { ...verdict, evidence: null },
      { ...verdict, evidence: { ...verdict.evidence, stage: "waiting" } },
      { ...verdict, evidence: { ...verdict.evidence, read: { value: "wrong", version: 1 } } },
      { ...verdict, evidence: { ...verdict.evidence, committed: { version: -1 } } },
    ])
      expect(checkGatedUnwrap(invalid).length).toBeGreaterThan(0);
  });
});

describe("Android gated prompt automation", () => {
  const pinUI =
    '<node package="com.android.systemui" class="android.widget.EditText" resource-id="com.android.systemui:id/pinEntry" bounds="[0,0][100,100]" />';
  const fingerprintUI = '<node text="Unlock Solid Suite" bounds="[0,0][100,100]" />';
  const completed = () => ({
    stage: "done",
    value: "p4-e2e-gated-value",
    committed: { version: 7 },
    read: { value: "p4-e2e-gated-value", version: 7 },
  });
  const driver = () => {
    const io = {
      shell: vi.fn(async (..._args: string[]) => ""),
      finger: vi.fn(async () => {}),
      ui: vi.fn(async () => fingerprintUI),
      evaluate: vi.fn(async (_expression: string): Promise<unknown> => ({ stage: "waiting" })),
      pause: vi.fn(async () => {}),
    };
    return io;
  };
  test("requires concrete enabled system controls and confirmed fingerprint counts", () => {
    expect(uiTarget(pinUI, /pinEntry/)).toEqual(["50", "50"]);
    for (const xml of [
      "",
      pinUI.replace("[100,100]", "[0,0]"),
      pinUI.replace("bounds=", 'enabled="false" bounds='),
      pinUI.replace("[0,0][100,100]", "bad"),
    ])
      expect(uiTarget(xml, /pinEntry/)).toBeUndefined();
    expect(uiTarget(pinUI, /other/)).toBeUndefined();
    expect(fingerprintEnrolled('{"prints":[{"id":0,"count":1}]}')).toBe(true);
    expect(fingerprintEnrolled("User: 0, biometrics: 1, authenticatorId: 123")).toBe(true);
    for (const dump of [
      "",
      '{"prints":[{"id":0,"count":0}]}',
      '{"prints":[{"id":10,"count":1}]}',
      "count: 1",
      "User: 0, biometrics: 0",
    ])
      expect(fingerprintEnrolled(dump)).toBe(false);
  });
  test("enrollment checks dumpsys, enters PIN, advances setup and sends repeated sensor touches", async () => {
    const io = driver();
    let count = 0;
    io.shell.mockImplementation(async (...args) =>
      args[0] === "dumpsys" && ++count >= 5 ? '{"prints":[{"id":0,"count":1}]}' : "",
    );
    io.ui
      .mockResolvedValueOnce(pinUI)
      .mockResolvedValueOnce('<node text="Continue" bounds="[0,0][10,10]" />')
      .mockResolvedValue("");
    expect(await enrollFingerprint(io)).toBe("enrolled");
    expect(io.shell).toHaveBeenCalledWith(
      "am",
      "start",
      "-W",
      "-a",
      "android.settings.FINGERPRINT_ENROLL",
    );
    expect(io.shell).toHaveBeenCalledWith("input", "text", "1234");
    expect(io.shell).toHaveBeenCalledWith("input", "keyevent", "66");
    expect(io.finger).toHaveBeenCalledTimes(2);
    const already = driver();
    already.shell.mockResolvedValue("User: 0, biometrics: 1");
    expect(await enrollFingerprint(already)).toBe("enrolled");
    expect(already.ui).not.toHaveBeenCalled();
  });
  test("unconfirmed enrollment and command failures are explicit runner limitations", async () => {
    const io = driver();
    expect(await enrollFingerprint(io)).toContain(
      "not automatable on this runner: fingerprint enrollment could not be confirmed",
    );
    io.shell.mockRejectedValue(new Error("no activity"));
    expect(await enrollFingerprint(io)).toContain("no activity");
  });
  test.each([
    "fingerprint",
    "credential",
  ] as const)("%s passes only after the corresponding real authentication input", async (path) => {
    const io = driver();
    io.ui.mockResolvedValue(path === "fingerprint" ? fingerprintUI : pinUI);
    io.evaluate.mockImplementation(async () =>
      io.finger.mock.calls.length ||
      io.shell.mock.calls.some((args) => args.join(" ") === "input keyevent 66")
        ? completed()
        : { stage: "waiting" },
    );
    const verdict = await attemptGatedUnwrap(path, io);
    expect(verdict.status).toBe("passed");
    expect(checkGatedUnwrap(verdict)).toEqual([]);
    expect(io.evaluate).toHaveBeenCalledWith(`window.__e2eSecureStore.startGated("${path}")`);
    if (path === "fingerprint") expect(io.finger).toHaveBeenCalledOnce();
    else expect(io.shell).toHaveBeenCalledWith("input", "text", "1234");
  });
  test("credential path selects Use PIN before entering the credential", async () => {
    const io = driver();
    io.ui
      .mockResolvedValueOnce('<node text="Use PIN" bounds="[10,10][30,30]" />')
      .mockResolvedValue(pinUI);
    io.evaluate.mockImplementation(async () =>
      io.shell.mock.calls.length >= 4 ? completed() : { stage: "waiting" },
    );
    expect((await attemptGatedUnwrap("credential", io)).status).toBe("passed");
    expect(io.shell).toHaveBeenCalledWith("input", "tap", "20", "20");
  });
  test("native preparation errors, early unwraps and wrong decrypted values fail", async () => {
    for (const early of [{ stage: "error", code: "failed" }, completed(), { stage: "preparing" }]) {
      const io = driver();
      io.evaluate.mockResolvedValue(early);
      expect((await attemptGatedUnwrap("fingerprint", io)).status).toBe("failed");
    }
    for (const outcome of [
      { stage: "error", code: "failed" },
      { ...completed(), read: { value: "wrong", version: 7 } },
    ]) {
      const io = driver();
      io.evaluate.mockImplementation(async () =>
        io.finger.mock.calls.length ? outcome : { stage: "waiting" },
      );
      expect((await attemptGatedUnwrap("fingerprint", io)).status).toBe("failed");
    }
    const io = driver();
    io.evaluate
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ stage: "waiting" })
      .mockResolvedValue(completed());
    expect((await attemptGatedUnwrap("fingerprint", io)).status).toBe("failed");
  });
  test("unknown prompt, failed automation and uncompleted system input stay manual", async () => {
    const io = driver();
    io.ui.mockResolvedValue("");
    expect(await attemptGatedUnwrap("credential", io)).toMatchObject({
      status: "not automatable",
      authenticationSent: false,
    });
    io.ui.mockRejectedValueOnce(new Error("uiautomator unavailable"));
    expect((await attemptGatedUnwrap("fingerprint", io)).reason).toContain(
      "uiautomator unavailable",
    );
    io.ui.mockResolvedValue(fingerprintUI);
    expect(await attemptGatedUnwrap("fingerprint", io)).toMatchObject({
      status: "not automatable",
      authenticationSent: true,
    });
  });
});
