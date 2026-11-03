// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { createSolidBackend } from "@jeswr/storage-client/solid";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { type ChildProcess, fork } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { once } from "events";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { createServer } from "net";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { dirname, join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports require bare package names
import { fileURLToPath } from "url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { claim, harness, QUERY } from "./helpers.js";

let child: ChildProcess;
let directory: string;
let root: string;
const io = createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
beforeAll(async () => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  root = `http://localhost:${port}/`;
  directory = await mkdtemp(join(tmpdir(), "agent-memory-css-"));
  const css = dirname(fileURLToPath(import.meta.resolve("@solid/community-server/package.json")));
  const config = JSON.parse(await readFile(join(css, "config/file-root.json"), "utf8"));
  config.import = config.import.map((path: string) =>
    path
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
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
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
it("round-trips pending → signed approval → real SHACL → recall through local CSS", async () => {
  // Disposable anonymous file-root fixture: tests protocol and ETag behavior, not authentication.
  const storage = createSolidBackend({ root, fetch: io });
  await storage.create(root, null, { name: "memory", kind: "container" });
  const container = `${root}memory/`;
  await storage.create(container, null, { name: "pending", kind: "container" });
  const h = await harness({ storage, container });
  const item = await h.memory.proposeRemember(claim);
  expect(await h.memory.recall(QUERY)).toEqual([]);
  expect((await storage.head(item.id)).etag).toMatch(/^"/);
  const approval = await h.sign(item);
  expect(await h.memory.approveRemember(item.id, approval)).toBe(item.target);
  await expect(storage.read(item.id)).rejects.toMatchObject({ code: "not-found" });
  expect((await h.memory.recall(QUERY))[0]?.nanopubs[0]?.epistemic).toBe("SelfReportedExplicit");
  expect(await (await storage.read(item.target)).text()).toBe(item.trig);
}, 30000);
