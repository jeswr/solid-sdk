// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { chmod, mkdtemp, readdir, rm, stat } from "fs/promises";
import { createServer, request } from "http";
import { connect } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";
import {
  type CloudComposition,
  type CloudContext,
  runCloud,
  runConfiguredCloud,
} from "../src/cloud.js";
import { createProcessLease } from "../src/local.js";

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "awp-cloud-"));
  directories.push(directory);
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return {
    env: {
      AGENT_ENVIRONMENT: "dev",
      AGENT_A2A_ENABLED: "true",
      AGENT_CREDENTIAL_DIR: directory,
      AGENT_A2A_PORT: String(port),
      OPENAI_API_KEY: "synthetic-key-only",
    },
    directory,
    port,
  };
}
function send(port: number, path: string, method = "GET", body?: string, headers = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}
function composition() {
  return {
    bindings: ["a2a"],
    a2a: vi.fn(async () => ({ status: 401, body: '{"error":"unauthorized"}' })),
    close: vi.fn(async () => undefined),
    daemon: { once: vi.fn(), run: vi.fn(async (_signal: AbortSignal) => undefined) },
  } satisfies CloudComposition;
}
it("requires explicit dev configuration and a trusted host before opening a store or listener", async () => {
  const { env } = await setup();
  const factory = vi.fn(async () => composition());
  const signal = new AbortController().signal;
  for (const override of [
    { AGENT_ENVIRONMENT: "prod" },
    { AGENT_A2A_ENABLED: "false" },
    { AGENT_CREDENTIAL_DIR: "relative" },
    { AGENT_A2A_PORT: "0" },
    { AGENT_A2A_PORT: "NaN" },
    { AGENT_A2A_PORT: "65536" },
  ]) {
    await expect(runCloud(factory, signal, { ...env, ...override })).rejects.toThrow(
      "configuration",
    );
  }
  expect(factory).not.toHaveBeenCalled();
  await expect(runConfiguredCloud(signal)).rejects.toThrow("trusted");
});
it("retains private persistent state and reads only explicit Key Vault injected model keys", async () => {
  const { env, directory } = await setup();
  const host = composition();
  let context: CloudContext | undefined;
  await runCloud(
    async (value) => {
      context = value;
      return host;
    },
    new AbortController().signal,
    env,
  );
  expect(context?.store.dir).toBe(directory);
  expect(context?.apiKey("openai")).toBe("synthetic-key-only");
  expect(() => context?.apiKey("anthropic")).toThrow("unavailable");
  expect(await readdir(join(directory, "providers"))).toEqual([]);
  await context?.local.checkpoints.put("fixture", "page-2");
  await runCloud(
    async (value) => {
      expect(await value.local.checkpoints.get("fixture")).toBe("page-2");
      expect((await stat(join(directory, "cursor-fixture.json"))).mode & 0o777).toBe(0o600);
      return composition();
    },
    new AbortController().signal,
    env,
  );
  await chmod(directory, 0o755);
  await expect(runCloud(async () => host, new AbortController().signal, env)).rejects.toThrow(
    "accessible",
  );
  expect(host.close).toHaveBeenCalledOnce();
});
it.each([
  "imessage",
  "signal",
  "whatsapp",
  "mcp",
  "unknown",
])("refuses local or unclassified binding %s", async (binding) => {
  const { env } = await setup();
  const host = { ...composition(), bindings: ["a2a", binding] };
  await expect(runCloud(async () => host, new AbortController().signal, env)).rejects.toThrow(
    "cloud-capable",
  );
  expect(host.daemon.run).not.toHaveBeenCalled();
  expect(host.close).toHaveBeenCalledOnce();
});
it("requires an A2A receiver and refuses a missing A2A binding", async () => {
  const { env } = await setup();
  for (const host of [
    { ...composition(), bindings: [] },
    { ...composition(), a2a: undefined } as unknown as CloudComposition,
  ]) {
    await expect(runCloud(async () => host, new AbortController().signal, env)).rejects.toThrow(
      "A2A",
    );
    expect(host.close).toHaveBeenCalledOnce();
  }
});
it("exposes bounded A2A and probes, preserves authorization bytes and suppresses provider errors", async () => {
  const { env, port } = await setup();
  const host = composition();
  host.daemon.run = vi.fn(async (signal) => {
    expect((await send(port, "/readyz")).status).toBe(200);
    expect((await send(port, "/livez")).status).toBe(200);
    expect((await send(port, "/elsewhere")).status).toBe(404);
    expect((await send(port, "/a2a")).status).toBe(405);
    expect((await send(port, "/a2a", "POST", "{}")).status).toBe(415);
    const headers = { "content-type": "application/json", authorization: "Bearer synthetic" };
    expect((await send(port, "/a2a", "POST", "{}", headers)).status).toBe(401);
    expect(host.a2a).toHaveBeenCalledWith({
      body: Buffer.from("{}"),
      headers: expect.objectContaining({ authorization: "Bearer synthetic" }),
      signal,
    });
    expect((await send(port, "/a2a", "POST", "x".repeat(65537), headers)).status).toBe(413);
    expect(
      (
        await send(port, "/a2a", "POST", "x".repeat(65537), {
          ...headers,
          "transfer-encoding": "chunked",
        })
      ).status,
    ).toBe(413);
    expect(host.a2a).toHaveBeenCalledTimes(1);
    host.a2a.mockRejectedValueOnce(new Error("synthetic-provider-secret"));
    expect(await send(port, "/a2a", "POST", "{}", headers)).toEqual({ status: 503, body: "" });
    host.a2a.mockResolvedValueOnce({ status: 999, body: "synthetic-secret" });
    expect(await send(port, "/a2a", "POST", "{}", headers)).toEqual({ status: 500, body: "" });
  });
  await runCloud(async () => host, new AbortController().signal, env);
  expect(host.close).toHaveBeenCalledOnce();
  await expect(send(port, "/readyz")).rejects.toThrow();
});
it("aborts the listener and waits for daemon drain before closing credentials", async () => {
  const { env, port } = await setup();
  const controller = new AbortController();
  const host = composition();
  host.daemon.run = vi.fn(async (signal) => {
    controller.abort();
    expect(signal.aborted).toBe(true);
    await expect(send(port, "/readyz")).rejects.toThrow();
    expect(host.close).not.toHaveBeenCalled();
  });
  await runCloud(async () => host, controller.signal, env);
  expect(host.close).toHaveBeenCalledOnce();
  const factory = vi.fn(async () => host);
  await runCloud(factory, controller.signal, env);
  expect(factory).not.toHaveBeenCalled();
});
it("closes the composition on daemon and listener startup failures", async () => {
  const { env, port } = await setup();
  const host = composition();
  host.daemon.run.mockRejectedValueOnce(new Error("fixture failure"));
  await expect(runCloud(async () => host, new AbortController().signal, env)).rejects.toThrow(
    "fixture failure",
  );
  expect(host.close).toHaveBeenCalledOnce();
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(port, "0.0.0.0", resolve));
  try {
    const other = composition();
    await expect(runCloud(async () => other, new AbortController().signal, env)).rejects.toThrow();
    expect(other.close).toHaveBeenCalledOnce();
    expect(other.daemon.run).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});

it("retains the file lease through inbound cancellation and drain, including a released daemon lease", async () => {
  const { env, port, directory } = await setup();
  const host = composition();
  const controller = new AbortController();
  let finish: (() => void) | undefined;
  let started: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  host.a2a.mockImplementationOnce(async () => {
    started?.();
    await pending;
    return { status: 202, body: "{}" };
  });
  let inbound: Promise<unknown> | undefined;
  const running = runCloud(
    async (context) => {
      host.daemon.run = vi.fn(async () => {
        const release = await context.lease.acquire();
        await expect(context.lease.acquire()).rejects.toThrow("active");
        inbound = send(port, "/a2a", "POST", "{}", { "content-type": "application/json" }).catch(
          () => undefined,
        );
        await received;
        controller.abort();
        await release();
        await expect(createProcessLease(directory).acquire()).rejects.toThrow();
      });
      return host;
    },
    controller.signal,
    env,
  );
  await received;
  await vi.waitFor(() => expect(host.daemon.run).toHaveBeenCalledOnce());
  await expect(createProcessLease(directory).acquire()).rejects.toThrow();
  expect(host.close).not.toHaveBeenCalled();
  finish?.();
  await running;
  await inbound;
  expect(host.close).toHaveBeenCalledOnce();
  const release = await createProcessLease(directory).acquire();
  await release();
});

it("releases startup leases after factory failure or cancellation during composition", async () => {
  const { env, directory } = await setup();
  await expect(
    runCloud(
      async () => {
        throw new Error("fixture");
      },
      new AbortController().signal,
      env,
    ),
  ).rejects.toThrow("fixture");
  const controller = new AbortController();
  const host = composition();
  await runCloud(
    async () => {
      controller.abort();
      return host;
    },
    controller.signal,
    env,
  );
  expect(host.daemon.run).not.toHaveBeenCalled();
  expect(host.close).toHaveBeenCalledOnce();
  const release = await createProcessLease(directory).acquire();
  await release();
});

it("catches synchronous receiver failures and bounds receiver response bytes", async () => {
  const { env, port } = await setup();
  const host = composition();
  host.daemon.run = vi.fn(async () => {
    const headers = { "content-type": "application/json" };
    host.a2a.mockImplementationOnce(() => {
      throw new Error("synthetic-secret");
    });
    expect(await send(port, "/a2a", "POST", "{}", headers)).toEqual({ status: 503, body: "" });
    host.a2a.mockResolvedValueOnce({ status: 200, body: "x".repeat(65537) });
    expect(await send(port, "/a2a", "POST", "{}", headers)).toEqual({ status: 500, body: "" });
  });
  await runCloud(async () => host, new AbortController().signal, env);
});

it("bounds concurrent A2A verification even for pipelined requests on one connection", async () => {
  const { env, port } = await setup();
  const host = composition();
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  host.a2a.mockImplementation(async () => {
    await pending;
    return { status: 202, body: "{}" };
  });
  host.daemon.run = vi.fn(async () => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    const closed = new Promise<void>((resolve, reject) => {
      socket.once("close", () => resolve());
      socket.once("error", reject);
    });
    try {
      for (let index = 0; index < 65; index++) {
        socket.write(
          `POST /a2a HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: ${index === 64 ? "close" : "keep-alive"}\r\n\r\n{}`,
        );
      }
      await vi.waitFor(() => expect(host.a2a).toHaveBeenCalledTimes(64));
      finish?.();
      await closed;
      const output = Buffer.concat(chunks).toString();
      expect(output.match(/HTTP\/1\.1 202/g)).toHaveLength(64);
      expect(output.match(/HTTP\/1\.1 503/g)).toHaveLength(1);
    } finally {
      finish?.();
      socket.destroy();
    }
  });
  await runCloud(async () => host, new AbortController().signal, env);
});
