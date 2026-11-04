// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { type ChildProcess, fork } from "child_process";
import { once } from "events";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { createServer } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { PodWorkspace } from "../../src/workspace.js";

/** Same memory CSS + synthetic debug identity as the daemon's existing CSS test. */
export async function startD2Css() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const root = `http://localhost:${port}/`;
  const owner = `${root}profile/card#me`;
  const agent = `${root}profile/agent#me`;
  const directory = await mkdtemp(join(tmpdir(), "awp-d2-"));
  let child: ChildProcess | undefined;
  const close = async () => {
    try {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    const css = dirname(fileURLToPath(import.meta.resolve("@solid/community-server/package.json")));
    const config = JSON.parse(await readFile(join(css, "config/file-root.json"), "utf8"));
    config.import = config.import.map((value: string) =>
      value
        .replace("storage/backend/file.json", "storage/backend/memory.json")
        .replace("util/resource-locker/file.json", "util/resource-locker/memory.json")
        .replace(
          "ldp/authentication/dpop-bearer.json",
          "ldp/authentication/debug-auth-header.json",
        ),
    );
    const configPath = join(directory, "memory.json");
    await writeFile(configPath, JSON.stringify(config));
    child = fork(
      fileURLToPath(new URL("../../test/css-process.mjs", import.meta.url)),
      [configPath, String(port)],
      {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        execArgv: [],
        env: { ...process.env, NODE_ENV: "production" },
      },
    );
    await new Promise<void>((resolve, reject) => {
      const startup = setTimeout(() => reject(new Error("D-2 CSS startup timed out")), 30_000);
      child?.once("message", () => {
        clearTimeout(startup);
        resolve();
      });
      child?.once("exit", () => {
        clearTimeout(startup);
        reject(new Error("D-2 CSS startup failed"));
      });
      child?.once("error", () => {
        clearTimeout(startup);
        reject(new Error("D-2 CSS startup failed"));
      });
    });
    const anonymous = createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
    const io: PodWorkspace["io"] = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `WebID ${owner}`);
      return anonymous(input, { ...init, headers });
    };
    const workspace = new PodWorkspace({
      root,
      ownerWebId: owner,
      io,
      privateTypeIndex: `${root}settings/privateTypeIndex.ttl`,
    });
    return { root, owner, agent, workspace, io, anonymous, close };
  } catch (error) {
    await close();
    throw error;
  }
}
