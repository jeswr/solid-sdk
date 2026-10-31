// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent module specifiers exclude node: schemes
import { spawn } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent module specifiers exclude node: schemes
import { once } from "events";
// biome-ignore lint/style/useNodejsImportProtocol: agent module specifiers exclude node: schemes
import * as fs from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent module specifiers exclude node: schemes
import { tmpdir } from "os";
import { afterEach, expect, it } from "vitest";
import type { ExecutorFileSystem } from "../src/files.js";
import { createExecutor, createFileTransmissionStore, createHaltFileCheck } from "../src/index.js";
import { createMemoryStores } from "../src/testing.js";
import { harness } from "./helpers.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((path) => fs.rm(path, { recursive: true, force: true })));
  directories.length = 0;
});
async function fixture(io: ExecutorFileSystem = fs) {
  const directory = await fs.mkdtemp(`${tmpdir()}/sst-0al-`);
  directories.push(directory);
  const store = await createFileTransmissionStore({
    io,
    directory,
    exclusive: createMemoryStores().transmissions.exclusive,
  });
  return { directory, store };
}
it("atomic local store fsyncs before the effect and survives a fresh instance", async () => {
  const order: string[] = [];
  const io: ExecutorFileSystem = {
    ...fs,
    open: async (...args) => {
      if (args[1] === "wx") expect(args[0]).toMatch(/\/[a-f0-9]{64}\.tmp$/);
      const file = await fs.open(...args);
      return {
        writeFile: async (data, encoding) => {
          order.push("write");
          await file.writeFile(data, encoding);
        },
        sync: async () => {
          order.push(args[1] === "r" ? "fsync-directory" : "fsync-file");
          await file.sync();
        },
        close: async () => {
          await file.close();
        },
      };
    },
    rename: async (...args) => {
      order.push("rename");
      await fs.rename(...args);
    },
  };
  const { directory, store } = await fixture(io);
  const h = harness();
  const e = await h.enqueue();
  const record = h.prior(e, "attempting");
  expect(await store.list()).toEqual([]);
  expect(await store.get(record.proposal)).toBeUndefined();
  await store.exclusive(() => store.put(record));
  expect(order).toEqual(["write", "fsync-file", "rename", "fsync-directory"]);
  const restarted = await createFileTransmissionStore({
    io: fs,
    directory,
    exclusive: store.exclusive,
  });
  expect(await restarted.get(record.proposal)).toEqual(record);
  await restarted.exclusive(() => restarted.put({ ...record, status: "sent" }));
  expect((await restarted.list()).map((r) => r.status)).toEqual(["sent"]);
  expect((await fs.stat(`${directory}/transmissions.json`)).mode & 0o777).toBe(0o600);
});
it("actual process death between durable attempting and transmit stays uncertain on restart", async () => {
  const { directory, store } = await fixture();
  const h = harness();
  const e = await h.enqueue();
  const modulePath = new URL("../dist/index.js", import.meta.url).href;
  const testingPath = new URL("../dist/testing.js", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import * as fs from 'node:fs/promises';
    import { createExecutor, createFileTransmissionStore } from ${JSON.stringify(modulePath)};
    import { createMemoryStores } from ${JSON.stringify(testingPath)};
    const [entry, mandate, binding] = JSON.parse(process.argv[2]);
    const memory = createMemoryStores();
    memory.entries.set(entry.proposal.id, entry);
    const store = await createFileTransmissionStore({ io: fs, directory: process.argv[1], exclusive: memory.transmissions.exclusive });
    setInterval(() => {}, 1000);
    const executor = createExecutor({ ownerWebId: mandate.issuer, agentWebId: mandate.subject,
      proposals: memory.proposals, approvals: memory.approvalStore, controls: memory.controls, clock: memory.clock,
      mandates: { load: async () => mandate }, transmissions: store,
      policy: { id: 'synthetic', evaluate: (policy) => ({ effect: policy.id === mandate.autonomous.id ? 'permit' : 'not-applicable' }) },
      audit: { listCommitted: async () => [], append: async (record) => {
        if (record.outcome === 'attempting') { process.stdout.write('durable\\n'); await new Promise(() => {}); }
      } },
      tokens: { send: async () => { throw new Error('must not request credentials'); } },
      bindings: { [binding.id]: { ...binding, send: { render: async () => entry.wire, validate: async () => ({ ok: true }),
        transmit: async () => { throw new Error('must not transmit before process death'); } } } }, dryRun: false,
    });
    await executor.transmit(entry.proposal.id);
  `,
      directory,
      JSON.stringify([e, h.state.mandate, { id: h.binding.id, carriage: h.binding.carriage }]),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const [data] = await once(child.stdout, "data");
    expect(String(data)).toBe("durable\n");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    const [, signal] = await exited;
    expect(signal).toBe("SIGKILL");
    expect(await store.get(e.proposal.id)).toMatchObject({ status: "attempting" });
    const executor = createExecutor({ ...h.options, transmissions: store });
    expect(await executor.transmit(e.proposal.id)).toMatchObject({ status: "uncertain" });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  } finally {
    child.kill("SIGKILL");
  }
}, 20000);

it.each([
  "json",
  "shape",
  "records",
  "io",
])("corrupt store %s never becomes an empty ledger", async (failure) => {
  const { directory, store } = await fixture();
  if (failure === "io") await fs.mkdir(`${directory}/transmissions.json`);
  else
    await fs.writeFile(
      `${directory}/transmissions.json`,
      failure === "json" ? "{" : failure === "shape" ? "{}" : '[{"attempts":0}]',
    );
  await expect(store.list()).rejects.toThrow();
});
it.each([
  "open",
  "write",
  "sync",
  "rename",
  "directory-open",
  "directory-sync",
  "cleanup",
])("%s failure propagates without claiming durability", async (failure) => {
  const io: ExecutorFileSystem = { ...fs };
  const { store } = await fixture(io);
  const h = harness();
  const e = await h.enqueue();
  const record = h.prior(e);
  const error = new Error("durability failed");
  io.open = async (path, flags, mode) => {
    if (
      failure === "open" ||
      failure === "cleanup" ||
      (failure === "directory-open" && flags === "r")
    )
      throw error;
    const handle = await fs.open(path, flags, mode);
    return {
      writeFile: async (data, encoding) => {
        if (failure === "write") throw error;
        await handle.writeFile(data, encoding);
      },
      sync: async () => {
        if (failure === "sync" || (failure === "directory-sync" && flags === "r")) throw error;
        await handle.sync();
      },
      close: async () => {
        await handle.close();
      },
    };
  };
  if (failure === "rename")
    io.rename = async () => {
      throw error;
    };
  if (failure === "cleanup")
    io.unlink = async () => {
      throw new Error("cleanup");
    };
  await expect(store.put(record)).rejects.toBe(error);
});
it("HALT check treats existing files and dangling symlinks as halted", async () => {
  const { directory } = await fixture();
  const path = `${directory}/HALT`;
  const check = createHaltFileCheck(fs, path);
  expect(await check()).toBe(false);
  await fs.writeFile(path, "");
  expect(await check()).toBe(true);
  await fs.unlink(path);
  await fs.symlink(`${directory}/missing`, path);
  expect(await check()).toBe(true);
});
it.each([
  new Error("permission"),
  null,
  "failure",
  { code: "EACCES" },
])("HALT check never treats error %j as absent", async (error) => {
  await expect(
    createHaltFileCheck(
      {
        lstat: async () => {
          throw error;
        },
      },
      "HALT",
    )(),
  ).rejects.toBe(error);
});
