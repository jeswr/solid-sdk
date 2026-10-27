// AUTHORED-BY GPT-5.6 Codex
// biome-ignore-all lint/style/useNamingConvention: xcresulttool's legacy schema uses _value and _values.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CAPABILITIES } from "../e2e/checks.ts";
import {
  attachmentFor,
  exportAttachments,
  readAttachments,
  readDebugAttachments,
  runIOS,
  xcodebuildDiagnostics,
} from "../e2e/ios-e2e.mjs";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ios-e2e-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const output = (stdout = "") => ({ stdout, stderr: "" });
const ref = (value: string) => ({ _value: value });

describe("xcresult attachment export", () => {
  test("uses bulk export and maps generated filenames through the manifest", async () => {
    const run = vi.fn(async () => output());
    expect(await exportAttachments("App.xcresult", directory, run)).toBe("attachments");
    expect(run).toHaveBeenCalledWith("xcrun", [
      "xcresulttool",
      "export",
      "attachments",
      "--path",
      "App.xcresult",
      "--output-path",
      directory,
    ]);
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify([
        {
          attachments: [
            {
              suggestedHumanReadableName: "e2e-result.json_1_UUID.json",
              exportedFileName: "result-uuid.json",
            },
            {
              suggestedHumanReadableName: "e2e-navigation.json",
              exportedFileName: "navigation-uuid.json",
            },
          ],
        },
      ]),
    );
    await writeFile(join(directory, "result-uuid.json"), '{"done":true}');
    await writeFile(join(directory, "navigation-uuid.json"), '{"after":{}}');
    expect(await readAttachments(directory)).toEqual({
      "e2e-result.json": { done: true },
      "e2e-navigation.json": { after: {} },
    });
  });
  test.each([
    "modern-legacy",
    "old-legacy",
    "old",
  ])("walks refs and exports payloads using the %s CLI", async (form) => {
    const run = vi.fn(async (_binary: string, args: string[]) => {
      if (args.includes("attachments")) throw new Error("unknown command");
      if (form !== "modern-legacy" && args.includes("object"))
        throw new Error("unknown subcommand");
      if (form === "old" && args.includes("--legacy")) throw new Error("unknown option");
      if (args.includes("get")) {
        const id = args[args.indexOf("--id") + 1];
        return output(
          JSON.stringify(
            !args.includes("--id")
              ? { actions: { _values: [{ actionResult: { testsRef: { id: ref("tests") } } }] } }
              : id === "tests"
                ? { summaries: { _values: [{ summaryRef: { id: ref("summary") } }] } }
                : {
                    activities: {
                      _values: [
                        {
                          attachments: {
                            _values: [
                              { name: ref("e2e-result.json"), payloadRef: { id: ref("result") } },
                              {
                                name: ref("e2e-navigation.json"),
                                payloadRef: { id: ref("navigation") },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
          ),
        );
      }
      const path = args[args.indexOf("--output-path") + 1];
      if (!path) throw new Error("missing path");
      await writeFile(path, "{}");
      return output();
    });
    expect(await exportAttachments("bundle", directory, run)).toBe("legacy");
    expect(await readAttachments(directory)).toEqual({
      "e2e-result.json": {},
      "e2e-navigation.json": {},
    });
    expect(run.mock.calls.some(([, args]) => args.includes("summary"))).toBe(true);
  });
  test("maps Xcode 26 attachment names with the extension dropped before the ordinal", async () => {
    expect(attachmentFor("e2e-result_0_6F1C9A2B.json")).toBe("e2e-result.json");
    expect(attachmentFor("e2e-navigation_0_6F1C9A2B.json")).toBe("e2e-navigation.json");
    expect(attachmentFor("e2e-result.json")).toBe("e2e-result.json");
    expect(attachmentFor("e2e-result")).toBe("e2e-result.json");
    // A longer name that merely shares the stem, a debug attachment, or a non-string is not evidence.
    expect(attachmentFor("e2e-results_0_X.json")).toBeUndefined();
    expect(attachmentFor("e2e-debug_0_X.txt")).toBeUndefined();
    expect(attachmentFor(undefined)).toBeUndefined();
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify([
        {
          attachments: [
            { suggestedHumanReadableName: "e2e-result_0_A.json", exportedFileName: "A.json" },
            { suggestedHumanReadableName: "e2e-navigation_0_B.json", exportedFileName: "B.json" },
          ],
        },
      ]),
    );
    await writeFile(join(directory, "A.json"), '{"done":true}');
    await writeFile(join(directory, "B.json"), "{}");
    expect(await readAttachments(directory)).toEqual({
      "e2e-result.json": { done: true },
      "e2e-navigation.json": {},
    });
  });
  test("names the manifest labels and files it saw when evidence is missing", async () => {
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify([
        { attachments: [{ suggestedHumanReadableName: "Other", exportedFileName: "C.png" }] },
      ]),
    );
    await writeFile(join(directory, "C.png"), "");
    await expect(readAttachments(directory)).rejects.toThrow(
      "got 0 (manifest names: Other; files: C.png, manifest.json)",
    );
  });
  test("rejects missing, malformed, duplicate and out-of-directory attachment evidence", async () => {
    await expect(readAttachments(directory)).rejects.toThrow("exactly one");
    await writeFile(join(directory, "e2e-result.json"), "bad JSON");
    await expect(readAttachments(directory)).rejects.toThrow();
    await writeFile(join(directory, "e2e-result.json"), "{}");
    await writeFile(join(directory, "1-e2e-result.json"), "{}");
    await expect(readAttachments(directory)).rejects.toThrow("got 2");
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify([
        { suggestedHumanReadableName: "e2e-result.json", exportedFileName: "../outside.json" },
      ]),
    );
    await expect(readAttachments(directory)).rejects.toThrow("missing file");
  });
});

const suite = "http://localhost:4173";
const foreign = "http://localhost:4174";
const fixtureEvidence = () => ({
  page: "index",
  done: true,
  platform: "ios",
  origin: suite,
  topBridge: true,
  listenerSubscriptionRequested: true,
  errors: [],
  capabilities: Object.fromEntries(CAPABILITIES.map((key) => [key, true])),
  shares: { pending: [], events: [] },
  ios: {
    top: {
      webkitBridge: { status: "resolved", callbackId: "top", data: { batches: [] } },
      prompt: { status: "response", value: "false" },
    },
    responses: [],
  },
  hostile: {
    origin: foreign,
    attempts: {
      webkitBridge: { status: "no-response", callbackId: "mob07-hostile-unique", observedMs: 2000 },
      prompt: { status: "no-response", observedMs: 2000, value: null },
    },
  },
});
const navigationEvidence = () => {
  const before = {
    page: "navigation",
    origin: suite,
    href: `${suite}/navigation.html?manual=1`,
    documentId: "unique",
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

describe("iOS host driver verdict and cleanup", () => {
  const destination = "platform=iOS Simulator,id=11111111-1111-1111-1111-111111111111";
  async function scenario({
    xcodeFails = false,
    vacuous = false,
    missing = false,
    cleanupFails = false,
  } = {}) {
    const close = vi.fn(async () => {
      if (cleanupFails) throw new Error("close failed");
      return [];
    });
    const startServer = vi.fn(async () => ({ suiteOrigin: suite, foreignOrigin: foreign, close }));
    const run = vi.fn(async (binary: string, args: string[], timeout?: number) => {
      if (binary === "xcodebuild") {
        expect(timeout).toBe(25 * 60 * 1000);
        expect(args).toContain("-only-testing:AppUITests");
        expect(args).toContain("Debug");
        if (xcodeFails) throw new Error("XCTest failed");
        return output("XCTest passed");
      }
      const path = args[args.indexOf("--output-path") + 1];
      if (!path) throw new Error("missing path");
      await mkdir(path, { recursive: true });
      if (!missing) {
        const evidence = fixtureEvidence();
        if (vacuous) evidence.ios.top.webkitBridge.status = "no-response";
        await writeFile(join(path, "e2e-result.json"), JSON.stringify(evidence));
        await writeFile(join(path, "e2e-navigation.json"), JSON.stringify(navigationEvidence()));
      }
      return output();
    });
    const report = await runIOS({ destination, artifacts: directory, run, startServer });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(join(directory, "report-ios.json"), "utf8"))).toEqual(report);
    return { report, run };
  }
  test("passes only complete fixture and navigation evidence", async () => {
    const { report } = await scenario();
    expect(report.status).toBe("passed");
    expect(report.realSuite.status).toBe("deferred");
    expect(report.shareIn.status).toBe("deferred");
    expect(report.shareListener).toEqual({
      status: "deferred",
      reason: expect.stringContaining("real shareReceived event"),
    });
  });
  test("a successful XCTest exit cannot mask vacuous iframe evidence", async () => {
    const { report } = await scenario({ vacuous: true });
    expect(report.status).toBe("failed");
    expect(report).toHaveProperty("error", expect.stringContaining("vacuous"));
  });
  test("exports diagnostics after XCTest failure and keeps the nonzero verdict", async () => {
    const { report, run } = await scenario({ xcodeFails: true });
    expect(run.mock.calls).toHaveLength(2);
    expect(report.status).toBe("failed");
    expect(report).toHaveProperty("error", expect.stringContaining("XCTest failed"));
  });
  test("reports the XCTest failure, not only the missing evidence it caused", async () => {
    const { report } = await scenario({ xcodeFails: true, missing: true });
    expect(report.status).toBe("failed");
    expect(report).toHaveProperty("error", expect.stringContaining("XCTest failed"));
    expect(report).toHaveProperty("error", expect.stringContaining("Evidence unavailable"));
  });
  test("collects e2e-debug attachments from the manifest or by name, inside the export only", async () => {
    await mkdir(join(directory, "x"), { recursive: true });
    await writeFile(join(directory, "x", "A1.txt"), "hierarchy dump");
    await writeFile(join(directory, "x", "e2e-debug_2.txt"), "second dump");
    await writeFile(
      join(directory, "x", "manifest.json"),
      JSON.stringify([
        {
          attachments: [
            { suggestedHumanReadableName: "e2e-debug.txt", exportedFileName: "x/A1.txt" },
          ],
        },
        {
          attachments: [
            { suggestedHumanReadableName: "e2e-debug.txt", exportedFileName: "../../etc/passwd" },
          ],
        },
      ]),
    );
    const texts = await readDebugAttachments(directory);
    expect(texts.sort()).toEqual(["hierarchy dump", "second dump"]);
    expect(await readDebugAttachments(join(directory, "absent"))).toEqual([]);
  });
  test("prints the decisive xcodebuild lines and the log tail", () => {
    const log = [
      "noise",
      "App.swift:3: error: cannot find type",
      "more noise",
      "** TEST FAILED **",
    ].join("\n");
    const out = xcodebuildDiagnostics(log, 2);
    expect(out).toContain("App.swift:3: error: cannot find type");
    expect(out).toContain("** TEST FAILED **");
    expect(out.split("--- last 2 lines ---")[1]).not.toContain("noise\nApp.swift");
  });
  test("missing attachments and cleanup errors are failures", async () => {
    expect((await scenario({ missing: true })).report.status).toBe("failed");
    const { report } = await scenario({ cleanupFails: true });
    expect(report.status).toBe("failed");
    expect(report).toHaveProperty("cleanupError", expect.stringContaining("close failed"));
  });
  test("rejects a physical or unspecified destination before starting servers or commands", async () => {
    const startServer = vi.fn();
    const run = vi.fn();
    const report = await runIOS({
      destination: "platform=iOS,id=physical",
      artifacts: directory,
      startServer,
      run,
    });
    expect(report.status).toBe("failed");
    expect(startServer).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
