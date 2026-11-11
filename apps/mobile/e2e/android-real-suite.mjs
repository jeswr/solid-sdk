// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import { execFile, fork, spawn } from "node:child_process";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseDevtoolsSockets, quoteAndroidShell } from "./checks.ts";
import {
  checkPrivateRead,
  checkShare,
  redactLogcat,
  reportStatus,
  sendIntent,
} from "./real-suite-checks.ts";
import { CLIENT_ID, ORIGIN, PRIVATE_BODY } from "./real-suite-server.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const mobile = join(root, "apps/mobile");
const artifacts = join(mobile, "e2e/artifacts");
const APP = "org.jeswr.suite";
const CHROME = "com.android.chrome";
const MAIN = `${APP}/.MainActivity`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The latest fixed poll label. Labels are source literals, so they are safe to print in CI logs.
let lastWait = "";

async function poll(label, probe, timeout = 30000) {
  lastWait = label;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // Never retain CDP exceptions, browser URLs or subprocess errors: they can hold secrets.
    }
    await delay(300);
  }
  throw new Error(`Timed out: ${label}`);
}

/** Request-only CDP. No console/network event logging or credentials returned to the host. */
class Devtools {
  pending = new Map();
  nextId = 0;
  static async connect(url) {
    const client = new Devtools();
    client.socket = new WebSocket(url);
    client.socket.addEventListener("message", ({ data }) => {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        client.fail();
        return;
      }
      const pending = client.pending.get(message.id);
      if (!pending) return;
      client.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error("CDP command failed"));
      else pending.resolve(message.result);
    });
    client.socket.addEventListener("error", () => client.fail());
    client.socket.addEventListener("close", () => client.fail());
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
    });
    return client;
  }
  fail() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP disconnected"));
    }
    this.pending.clear();
  }
  close() {
    this.fail();
    this.socket.close();
  }
  command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP command timeout"));
      }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 10000,
      userGesture: true,
    });
    if (response.exceptionDetails) throw new Error("Page evaluation failed");
    return response.result.value;
  }
}

async function collectLogcat(serial, secrets = []) {
  await mkdir(artifacts, { recursive: true });
  try {
    const { stdout } = await execute(
      "adb",
      [...(serial ? ["-s", serial] : []), "logcat", "-d", "-v", "threadtime"],
      { timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
    );
    const redacted = redactLogcat(stdout, secrets);
    await writeFile(join(artifacts, "logcat-real-suite.txt"), redacted);
    // Mirror the app/WebView tail into the job log; the artifact store may be unreachable.
    const tail = redacted
      .split("\n")
      .filter((line) => /Capacitor|chromium|Console|AndroidRuntime|org\.jeswr\.suite/.test(line))
      .filter((line) => !line.includes("[redacted sensitive log line]"))
      .slice(-80);
    for (const line of tail) console.log(`MOB-07 logcat: ${line}`);
  } catch {
    await writeFile(join(artifacts, "logcat-real-suite.txt"), "Logcat collection unavailable\n");
  }
}

async function trustedRun(tlsDir) {
  const report = {
    startedAt: new Date().toISOString(),
    status: "running",
    steps: [],
    limitations: [
      "Android emulator only",
      "No long-lived refresh, iOS, physical-device or share-save proof",
    ],
  };
  let server;
  let serial;
  let emulatorVerified = false;
  let app;
  let browser;
  let mediaUri;
  let seed;
  const forwards = [];
  let reversed = false;
  const login = {
    customTab: false,
    passwordSubmitted: false,
    consentSubmitted: false,
    schemeCallback: false,
    signedInAccount: false,
  };
  report.login = login;
  let serverEvidence = {};
  async function adb(args, timeout = 30000) {
    const { stdout, stderr } = await execute("adb", [...(serial ? ["-s", serial] : []), ...args], {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (/^(?:Error:|Failure\s*\[|Exception occurred)/m.test(`${stdout}\n${stderr}`))
      throw new Error("adb operation failed");
    return stdout.trim();
  }
  const shell = (...args) => adb(["shell", args.map(quoteAndroidShell).join(" ")]);
  async function scenario(name, run) {
    const entry = { name, status: "running" };
    report.steps.push(entry);
    console.log(`MOB-07: ${name}`);
    try {
      entry.evidence = await run();
      entry.status = "passed";
    } catch {
      entry.status = "failed";
      // Only fixed labels enter diagnostics. Subprocess/CDP errors can contain passwords/codes.
      entry.error = `Scenario failed or timed out: ${name}`;
      entry.lastWait = lastWait;
      entry.pages = await pageDiagnostics();
      // CI artifacts are not always reachable, so print the same fixed-label summary.
      console.log(
        `MOB-07 diagnostics: ${JSON.stringify({ lastWait, login, serverEvidence, pages: entry.pages })}`,
      );
      throw new Error(entry.error);
    }
  }
  /** Paths, headings and button labels only: no query, fragment, input value or page text. */
  async function pageDiagnostics() {
    const pages = {};
    for (const [name, client] of [
      ["app", app],
      ["browser", browser],
    ]) {
      if (!client) continue;
      try {
        pages[name] = await client.evaluate(`({
          path: location.pathname,
          headings: [...document.querySelectorAll('h1,h2')].map(h => h.textContent.trim().slice(0, 80)).slice(0, 6),
          buttons: [...document.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => b.textContent.trim().slice(0, 40)).slice(0, 12),
          alerts: [...document.querySelectorAll('[role="alert"],.error')].map(a => a.textContent.trim().slice(0, 160)).slice(0, 4),
        })`);
      } catch {
        pages[name] = "unavailable";
      }
    }
    return pages;
  }
  async function connect(port, socket, select) {
    if (!forwards.includes(port)) {
      await adb(["forward", "--no-rebind", `tcp:${port}`, `localabstract:${socket}`]);
      forwards.push(port);
    }
    const page = await poll("DevTools page", async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(3000),
      });
      return (await response.json()).find(select);
    });
    const endpoint = new URL(page.webSocketDebuggerUrl);
    assert(endpoint.protocol === "ws:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname));
    assert.equal(endpoint.port, String(port));
    return Devtools.connect(endpoint.href);
  }
  // Native Home keeps the interim frame. Its greeting requires a ready PodSession.
  const accountVisible = () =>
    app.evaluate(`location.pathname.replace(/\\/$/, '') === '/home' &&
      /^Good (morning|afternoon|evening), Mobile$/.test(document.querySelector('.hm-header h1')?.textContent ?? '')`);
  async function navigate(path) {
    await app.command("Page.navigate", { url: `https://localhost${path}` });
    await poll("suite route", () =>
      app.evaluate(
        `location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete'`,
      ),
    );
  }
  async function clickText(client, text) {
    await poll(`enabled button ${text}`, () =>
      client.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled && b.getClientRects().length);
      if (!b) return false; b.click(); return true;
    })()`),
    );
  }
  const shareObservation = () =>
    app.evaluate(`({ path: location.pathname,
    heading: document.querySelector('h1')?.textContent ?? null,
    sessionReady: !!document.querySelector('[aria-label="Shared items"]') && !document.querySelector('a[href^="/signin"]'),
    items: [...document.querySelectorAll('[aria-label="Shared items"] > li')].map(li => li.querySelector('pre')?.textContent ?? [...li.querySelectorAll('p')].slice(0,2).map(p => p.textContent).join('\\n'))
  })`);
  async function assertShare(expected) {
    return poll("exact share in signed-in screen", async () => {
      const observation = await shareObservation();
      return checkShare(observation, expected).length === 0 && observation;
    });
  }
  async function seedScenario() {
    // Isolate CSS's own logging. Only allowlisted IPC fields reach the report.
    server = fork(fileURLToPath(import.meta.url), ["--server", tlsDir], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    seed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CSS seed timeout")), 120000);
      server.on("message", (message) => {
        if (message.kind === "progress") {
          report.steps.at(-1).phase = message.phase;
          console.log(`MOB-07 CSS: ${message.phase}`);
        }
        if (message.kind === "ready") {
          clearTimeout(timer);
          resolve(message.seed);
        }
        if (message.kind === "evidence") serverEvidence = message.evidence;
        if (message.kind === "failed") {
          clearTimeout(timer);
          reject(new Error("CSS seed failed"));
        }
      });
      server.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("CSS exited"));
      });
    });
    assert([401, 403].includes(seed.anonymousStatus));
    return {
      cssVersion: "7.2.0",
      origin: ORIGIN,
      clientId: CLIENT_ID,
      anonymousStatus: seed.anonymousStatus,
      seedBodyVerified: true,
    };
  }
  async function buildScenario() {
    const snapshots = new Map();
    const files = [
      "ios/App/App/Info.plist",
      "android/capacitor.settings.gradle",
      "android/app/capacitor.build.gradle",
      "android/app/src/debug/res/xml/network_security_config.xml",
      "android/app/src/main/assets/capacitor.config.json",
      "android/app/src/debug/res/raw/mob07_ca.crt",
    ];
    const certPath = join(mobile, "android/app/src/debug/res/raw/mob07_ca.crt");
    for (const file of files)
      snapshots.set(file, await readFile(join(mobile, file)).catch(() => null));
    const env = {
      ...process.env,
      SUITE_MODE: "bundled",
      MOBILE_DEBUG: "1",
      NEXT_PUBLIC_APP_BASE_URL: "https://localhost",
      NEXT_PUBLIC_PUBLIC_SUITE_URL: ORIGIN,
      NEXT_PUBLIC_CLIENT_ID_URL: CLIENT_ID,
      NEXT_PUBLIC_DEV_FIXTURES: "0",
      NEXT_PUBLIC_SUITE_DEMO: "0",
    };
    delete env.SUITE_URL;
    try {
      await execute("pnpm", ["--filter", "@jeswr/app-suite", "build:native"], {
        cwd: root,
        env,
        timeout: 900000,
        maxBuffer: 32 * 1024 * 1024,
      });
      const info = JSON.parse(await readFile(join(root, "apps/suite/www/build-info.json"), "utf8"));
      assert.equal(info.target, "native");
      assert.equal(info.clientIdUrl, CLIENT_ID);
      await execute("pnpm", ["--filter", "@jeswr/app-mobile", "sync:android"], {
        cwd: root,
        env,
        timeout: 120000,
      });
      // Trust this run's certificate only in this debug APK. Restore the overlay after compilation.
      await mkdir(join(mobile, "android/app/src/debug/res/raw"), { recursive: true });
      await cp(join(tlsDir, "localhost.crt"), certPath);
      const network = "android/app/src/debug/res/xml/network_security_config.xml";
      await writeFile(
        join(mobile, network),
        snapshots
          .get(network)
          .toString()
          .replace(
            "</network-security-config>",
            '<!-- AUTHORED-BY Codex GPT-6: ephemeral MOB-07 trust anchor -->\n<debug-overrides><trust-anchors><certificates src="@raw/mob07_ca" /></trust-anchors></debug-overrides>\n</network-security-config>',
          ),
      );
      const config = JSON.parse(
        await readFile(join(mobile, "android/app/src/main/assets/capacitor.config.json"), "utf8"),
      );
      assert(!config.server.url && config.android.webContentsDebuggingEnabled);
      await execute("./gradlew", ["--no-daemon", "--stacktrace", "assembleDebug"], {
        cwd: join(mobile, "android"),
        env,
        timeout: 900000,
        maxBuffer: 32 * 1024 * 1024,
      });
      await cp(
        join(mobile, "android/app/build/outputs/apk/debug/app-debug.apk"),
        join(tlsDir, "real-suite-debug.apk"),
      );
      return {
        target: info.target,
        bundledOrigin: "https://localhost",
        clientId: info.clientIdUrl,
        separateDebugApk: true,
      };
    } finally {
      for (const [file, bytes] of snapshots) {
        if (bytes === null) await rm(join(mobile, file), { force: true });
        else await writeFile(join(mobile, file), bytes);
      }
    }
  }
  async function emulatorScenario() {
    const devices = (await adb(["devices"]))
      .split(/\r?\n/)
      .flatMap((line) => /^(\S+)\s+device$/.exec(line)?.[1] ?? []);
    serial = process.env.ANDROID_SERIAL;
    assert(serial ? devices.includes(serial) : devices.length === 1, "Select one emulator");
    serial ??= devices[0];
    assert.equal(await shell("getprop", "ro.kernel.qemu"), "1");
    assert.equal(await shell("getprop", "sys.boot_completed"), "1");
    emulatorVerified = true;
    await adb(["root"]);
    await adb(["wait-for-device"]);
    assert.equal(
      await shell("id", "-u"),
      "0",
      "Disposable google_apis emulator must permit adb root",
    );
    assert((await shell("pm", "path", CHROME)).includes("package:"), "Chrome is required");
    await shell("am", "force-stop", CHROME);
    assert.equal(await shell("pm", "clear", CHROME), "Success");
    const cert = new X509Certificate(await readFile(join(tlsDir, "localhost.crt")));
    const spki = createHash("sha256")
      .update(cert.publicKey.export({ format: "der", type: "spki" }))
      .digest("base64");
    const flags = `chrome --disable-fre --no-first-run --remote-debugging-port=0 --ignore-certificate-errors-spki-list=${spki}`;
    await shell(
      "sh",
      "-c",
      `printf '%s' ${quoteAndroidShell(flags)} > /data/local/tmp/chrome-command-line`,
    );
    await shell("am", "set-debug-app", "--persistent", CHROME);
    await shell("cmd", "role", "add-role-holder", "android.app.role.BROWSER", CHROME);
    assert(!(await adb(["reverse", "--list"])).includes("tcp:8443"));
    await adb(["reverse", "--no-rebind", "tcp:8443", "tcp:8443"]);
    reversed = true;
    await adb(["install", "-r", join(tlsDir, "real-suite-debug.apk")], 120000);
    assert.equal(await shell("pm", "clear", APP), "Success");
    await shell("am", "start", "-W", "-n", MAIN);
    const socket = await poll("app WebView socket", async () => {
      const pid = await shell("pidof", APP);
      return parseDevtoolsSockets(await shell("cat", "/proc/net/unix"), pid)[0];
    });
    app = await connect(
      9223,
      socket,
      (page) => page.type === "page" && page.url.startsWith("https://localhost/"),
    );
    await navigate("/signin");
    return { serial, bundledPage: true, freshAppData: true, chromeCertificatePinned: true };
  }
  async function loginScenario() {
    await poll("WebID input", () =>
      app.evaluate(`(() => {
      const input = document.querySelector('form[aria-label="Sign in with your WebID"] input');
      if (!input || input.disabled) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(seed.account.webId)});
      input.dispatchEvent(new Event('input', { bubbles: true })); return true;
    })()`),
    );
    await clickText(app, "Continue");
    await poll(
      "real Custom Tab",
      async () => {
        const activities = await shell("dumpsys", "activity", "activities");
        return (
          activities.includes("com.android.chrome") && activities.includes("CustomTabActivity")
        );
      },
      60000,
    );
    browser = await connect(
      9224,
      "chrome_devtools_remote",
      (page) => page.type === "page" && page.url.startsWith(`${ORIGIN}/`),
    );
    login.customTab = true;
    await poll("CSS password form", () =>
      browser.evaluate(
        `!!document.querySelector('#email') && !!document.querySelector('#password')`,
      ),
    );
    // Credentials enter only the system browser's actual CSS form, never the app WebView.
    await browser.evaluate(`(() => {
      for (const [id, value] of ${JSON.stringify([
        ["email", seed.account.email],
        ["password", seed.account.password],
      ])}) {
        const input = document.getElementById(id); input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } return true;
    })()`);
    await clickText(browser, "Log in");
    login.passwordSubmitted = true;
    await clickText(browser, "Authorize");
    login.consentSubmitted = true;
    await poll(
      "scheme callback and signed-in account",
      async () => {
        server.send({ kind: "evidence" });
        return serverEvidence.schemeCallback && (await accountVisible());
      },
      90000,
    );
    login.schemeCallback = true;
    login.signedInAccount = true;
    assert(serverEvidence.clientDocumentReads > 1, "CSS must dereference the client document");
    return { ...login, clientDocumentDereferenced: true };
  }
  async function privateReadScenario() {
    const response = await fetch(seed.resource, { signal: AbortSignal.timeout(15000) });
    await response.arrayBuffer();
    assert([401, 403].includes(response.status));
    // Drive's production preview uses the current PodSession.fetch via client.read().
    await navigate(`/drive/p/${Buffer.from(seed.resource).toString("base64url")}`);
    const body = await poll(
      "authenticated Drive preview body",
      () => app.evaluate("document.querySelector('.drv-preview-text')?.textContent ?? null"),
      60000,
    );
    assert.deepEqual(checkPrivateRead(login, response.status, body, PRIVATE_BODY), []);
    return {
      anonymousStatus: response.status,
      exactBody: true,
      bodyBytes: Buffer.byteLength(body),
      observation: "Drive .drv-preview-text via PodSession.fetch",
    };
  }
  async function textShareScenario() {
    const text = `MOB-07 text ${randomUUID()} 'quoted' & $literal;`;
    await shell(...sendIntent(text));
    const observed = await assertShare(text);
    await clickText(app, "Discard batch");
    await poll("text batch discarded", () =>
      app.evaluate(`!document.querySelector('[aria-label="Shared items"]')`),
    );
    return observed;
  }
  async function fileShareScenario() {
    const name = `mob07-${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.4\nMOB-07 incoming file\n%%EOF\n");
    const inserted = await shell(
      "content",
      "insert",
      "--uri",
      "content://media/external/file",
      "--bind",
      `_display_name:s:${name}`,
      "--bind",
      "mime_type:s:application/pdf",
      "--bind",
      "relative_path:s:Download/",
    );
    mediaUri = inserted.match(/content:\/\/media\/external\/file\/\d+/)?.[0];
    assert(mediaUri, "MediaStore insert must return a URI");
    await new Promise((resolve, reject) => {
      const writer = spawn(
        "adb",
        ["-s", serial, "shell", `content write --uri ${quoteAndroidShell(mediaUri)}`],
        { stdio: ["pipe", "ignore", "ignore"] },
      );
      const timer = setTimeout(() => {
        writer.kill("SIGKILL");
        reject(new Error("MediaStore write timeout"));
      }, 30000);
      writer.on("error", reject);
      writer.on("exit", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error("MediaStore write failed"));
      });
      writer.stdin.on("error", reject);
      writer.stdin.end(bytes);
    });
    const encoded = await shell(
      "sh",
      "-c",
      `content read --uri ${quoteAndroidShell(mediaUri)} | base64 -w 0`,
    );
    assert(Buffer.from(encoded, "base64").equals(bytes), "Source file must be readable and exact");
    await shell(...sendIntent(undefined, mediaUri));
    const observed = await assertShare(`${name}\napplication/pdf · ${bytes.length} bytes`);
    await clickText(app, "Discard batch");
    await poll("file batch discarded", () =>
      app.evaluate(`!document.querySelector('[aria-label="Shared items"]')`),
    );
    return { ...observed, sourceBytesVerified: true };
  }
  try {
    await scenario("Seed private CSS pod and local mobile Client ID Document", seedScenario);
    if (process.argv.includes("--seed-only")) {
      report.status = "seed-only";
      return;
    }
    await scenario("Build separate real-suite bundled debug APK", buildScenario);
    await scenario("Install and launch on disposable emulator", emulatorScenario);
    await scenario("Native sign-in through Custom Tab and scheme callback", loginScenario);
    await scenario("Anonymous denial and exact authenticated Drive read", privateReadScenario);
    await scenario("ACTION_SEND text reaches signed-in share screen", textShareScenario);
    await scenario("ACTION_SEND readable file reaches signed-in share screen", fileShareScenario);
    report.status = reportStatus(report.steps);
  } catch {
    report.status = "failed";
    process.exitCode = 1;
  } finally {
    report.cleanup = { status: "passed" };
    if (emulatorVerified) {
      if (report.status === "failed")
        await collectLogcat(serial, [seed?.account.email ?? "", seed?.account.password ?? ""]);
      for (const client of [app, browser]) client?.close();
      const cleanups = [
        () => shell("am", "force-stop", APP),
        () => shell("am", "force-stop", CHROME),
        () => shell("am", "clear-debug-app"),
        () => shell("rm", "-f", "/data/local/tmp/chrome-command-line"),
        ...forwards.map((port) => () => adb(["forward", "--remove", `tcp:${port}`])),
        ...(reversed ? [() => adb(["reverse", "--remove", "tcp:8443"])] : []),
        ...(mediaUri ? [() => shell("content", "delete", "--uri", mediaUri)] : []),
      ];
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch {
          report.cleanup.status = "failed";
          report.status = "failed";
          process.exitCode = 1;
        }
      }
    }
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(10000)]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    report.finishedAt = new Date().toISOString();
    await mkdir(artifacts, { recursive: true });
    await writeFile(
      join(artifacts, "report-real-suite.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(`MOB-07: ${report.status}`);
  }
}

async function main() {
  if (process.argv.includes("--collect-logcat")) {
    // Preserve the driver's diagnostics, redacted with this run's exact disposable secrets.
    if (await readFile(join(artifacts, "logcat-real-suite.txt")).catch(() => null)) return;
    return collectLogcat(process.env.ANDROID_SERIAL);
  }
  if (process.argv[2] === "--server") {
    const { startRealSuiteServer } = await import("./real-suite-server.mjs");
    try {
      const fixture = await startRealSuiteServer(process.argv[3], (phase) =>
        process.send({ kind: "progress", phase }),
      );
      process.send({
        kind: "ready",
        seed: {
          account: fixture.account,
          resource: fixture.resource,
          anonymousStatus: fixture.anonymousStatus,
        },
      });
      process.on("message", () => process.send({ kind: "evidence", evidence: fixture.evidence() }));
      process.once("SIGTERM", () => {
        void fixture.stop().finally(() => process.exit(0));
      });
    } catch {
      process.send({ kind: "failed" });
      process.exitCode = 1;
      process.disconnect();
    }
    return;
  }
  if (process.argv[2] === "--trusted") return trustedRun(process.argv[3]);
  const tlsDir = await mkdtemp(join(tmpdir(), "mob07-"));
  try {
    await execute(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        join(tlsDir, "localhost.key"),
        "-out",
        join(tlsDir, "localhost.crt"),
      ],
      { timeout: 30000 },
    );
    const child = fork(
      fileURLToPath(import.meta.url),
      ["--trusted", tlsDir, ...process.argv.slice(2)],
      {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: join(tlsDir, "localhost.crt") },
        stdio: "inherit",
      },
    );
    process.exitCode = await new Promise((resolve) => {
      child.once("error", () => resolve(1));
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await rm(tlsDir, { recursive: true, force: true });
  }
}

await main().catch(() => {
  console.error("MOB-07 harness setup failed (sensitive diagnostics suppressed)");
  process.exitCode = 1;
});
