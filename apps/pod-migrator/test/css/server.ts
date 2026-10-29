// AUTHORED-BY Codex GPT-6
import { fork } from "node:child_process";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFetch } from "./auth.js";

export type System = "wac" | "acp";
export const cssDirectory = realpathSync(
  fileURLToPath(new URL("../../node_modules/@solid/community-server/", import.meta.url)),
);

export function memoryConfig(shipped: { import: string[]; [key: string]: unknown }) {
  return {
    ...shipped,
    import: shipped.import.map((entry) =>
      entry
        .replace("storage/backend/file.json", "storage/backend/memory.json")
        .replace("util/resource-locker/file.json", "util/resource-locker/memory.json"),
    ),
  };
}

async function freePort(): Promise<number> {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("No free loopback port");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export interface CssServer {
  system: System;
  base: string;
  stop(): Promise<void>;
}

export async function startServer(system: System): Promise<CssServer> {
  const manifest = JSON.parse(await readFile(join(cssDirectory, "package.json"), "utf8"));
  if (manifest.version !== "7.2.0") throw new Error("This harness requires CSS 7.2.0");
  const shipped = JSON.parse(
    await readFile(
      join(cssDirectory, "config", system === "acp" ? "file-acp.json" : "file.json"),
      "utf8",
    ),
  );
  const port = await freePort();
  const directory = await mkdtemp(join(tmpdir(), `pod-migrator-${system}-`));
  const configPath = join(directory, "config.json");
  try {
    await writeFile(configPath, JSON.stringify(memoryConfig(shipped)));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const base = `http://localhost:${port}/`;
  const child = fork(
    fileURLToPath(new URL("./server-process.mjs", import.meta.url)),
    [configPath, String(port), directory],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: [],
      // CSS 7.2 switches to jest.requireActual("oidc-provider") when NODE_ENV is "test",
      // which Vitest sets; run the server as a normal process.
      env: { ...process.env, NODE_ENV: "production", JEST_WORKER_ID: undefined },
    },
  );
  let output = "";
  const record = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-12_000);
    if (process.env.CSS_DEBUG) process.stderr.write(`[CSS ${system}] ${chunk.toString()}`);
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${system} CSS startup timed out`)), 60_000);
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`${system} CSS exited (${code ?? signal})`));
      });
      child.once("message", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const response = await boundedFetch(`${base}.account/`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok || !(await response.json()).controls)
      throw new Error("Started process does not expose the CSS JSON account API");
    console.log(`[CSS ${system.toUpperCase()}] ready ${base}`);
    return { system, base, stop };
  } catch (error) {
    await stop();
    throw new Error(`${error instanceof Error ? error.message : error}\n${output}`);
  }
}
