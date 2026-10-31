// AUTHORED-BY Codex GPT-6.1-Sol

import { issueApproval, issueMandate, mandateToTurtle } from "@jeswr/agent-mandate";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import {
  buildBitstringStatusListCredential,
  createStatusBitstring,
  issue,
  setStatusBit,
} from "@jeswr/solid-vc";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { type ChildProcess, fork } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { once } from "events";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createServer } from "net";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname, join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runAuditCli } from "../src/cli.js";
import { AT, fixture } from "./fixture.js";

let child: ChildProcess;
let directory: string;
let root: string;
const localIo = createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
beforeAll(async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  root = `http://localhost:${port}/`;
  directory = await mkdtemp(join(tmpdir(), "audit-css-"));
  const css = dirname(fileURLToPath(import.meta.resolve("@solid/community-server/package.json")));
  const config = JSON.parse(await readFile(join(css, "config/file-root.json"), "utf8"));
  config.import = config.import.map((s: string) =>
    s
      .replace("storage/backend/file.json", "storage/backend/memory.json")
      .replace("util/resource-locker/file.json", "util/resource-locker/memory.json"),
  );
  const configPath = join(directory, "memory.json");
  await writeFile(configPath, JSON.stringify(config));
  child = fork(
    fileURLToPath(new URL("./css-process.mjs", import.meta.url)),
    [configPath, String(port)],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  let output = "";
  child.stderr?.on("data", (b) => {
    output += String(b);
  });
  child.stdout?.on("data", (b) => {
    output += String(b);
  });
  await new Promise<void>((resolve, reject) => {
    child.once("message", () => resolve());
    child.once("exit", (code) => reject(new Error(`CSS exited ${code}: ${output}`)));
    child.once("error", reject);
  });
}, 60000);
afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("audits a real in-memory CSS pod anonymously: intact, forged, out-of-scope, revoked and missing PROV", async () => {
  const f = await fixture(root);
  async function upload() {
    for (const [url, resource] of f.pod.resources) {
      const result = await localIo(url, {
        method: "PUT",
        headers: { "Content-Type": resource.contentType },
        body: resource.body,
      });
      expect(result.ok, `PUT fixture resource (${result.status})`).toBe(true);
    }
  }
  async function cli(expected: number, breach?: string) {
    const lines: string[] = [];
    const requests: RequestInit[] = [];
    const code = await runAuditCli([f.proposal], (line) => lines.push(line), {
      fetch: async (input, init) => {
        requests.push(init as RequestInit);
        return localIo(input, init);
      },
    });
    expect(code, lines.join("\n")).toBe(expected);
    if (breach) expect(lines).toContain(`BREACH ${breach}`);
    expect(
      requests.every(
        (init) => init.credentials === "omit" && !new Headers(init.headers).has("authorization"),
      ),
    ).toBe(true);
  }
  await upload();
  await cli(0);
  f.pod.put(
    f.approvalId,
    await issueApproval({ ...f.approval, decision: "deny" }, f.p256, new Date(AT)),
    "application/trig",
  );
  await upload();
  await cli(1, "forged-approval");
  f.pod.put(
    f.approvalId,
    await issueApproval(f.approval, f.p256, new Date(AT)),
    "application/trig",
  );
  const scoped = { ...f.mandate, withApproval: { ...f.mandate.withApproval, permissions: [] } };
  f.pod.put(
    f.mandateId,
    await mandateToTurtle(
      await issueMandate(scoped, f.ed, { statusListCredential: f.statusId, statusListIndex: "1" }),
    ),
    "application/trig",
  );
  await upload();
  await cli(1, "out-of-scope");
  f.pod.put(f.mandateId, await mandateToTurtle(f.vc), "application/trig");
  const bits = createStatusBitstring();
  setStatusBit(bits, 1, true);
  const status = await issue({
    credential: buildBitstringStatusListCredential({
      id: f.statusId,
      issuer: f.owner,
      statusPurpose: "revocation",
      bits,
      validFrom: AT,
      validUntil: "2026-11-26T12:00:00.000Z",
    }),
    key: f.ed,
    options: { created: new Date(AT) },
  });
  f.pod.put(f.statusId, JSON.stringify(status), "application/ld+json");
  await upload();
  await cli(1, "revoked-at-time");
  expect((await localIo(new URL("agent/audit/3.ttl", root), { method: "DELETE" })).ok).toBe(true);
  await cli(1, "missing-prov");
}, 60000);
