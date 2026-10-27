// AUTHORED-BY GPT-5.6 Codex
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { checkFixture, checkIOSNavigation, checkRejectedShare } from "./checks.ts";
import { fixturePorts, startFixtureServer } from "./fixture-server.mjs";

const execute = promisify(execFile);
const project = fileURLToPath(new URL("../ios/App/", import.meta.url));
const defaultArtifacts = fileURLToPath(new URL("artifacts/", import.meta.url));
const attachmentNames = ["e2e-result.json", "e2e-navigation.json"];

/** All native commands are bounded, use argument arrays, and keep failure output for CI. */
export async function command(binary, args, timeout = 60000) {
  return execute(binary, args, {
    cwd: project,
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const field = (value) => value?._value;
function visit(value, callback) {
  if (!value || typeof value !== "object") return;
  callback(value);
  for (const child of Object.values(value)) visit(child, callback);
}

/** Xcode 16+ has bulk export; older tools need test-summary refs and payload object export. */
export async function exportAttachments(bundle, output, run = command) {
  try {
    await run("xcrun", [
      "xcresulttool",
      "export",
      "attachments",
      "--path",
      bundle,
      "--output-path",
      output,
    ]);
    return "attachments";
  } catch {
    // Do not mix a partial bulk export with the legacy export or accept duplicate/stale evidence.
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
  }
  async function get(id) {
    const suffix = ["--path", bundle, "--format", "json", ...(id ? ["--id", id] : [])];
    for (const prefix of [["get", "object", "--legacy"], ["get", "--legacy"], ["get"]]) {
      try {
        return JSON.parse((await run("xcrun", ["xcresulttool", ...prefix, ...suffix])).stdout);
      } catch {
        /* Try the preceding generation's CLI spelling. */
      }
    }
    throw new Error("xcresulttool could not read the legacy result objects");
  }
  const queue = [undefined];
  const seen = new Set();
  let count = 0;
  while (queue.length) {
    if (seen.size > 100) throw new Error("Unexpectedly large legacy test result graph");
    const object = await get(queue.shift());
    const payloads = [];
    visit(object, (node) => {
      // Actions -> test plan run summaries -> individual test activity summaries.
      for (const key of ["testsRef", "summaryRef"]) {
        const id = field(node[key]?.id);
        if (typeof id === "string" && !seen.has(id)) {
          seen.add(id);
          queue.push(id);
        }
      }
      const name = field(node.name);
      const id = field(node.payloadRef?.id);
      if (attachmentNames.includes(name) && typeof id === "string") payloads.push({ name, id });
    });
    for (const { name, id } of payloads) {
      const path = join(output, `${count++}-${name}`);
      const suffix = ["--path", bundle, "--id", id, "--type", "file", "--output-path", path];
      let exported = false;
      for (const prefix of [["export", "object", "--legacy"], ["export", "--legacy"], ["export"]]) {
        try {
          await run("xcrun", ["xcresulttool", ...prefix, ...suffix]);
          exported = true;
          break;
        } catch {
          /* Old xcresulttool has no object subcommand or --legacy flag. */
        }
      }
      if (!exported) throw new Error(`Could not export ${name}`);
    }
  }
  return "legacy";
}

/**
 * Xcode exports a named attachment as `<name>`, `<name>_<n>_<uuid>.<ext>`, or (Xcode 26) with the
 * extension first dropped from `<name>`, so `e2e-result.json` may appear as `e2e-result_0_<uuid>.json`.
 */
export function attachmentFor(label) {
  if (typeof label !== "string") return undefined;
  // Only Xcode's own `_<ordinal>_<uuid>[.<ext>]` suffix; e2e-result_debug.json is not evidence.
  const suffix =
    /^(?:_\d+_[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}(?:\.[A-Za-z0-9]+)?)?$/;
  return attachmentNames.find((candidate) =>
    [candidate, candidate.replace(/\.json$/, "")].some(
      (base) => label.startsWith(base) && suffix.test(label.slice(base.length)),
    ),
  );
}

/** Bulk exports use generated filenames; manifest.json maps attachment names to those files. */
export async function readAttachments(directory) {
  const files = new Map();
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(full, await readFile(full, "utf8"));
    }
  }
  await walk(directory);
  const candidates = new Map(attachmentNames.map((name) => [name, new Set()]));
  const labels = [];
  for (const [path, contents] of files) {
    if (path.endsWith("manifest.json")) {
      visit(JSON.parse(contents), (node) => {
        const label = node.suggestedHumanReadableName;
        if (typeof label === "string") labels.push(label);
        const name = attachmentFor(label);
        if (!name) return;
        // Resolve only inside the fresh export directory; no manifest may read arbitrary files.
        const exported = resolve(directory, String(node.exportedFileName));
        if (!files.has(exported)) throw new Error("Attachment manifest references a missing file");
        candidates.get(name).add(exported);
      });
    }
    for (const name of attachmentNames) {
      if (path.endsWith(`/${name}`) || path.endsWith(`-${name}`)) candidates.get(name).add(path);
    }
  }
  return Object.fromEntries(
    attachmentNames.map((name) => {
      const paths = [...candidates.get(name)];
      if (paths.length !== 1) {
        // The CI log is the only diagnostic channel, so say what the export did contain.
        const seen = [...files.keys()].map((path) => relative(directory, path)).sort();
        throw new Error(
          `Expected exactly one ${name} attachment; got ${paths.length}` +
            ` (manifest names: ${labels.slice(0, 20).join(", ") || "none"};` +
            ` files: ${seen.slice(0, 20).join(", ") || "none"})`,
        );
      }
      return [name, JSON.parse(files.get(paths[0]))];
    }),
  );
}

const DIAGNOSTIC =
  /error:|\*\* (BUILD|TEST)|Test Case .* failed|XCTAssert|Failing tests|Testing failed|timed out/i;

/** The CI log cannot rely on downloaded artifacts, so failures print the decisive xcodebuild lines. */
export function xcodebuildDiagnostics(log, tail = 80) {
  const lines = log.split("\n");
  const decisive = [...new Set(lines.filter((line) => DIAGNOSTIC.test(line)))].slice(-60);
  return [
    "--- decisive xcodebuild lines ---",
    ...decisive,
    `--- last ${tail} lines ---`,
    ...lines.slice(-tail),
  ].join("\n");
}

/** Best-effort: e2e-debug attachments are printed on failure and never count as evidence. */
export async function readDebugAttachments(directory, limit = 20000) {
  const root = resolve(directory);
  const paths = new Set();
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "manifest.json") {
        visit(JSON.parse(await readFile(full, "utf8")), (node) => {
          const label = node.suggestedHumanReadableName;
          if (typeof label === "string" && label.startsWith("e2e-debug"))
            paths.add(resolve(root, String(node.exportedFileName)));
        });
      } else if (entry.name.includes("e2e-debug")) paths.add(full);
    }
  }
  await walk(root);
  const texts = [];
  for (const path of paths) {
    // As with evidence, a manifest may only point inside the fresh export directory.
    if (!path.startsWith(`${root}/`)) continue;
    try {
      texts.push((await readFile(path, "utf8")).slice(0, limit));
    } catch {}
  }
  return texts;
}

export async function runIOS({
  destination = process.env.TEST_DESTINATION,
  artifacts = defaultArtifacts,
  run = command,
  startServer = startFixtureServer,
} = {}) {
  const report = {
    startedAt: new Date().toISOString(),
    status: "running",
    destination,
    realSuite: { status: "deferred", blockedBy: "MOB-06", contract: "See e2e/README.md" },
    shareIn: {
      status: "deferred",
      reason: "XCUITest cannot reliably drive another app's share sheet",
    },
    shareListener: {
      status: "deferred",
      reason:
        "Native listener verification needs a real shareReceived event; deferred with share-sheet intake",
    },
  };
  const bundle = join(artifacts, "AppUITests.xcresult");
  const attachments = join(artifacts, "ios-attachments");
  let fixture;
  await mkdir(artifacts, { recursive: true });
  try {
    if (!/^platform=iOS Simulator,id=[A-Fa-f0-9-]{36}$/.test(destination ?? "")) {
      throw new Error("Set TEST_DESTINATION to platform=iOS Simulator,id=<simulator UDID>");
    }
    // xcodebuild requires a new result path. Remove only this driver's known prior outputs.
    await rm(bundle, { recursive: true, force: true });
    await rm(attachments, { recursive: true, force: true });
    const ports = fixturePorts(process.env.E2E_PORT, process.env.E2E_IFRAME_PORT);
    fixture = await startServer(ports);
    report.origins = { suite: fixture.suiteOrigin, foreign: fixture.foreignOrigin };
    let testError;
    try {
      const output = await run(
        "xcodebuild",
        [
          "test",
          "-project",
          "App.xcodeproj",
          "-scheme",
          "App",
          "-configuration",
          "Debug",
          "-sdk",
          "iphonesimulator",
          "-destination",
          destination,
          "-parallel-testing-enabled",
          "NO",
          "-only-testing:AppUITests",
          "-resultBundlePath",
          bundle,
          "CODE_SIGNING_ALLOWED=NO",
        ],
        25 * 60 * 1000,
      );
      await writeFile(join(artifacts, "xcodebuild-ios.log"), `${output.stdout}\n${output.stderr}`);
    } catch (error) {
      testError = error;
      report.xcodebuildError = String(error);
      await writeFile(
        join(artifacts, "xcodebuild-ios.log"),
        `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error}`,
      );
    }
    // Export even on a failed XCTest run so any available fixture evidence is preserved.
    let evidence;
    try {
      report.exportFormat = await exportAttachments(bundle, attachments, run);
      evidence = await readAttachments(attachments);
    } catch (error) {
      report.debug = await readDebugAttachments(attachments);
      // Missing evidence usually follows a failed test run; report that cause, not just its symptom.
      if (testError) throw new Error(`${testError}\nEvidence unavailable: ${error.message}`);
      throw error;
    }
    report.fixture = evidence["e2e-result.json"];
    report.navigation = evidence["e2e-navigation.json"];
    report.failures = [
      ...checkFixture(report.fixture, fixture.suiteOrigin, fixture.foreignOrigin, "ios"),
      ...checkRejectedShare(report.fixture?.shares?.pending, report.fixture?.shares?.events),
      ...checkIOSNavigation(
        report.navigation,
        fixture.suiteOrigin,
        `${fixture.foreignOrigin}/foreign.html`,
      ),
    ];
    if (testError) throw testError;
    if (report.failures.length) throw new Error(report.failures.join("\n"));
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.stack ?? String(error);
  } finally {
    try {
      await fixture?.close();
    } catch (error) {
      report.cleanupError = String(error);
      report.status = "failed";
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(join(artifacts, "report-ios.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runIOS({ destination: process.argv[2] ?? process.env.TEST_DESTINATION });
  console.log(`iOS e2e ${report.status}: ${join(defaultArtifacts, "report-ios.json")}`);
  if (report.status !== "passed") {
    console.error(report.error ?? report.cleanupError);
    for (const text of report.debug ?? []) console.error(`--- e2e-debug attachment ---\n${text}`);
    try {
      console.error(
        xcodebuildDiagnostics(await readFile(join(defaultArtifacts, "xcodebuild-ios.log"), "utf8")),
      );
    } catch {
      console.error("No xcodebuild log was written");
    }
    process.exitCode = 1;
  }
}
