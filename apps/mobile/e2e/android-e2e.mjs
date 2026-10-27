// AUTHORED-BY GPT-5.6 Codex
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  checkFixture,
  checkNavigation,
  checkRejectedShare,
  parseDevtoolsSockets,
  quoteAndroidShell,
} from "./checks.ts";
import { fixturePorts, startFixtureServer } from "./fixture-server.mjs";
import { verifyRejectedShare, waitForTextShare } from "./share-probes.ts";

const execute = promisify(execFile);
const APP = "org.jeswr.suite";
const MAIN = `${APP}/.MainActivity`;
const RECEIVER = `${APP}/.ShareReceiverActivity`;
const APK = fileURLToPath(
  new URL("../android/app/build/outputs/apk/debug/app-debug.apk", import.meta.url),
);
const artifacts = new URL("artifacts/", import.meta.url);
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  steps: [],
  realSuite: {
    status: "deferred",
    blockedBy: "MOB-06",
    contract: "See e2e/README.md: real-suite follow-up",
  },
};
let fixture;
let cdp;
let serial;
// Diagnostics and cleanup touch a device only once it is proven to be a booted emulator.
let emulatorVerified = false;
let forwardCreated = false;
const reversed = [];

async function adb(args, timeout = 30000) {
  const prefix = serial ? ["-s", serial] : [];
  const { stdout, stderr } = await execute("adb", [...prefix, ...args], {
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (/^(?:Error:|Failure\s*\[|Exception occurred)/m.test(`${stdout}\n${stderr}`)) {
    throw new Error(`adb ${args[0]} failed: ${stdout}\n${stderr}`);
  }
  return stdout.trim();
}
const shell = (...args) => adb(["shell", args.map(quoteAndroidShell).join(" ")]);
const sendShare = (text, stream) =>
  shell(
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.SEND",
    "-t",
    "text/plain",
    ...(stream ? ["--eu", "android.intent.extra.STREAM", stream] : []),
    "--es",
    "android.intent.extra.TEXT",
    text,
    "-n",
    RECEIVER,
  );
const refreshShares = () =>
  cdp.evaluate(
    "window.__e2eRefreshShares().then(shares => ({ ...shares, documentId: window.__e2e.documentId }))",
  );
const acknowledgeShare = (batchId) =>
  cdp.evaluate(
    `window.__e2eAcknowledge(${JSON.stringify(batchId)}).then(shares => ({ ...shares, documentId: window.__e2e.documentId }))`,
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function poll(label, probe, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ""}`);
}
function assertChecks(failures) {
  if (failures.length) throw new Error(failures.join("\n"));
}
async function step(name, run) {
  const entry = { name, status: "running" };
  report.steps.push(entry);
  console.log(`e2e: ${name}`);
  try {
    await run();
    entry.status = "passed";
  } catch (error) {
    entry.status = "failed";
    entry.error = error.message;
    throw error;
  }
}

/** Minimal request/response CDP client: events never satisfy commands, all requests are bounded. */
class Devtools {
  pending = new Map();
  nextId = 0;

  static async connect(url) {
    const client = new Devtools();
    client.socket = new WebSocket(url);
    client.socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        client.fail(new Error("Invalid CDP JSON"));
        return;
      }
      const request = client.pending.get(message.id);
      if (!request) return;
      client.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`CDP: ${JSON.stringify(message.error)}`));
      else request.resolve(message.result);
    });
    client.socket.addEventListener("close", () => client.fail(new Error("CDP connection closed")));
    client.socket.addEventListener("error", () => client.fail(new Error("CDP WebSocket error")));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.close();
        reject(new Error("CDP connection timeout"));
      }, 10000);
      client.socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      client.socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("CDP connection failed"));
        },
        { once: true },
      );
      client.socket.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          reject(new Error("CDP closed before opening"));
        },
        { once: true },
      );
    });
    return client;
  }
  fail(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.fail(new Error("CDP client closed"));
    this.socket.close();
  }
  command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async evaluate(expression) {
    const response = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 10000,
    });
    if (response.exceptionDetails)
      throw new Error(`Page script failed: ${JSON.stringify(response.exceptionDetails)}`);
    return response.result.value;
  }
}

async function run() {
  const { port, iframePort } = fixturePorts(process.env.E2E_PORT, process.env.E2E_IFRAME_PORT);
  await step("Start loopback fixtures and select a booted emulator", async () => {
    fixture = await startFixtureServer({ port, iframePort });
    const devices = (await adb(["devices"])).split(/\r?\n/).flatMap((line) => {
      const match = /^(\S+)\s+device$/.exec(line.trim());
      return match ? [match[1]] : [];
    });
    serial = process.env.ANDROID_SERIAL;
    if (serial ? !devices.includes(serial) : devices.length !== 1) {
      throw new Error(
        "Set ANDROID_SERIAL to one connected emulator, or connect exactly one emulator",
      );
    }
    serial ??= devices[0];
    if (
      (await shell("getprop", "ro.kernel.qemu")) !== "1" ||
      (await shell("getprop", "sys.boot_completed")) !== "1"
    ) {
      throw new Error("This harness requires a booted Android emulator");
    }
    emulatorVerified = true;
    report.serial = serial;
    report.origins = { suite: fixture.suiteOrigin, foreign: fixture.foreignOrigin };
  });
  await step("Install debug APK, reset fixture data, reverse ports and launch", async () => {
    await adb(["install", "-r", "-t", APK], 120000);
    // This harness owns the emulator app data. No persisted share can make a check pass.
    if ((await shell("pm", "clear", APP)) !== "Success")
      throw new Error("Cannot clear fixture app data");
    for (const value of [port, iframePort]) {
      await adb(["reverse", "--no-rebind", `tcp:${value}`, `tcp:${value}`]);
      reversed.push(value);
    }
    await shell("am", "start", "-W", "-n", MAIN);
  });
  await step("Attach to the app WebView over CDP", async () => {
    const socket = await poll("app WebView DevTools socket", async () => {
      const pid = await shell("pidof", APP);
      return parseDevtoolsSockets(await shell("cat", "/proc/net/unix"), pid)[0];
    });
    await adb(["forward", "--no-rebind", "tcp:9222", `localabstract:${socket}`]);
    forwardCreated = true;
    const page = await poll("suite WebView CDP target", async () => {
      const response = await fetch("http://127.0.0.1:9222/json/list", {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`DevTools HTTP ${response.status}`);
      const pages = await response.json();
      return pages.find(
        (target) =>
          target.type === "page" &&
          target.url === `${fixture.suiteOrigin}/` &&
          typeof target.webSocketDebuggerUrl === "string",
      );
    });
    const endpoint = new URL(page.webSocketDebuggerUrl);
    if (
      endpoint.protocol !== "ws:" ||
      !["localhost", "127.0.0.1"].includes(endpoint.hostname) ||
      endpoint.port !== "9222"
    ) {
      throw new Error("DevTools returned an unexpected WebSocket endpoint");
    }
    cdp = await Devtools.connect(endpoint.href);
    await cdp.command("Runtime.enable");
  });
  await step("Secure-context APIs, top-frame bridge and hostile iframe isolation", async () => {
    report.fixture = await poll("window.__e2e.done", () =>
      cdp.evaluate("window.__e2e?.done ? window.__e2e : null"),
    );
    assertChecks(checkFixture(report.fixture, fixture.suiteOrigin, fixture.foreignOrigin));
    assertChecks(checkRejectedShare(report.fixture.shares?.pending, report.fixture.shares?.events));
  });
  await step("ACTION_SEND delivers exactly the text through SuiteShareIntake", async () => {
    const text = `MOB-07 text ${randomUUID()} spaces 'quotes' "double" $dollar ; & literal`;
    report.text = text;
    const documentId = await cdp.evaluate("window.__e2e.documentId");
    await sendShare(text);
    const shares = await waitForTextShare(text, documentId, { refresh: refreshShares, poll });
    report.textShare = shares;
    // getPending alone suffices only when the document token proves a WebView reload.
    const cleared = await acknowledgeShare(shares.pending[0].id);
    assertChecks(checkRejectedShare(cleared.pending, cleared.events));
  });
  await step("Reject a readable file:// EXTRA_STREAM and its text sentinel", async () => {
    await shell("run-as", APP, "mkdir", "-p", "files");
    await shell("run-as", APP, "cp", "/system/etc/hosts", "files/mob07-forbidden.txt");
    await shell("run-as", APP, "sh", "-c", "test -s files/mob07-forbidden.txt");
    const uri = `file:///data/data/${APP}/files/mob07-forbidden.txt`;
    const rejectedText = `MOB07 rejected ${randomUUID()}`;
    const controlText = `MOB07 control ${randomUUID()}`;
    const documentId = await cdp.evaluate("window.__e2e.documentId");
    const result = await verifyRejectedShare(controlText, documentId, {
      sendRejected: () => sendShare(rejectedText, uri),
      sendControl: () => sendShare(controlText),
      refresh: refreshShares,
      acknowledge: acknowledgeShare,
      poll,
    });
    report.rejectionControl = { rejectedText, controlText, shares: result.control };
    report.rejectedShare = result.cleared;
  });
  await step("Foreign top-frame navigation stays on the suite origin", async () => {
    await cdp.evaluate("location.assign('/navigation.html'); true");
    report.navigation = await poll("navigation refusal evidence", () =>
      cdp.evaluate("window.__e2e?.done && window.__e2e.page !== 'index' ? window.__e2e : null"),
    );
    assertChecks(
      checkNavigation(
        report.navigation,
        fixture.suiteOrigin,
        `${fixture.foreignOrigin}/foreign.html`,
      ),
    );
    await shell("am", "start", "-W", "-n", MAIN);
    const current = await cdp.evaluate("({ href: location.href, result: window.__e2e })");
    report.finalPage = current;
    if (current.href !== `${fixture.suiteOrigin}/navigation.html`)
      throw new Error("WebView did not remain on the navigation fixture");
    assertChecks(
      checkNavigation(current.result, fixture.suiteOrigin, `${fixture.foreignOrigin}/foreign.html`),
    );
  });
}

// Real-suite follow-up seam: after this driver exits and cleans up, a separate CI step can
// sync/build/install the MOB-06 suite origin and run its sign-in/private-read scenario.
// Keep that scenario's result separate from report.realSuite's explicit fixture deferral.
await mkdir(artifacts, { recursive: true });
try {
  await run();
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack ?? String(error);
  console.error(`Android e2e failed: ${report.error}`);
  if (cdp) {
    try {
      report.lastPage = await cdp.evaluate("({ href: location.href, result: window.__e2e })");
    } catch (snapshotError) {
      report.snapshotError = String(snapshotError);
    }
  }
  if (emulatorVerified) {
    try {
      await writeFile(
        new URL("logcat.txt", artifacts),
        await adb(["logcat", "-d", "-v", "threadtime"]),
      );
    } catch (logError) {
      report.logcatError = String(logError);
    }
  }
  process.exitCode = 1;
} finally {
  cdp?.close();
  const cleanupErrors = [];
  for (const cleanup of [
    () => emulatorVerified && shell("am", "force-stop", APP),
    () => forwardCreated && adb(["forward", "--remove", "tcp:9222"]),
    ...reversed.map((port) => () => adb(["reverse", "--remove", `tcp:${port}`])),
    () => fixture?.close(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  if (cleanupErrors.length) {
    report.cleanupErrors = cleanupErrors;
    report.status = "failed";
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL("report.json", artifacts), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Android e2e ${report.status}: ${fileURLToPath(new URL("report.json", artifacts))}`);
}
