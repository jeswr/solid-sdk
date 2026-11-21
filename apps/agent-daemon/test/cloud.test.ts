// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CONFIG_ED25519, PILOT_PROFILE } from "@jeswr/agent-reference";
import { A2A_BINDING, a2aRequest, a2aResponse, readA2a } from "@jeswr/agent-reference/bindings/a2a";
import { type ByteMessage, envelopeJson } from "@jeswr/agent-reference/bindings/bytes";
import { MessageNode } from "@jeswr/agent-reference/model/message-nodes";
import { AgentRuntime } from "@jeswr/agent-reference/runtime/agent";
import { carriageBytes, DOCUMENT_MEDIA_TYPE } from "@jeswr/agent-reference/wire/carriage";
import { writeMessagePacket } from "@jeswr/agent-reference/wire/message-packet";
import { chmod, mkdtemp, readdir, rm, stat } from "fs/promises";
import { createServer, type IncomingHttpHeaders, IncomingMessage, request } from "http";
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
import { createGateReceiver } from "../src/cloud-receivers.js";
import type { Gate } from "../src/gate.js";
import { createProcessLease } from "../src/local.js";
import { createTestGate } from "../src/testing.js";

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "awp-cloud-"));
  directories.push(directory);
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
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
function send(
  port: number,
  path: string,
  method = "GET",
  body?: string | Uint8Array,
  headers = {},
) {
  return new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>(
    (resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
          }),
        );
      });
      req.on("error", reject);
      req.end(body);
    },
  );
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
  const env = {
    AGENT_ENVIRONMENT: "dev",
    AGENT_A2A_ENABLED: "true",
    AGENT_CREDENTIAL_DIR: join(tmpdir(), "unused-cloud-fixture"),
  };
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
    expect(
      (await send(port, "/answerable", "POST", "{}", { "content-type": DOCUMENT_MEDIA_TYPE }))
        .status,
    ).toBe(404);
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
    expect(await send(port, "/a2a", "POST", "{}", headers)).toMatchObject({
      status: 503,
      body: "",
    });
    host.a2a.mockResolvedValueOnce({ status: 999, body: "synthetic-secret" });
    expect(await send(port, "/a2a", "POST", "{}", headers)).toMatchObject({
      status: 500,
      body: "",
    });
  });
  await runCloud(async () => host, new AbortController().signal, env);
  expect(host.close).toHaveBeenCalledOnce();
  await expect(send(port, "/readyz")).rejects.toThrow();
});

function tamper(jws: string) {
  const [header, payload, signature] = jws.split(".") as [string, string, string];
  const bytes = Buffer.from(signature, "base64url");
  bytes[0] = (bytes[0] as number) ^ 1;
  return `${header}.${payload}.${bytes.toString("base64url")}`;
}

it.each([
  ["a2a", "compact"],
  ["answerable", "compact"],
  ["answerable", "document"],
])("admits signed messages on /%s (%s) and returns only a receipt or reason", async (path, format) => {
  const { env, port } = await setup();
  const { gate, ledger, peer, receiver, sign, now } = await createTestGate();
  const message = {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:uuid:00000000-0000-4000-8000-000000000041",
    conversation: "urn:uuid:00000000-0000-4000-8000-100000000041",
    kind: "describe" as const,
    from: { actor: peer.identity.actor },
    to: { actor: receiver.identity.actor },
    createdAt: now().toISOString(),
    expiresAt: "2026-10-19T09:00:00.000Z",
    body: {},
  };
  let valid: ByteMessage;
  let altered: ByteMessage;
  if (format === "document") {
    const packet = await writeMessagePacket(MessageNode.toNode(message), {
      suite: "jws",
      key: peer.actorKey,
      verificationMethod: `urn:awp:key:${peer.actorKey.kid}`,
      created: message.createdAt,
    });
    const document = JSON.parse(packet.jsonld);
    document.proof.jws = tamper(document.proof.jws);
    valid = carriageBytes(packet);
    altered = carriageBytes({ ...packet, jsonld: JSON.stringify(document) });
  } else {
    const jws = await sign(message);
    valid = carriageBytes({ format: "awp-jws-compact/0.1", jws });
    altered = carriageBytes({ format: "awp-jws-compact/0.1", jws: tamper(jws) });
  }
  const release = vi.spyOn(gate, "release");
  const verifyOwn = vi.spyOn(gate, "verifyOwn");
  const receive = vi.spyOn(gate, "receiveCarriage");
  async function post(wire: ByteMessage, id: string) {
    if (path === "answerable") {
      const response = await send(port, "/answerable", "POST", wire.bytes, {
        "content-type": `${wire.mediaType}; charset=utf-8`,
      });
      expect(response.status).toBe(200);
      return envelopeJson(Buffer.from(response.body));
    }
    const frame = a2aRequest(wire, id, "/a2a", "Discard this untrusted text.");
    const { params, jsonrpc } = JSON.parse(Buffer.from(frame.body).toString());
    const requestBody = Buffer.from(
      String.raw`{ "params" : ${JSON.stringify(params)}, "method" : "\u0053endMessage", "id" : ${JSON.stringify(id)}, "jsonrpc" : ${JSON.stringify(jsonrpc)} }`,
    );
    const response = await send(port, "/a2a", "POST", requestBody, {
      ...frame.headers,
      authorization: "Bearer synthetic",
    });
    expect(response.status).toBe(200);
    expect(receive).toHaveBeenLastCalledWith(
      {
        binding: A2A_BINDING,
        delivery: {
          carriage: "a2a-request",
          frame: {
            ...frame,
            body: requestBody,
            headers: expect.objectContaining({
              "A2A-Version": frame.headers["A2A-Version"],
              "A2A-Extensions": frame.headers["A2A-Extensions"],
              authorization: "Bearer synthetic",
            }),
          },
        },
      },
      expect.any(AbortSignal),
    );
    const body = Buffer.from(response.body);
    expect(envelopeJson(body)).toMatchObject({ jsonrpc: "2.0", id });
    const receipt = readA2a({
      ...frame,
      body,
      headers: {
        "A2A-Version": String(response.headers["a2a-version"]),
        "A2A-Extensions": String(response.headers["a2a-extensions"]),
      },
    }).message;
    expect(receipt.mediaType).toBe("application/json");
    return envelopeJson(receipt.bytes);
  }
  const host = {
    ...composition(),
    gate,
    ...(path === "a2a" && { a2a: undefined }),
  };
  host.daemon.run = vi.fn(async () => {
    expect(await post(altered, "tampered")).toEqual({ reason: "bad-signature" });
    expect(await post(valid, "valid")).toEqual({ outcome: "admitted" });
    expect(gate.decisions(0)).toEqual([
      expect.objectContaining({ direction: "in", outcome: "refuse", reason: "bad-signature" }),
      expect.objectContaining({ direction: "in", outcome: "admit", reason: "admit" }),
    ]);
    const records = ledger.entries().map(({ record }) => record);
    expect(records).toContainEqual(
      expect.objectContaining({ type: "message-out", kind: "description" }),
    );
    expect(records.some(({ type }) => type === "transmission")).toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect(verifyOwn).not.toHaveBeenCalled();
    expect(await post(valid, "valid")).toEqual({ reason: "replay-conflict" });
    if (path === "a2a") {
      const frame = a2aRequest(valid, "valid", "/a2a", "Discard this untrusted text.");
      const wrongVersion = await send(port, "/a2a", "POST", frame.body, {
        ...frame.headers,
        "A2A-Version": "0.3",
      });
      const refusal = readA2a({ ...frame, body: Buffer.from(wrongVersion.body) }).message;
      expect(envelopeJson(refusal.bytes)).toEqual({ reason: "malformed" });
      const result = a2aResponse(valid, "reply", "/a2a");
      expect(await send(port, "/a2a", "POST", result.body, result.headers)).toMatchObject({
        status: 400,
        body: '{"reason":"malformed"}',
      });
    }
  });
  try {
    await runCloud(async () => host, new AbortController().signal, env);
  } finally {
    await gate.close();
  }
});

it.each([
  "/a2a",
  "/answerable",
])("reports the same empty 503 for either decision commit failure on %s", async (path) => {
  const { env, port } = await setup();
  const { gate, open, peer, receiver, sign, now } = await createTestGate();
  const second = await open();
  const commit = AgentRuntime.prototype.commitBindingEvent;
  const attempted: unknown[] = [];
  const write = vi.spyOn(AgentRuntime.prototype, "commitBindingEvent").mockImplementation(function (
    this: AgentRuntime,
    record,
  ) {
    if (record.type === "suite-gate-decision") {
      attempted.push(record.outcome);
      return Promise.reject(new Error("synthetic decision commit failure"));
    }
    return commit.call(this, record);
  });
  try {
    const jws = await sign({
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: "urn:uuid:00000000-0000-4000-8000-000000000042",
      conversation: "urn:uuid:00000000-0000-4000-8000-100000000042",
      kind: "describe",
      from: { actor: peer.identity.actor },
      to: { actor: receiver.identity.actor },
      createdAt: now().toISOString(),
      expiresAt: "2026-10-19T09:00:00.000Z",
      body: {},
    });
    const host = {
      ...composition(),
      a2a: undefined,
      gate: {
        receiveCarriage: vi
          .fn<Gate["receiveCarriage"]>()
          .mockImplementationOnce(gate.receiveCarriage)
          .mockImplementationOnce(second.gate.receiveCarriage),
      },
    };
    host.daemon.run = vi.fn(async () => {
      async function post(signed: string) {
        const wire = carriageBytes({ format: "awp-jws-compact/0.1", jws: signed });
        const frame =
          path === "/a2a"
            ? a2aRequest(wire, "commit", path)
            : { body: wire.bytes, headers: { "Content-Type": wire.mediaType } };
        const { status, body, headers } = await send(port, path, "POST", frame.body, frame.headers);
        const { date, ...stableHeaders } = headers;
        expect(date).toBeDefined();
        expect(status).toBe(503);
        expect(body).toBe("");
        expect(stableHeaders).toMatchObject({
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        return stableHeaders;
      }
      const admitted = await post(jws);
      expect(await post(tamper(jws))).toEqual(admitted);
    });
    await runCloud(async () => host, new AbortController().signal, env);
    expect(attempted).toEqual(["admit", "refuse"]);
    expect(gate.decisions(0)).toEqual([]);
    expect(second.gate.decisions(0)).toEqual([]);
  } finally {
    write.mockRestore();
    await Promise.all([gate.close(), second.gate.close()]);
  }
});

it("enforces the direct HTTP route, media types and byte bound before calling the gate", async () => {
  const { env, port } = await setup();
  const host = {
    ...composition(),
    gate: {
      receiveCarriage: vi
        .fn<Gate["receiveCarriage"]>()
        .mockResolvedValueOnce({ outcome: "admitted", digest: "" })
        .mockResolvedValueOnce({ outcome: "refused", reason: "malformed", digest: "" }),
    },
  };
  host.daemon.run = vi.fn(async () => {
    const headers = { "content-type": DOCUMENT_MEDIA_TYPE };
    expect((await send(port, "/answerable")).status).toBe(405);
    expect(
      (await send(port, "/answerable", "POST", "{}", { "content-type": "application/json" }))
        .status,
    ).toBe(415);
    expect((await send(port, "/answerable", "POST", "x".repeat(65537), headers)).status).toBe(413);
    expect(
      (
        await send(port, "/answerable", "POST", "x".repeat(65537), {
          ...headers,
          "transfer-encoding": "chunked",
        })
      ).status,
    ).toBe(413);
    expect(host.gate.receiveCarriage).not.toHaveBeenCalled();
    const body = Buffer.alloc(65536, 0xff);
    for (const expected of [{ outcome: "admitted" }, { reason: "malformed" }]) {
      const reply = await send(port, "/answerable", "POST", body, headers);
      expect(reply.status).toBe(200);
      expect(envelopeJson(Buffer.from(reply.body))).toEqual(expected);
    }
    expect(host.gate.receiveCarriage).toHaveBeenCalledTimes(2);
    expect(host.gate.receiveCarriage).toHaveBeenCalledWith(
      { binding: "direct-http", delivery: { bytes: body, mediaType: DOCUMENT_MEDIA_TYPE } },
      expect.any(AbortSignal),
    );
  });
  await runCloud(async () => host, new AbortController().signal, env);
});
it.each([
  "default",
  "explicit",
])("uses HTTP 200 for admission and refusal at the A2A request byte limit (%s receiver)", async (receiver) => {
  const { env, port } = await setup();
  const limit = 64 * 1024 - 512;
  const id = "é".repeat((limit / 2 - 2) / 2);
  const reason = "conflicting-structured-copies";
  const frame = a2aRequest(
    carriageBytes({ format: "awp-jws-compact/0.1", jws: "a.b.c" }),
    "message",
    "/a2a",
  );
  const json = JSON.stringify({ ...JSON.parse(Buffer.from(frame.body).toString()), id });
  const body = json.padEnd(json.length + limit - Buffer.byteLength(json));
  expect(Buffer.byteLength(body)).toBe(limit);
  const receiveCarriage = vi
    .fn<Gate["receiveCarriage"]>()
    .mockResolvedValueOnce({ outcome: "admitted", digest: "" })
    .mockResolvedValueOnce({ outcome: "refused", reason, digest: "" });
  const gate = { receiveCarriage };
  const host = {
    ...composition(),
    a2a: receiver === "explicit" ? createGateReceiver(gate) : undefined,
    gate,
  };
  host.daemon.run = vi.fn(async () => {
    for (const headers of [frame.headers, { ...frame.headers, "transfer-encoding": "chunked" }]) {
      const oversized = await send(port, "/a2a", "POST", `${body} `, headers);
      expect(oversized.status).toBe(413);
      expect(oversized.headers.connection).toBe("close");
    }
    const oversizedId = JSON.stringify({ ...JSON.parse(json), id: `${id}é` });
    expect(await send(port, "/a2a", "POST", oversizedId, frame.headers)).toMatchObject({
      status: 400,
      body: '{"reason":"malformed"}',
    });
    expect(receiveCarriage).not.toHaveBeenCalled();
    for (const expected of [{ outcome: "admitted" }, { reason }]) {
      const reply = await send(port, "/a2a", "POST", body, frame.headers);
      expect(reply.status).toBe(200);
      const exchange = {
        ...frame,
        body: Buffer.from(reply.body),
        headers: {
          "A2A-Version": String(reply.headers["a2a-version"]),
          "A2A-Extensions": String(reply.headers["a2a-extensions"]),
        },
      };
      const { message } = readA2a(exchange);
      expect(message.mediaType).toBe("application/json");
      expect(envelopeJson(message.bytes)).toEqual(expected);
      expect(envelopeJson(exchange.body)).toMatchObject({ id });
    }
    expect(receiveCarriage).toHaveBeenCalledTimes(2);
  });
  await runCloud(async () => host, new AbortController().signal, env);
});

it.each([
  { path: "/a2a", mediaType: "text/plain", status: 415, expectation: undefined },
  { path: "/answerable", mediaType: undefined, status: 415, expectation: undefined },
  { path: "/a2a", mediaType: "application/json", status: 413, expectation: undefined },
  { path: "/answerable", mediaType: DOCUMENT_MEDIA_TYPE, status: 413, expectation: undefined },
  { path: "/a2a", mediaType: "application/json", status: 417, expectation: "unsupported" },
  { path: "/answerable", mediaType: DOCUMENT_MEDIA_TYPE, status: 417, expectation: "unsupported" },
  {
    path: "/a2a",
    mediaType: "application/json",
    status: 417,
    expectation: "100-continue, unsupported",
  },
  {
    path: "/answerable",
    mediaType: DOCUMENT_MEDIA_TYPE,
    status: 417,
    expectation: "100-continue, unsupported",
  },
])("closes $path after $status with an unfinished oversized chunked upload", async ({
  path,
  mediaType,
  status,
  expectation,
}) => {
  const { env, port } = await setup();
  const host = { ...composition(), gate: { receiveCarriage: vi.fn() } };
  const emit = IncomingMessage.prototype.emit;
  let consumed = 0;
  const emitted = vi.spyOn(IncomingMessage.prototype, "emit").mockImplementation(function (
    this: IncomingMessage,
    event,
    ...args
  ) {
    const [chunk] = args;
    if (this.url === path && event === "data" && Buffer.isBuffer(chunk)) consumed += chunk.length;
    return emit.call(this, event, ...args);
  });
  host.daemon.run = vi.fn(async () => {
    const socket = connect(port, "127.0.0.1");
    const reply: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => reply.push(chunk));
    const closed = new Promise<void>((resolve, reject) => {
      socket.on("error", (error) => {
        if (!reply.length) reject(error);
      });
      socket.once("close", () => resolve());
      socket.setTimeout(2000, () => reject(new Error("Upload connection stayed open")));
    });
    try {
      const headers = `POST ${path} HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n`;
      const type = mediaType ? `Content-Type: ${mediaType}\r\n` : "";
      const expectHeader = expectation ? `Expect: ${expectation}\r\n` : "";
      const chunk = `2000\r\n${"x".repeat(8192)}\r\n`;
      socket.write(`${headers}${type}${expectHeader}\r\n${chunk.repeat(32)}`);
      await closed;
      const response = Buffer.concat(reply).toString();
      expect(response).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `));
      expect(response).toMatch(/\r\nconnection: close\r\n/i);
      expect(consumed).toBeLessThanOrEqual(status === 413 ? 64 * 1024 : 0);
      expect(host.gate.receiveCarriage).not.toHaveBeenCalled();
      expect(host.a2a).not.toHaveBeenCalled();
    } finally {
      socket.destroy();
    }
  });
  try {
    await runCloud(async () => host, new AbortController().signal, env);
  } finally {
    emitted.mockRestore();
  }
});

it.each([
  ["/a2a", "application/json", "fixed-length"],
  ["/a2a", "application/json", "chunked"],
  ["/answerable", DOCUMENT_MEDIA_TYPE, "fixed-length"],
  ["/answerable", DOCUMENT_MEDIA_TYPE, "chunked"],
])("replies and frees the slot when the final bytes and EOF arrive together on %s (%s, %s)", async (path, type, framing) => {
  const { env, port } = await setup();
  const host = {
    ...composition(),
    a2a: undefined,
    gate: {
      receiveCarriage: vi.fn<Gate["receiveCarriage"]>().mockResolvedValue({
        outcome: "admitted",
        digest: "",
      }),
    },
  };
  const wire = carriageBytes({ format: "awp-jws-compact/0.1", jws: "a.b.c" });
  const frame = a2aRequest(wire, "complete", "/a2a");
  const payload = Buffer.from(path === "/a2a" ? frame.body : wire.bytes);
  const [framingHeader, body] =
    framing === "chunked"
      ? ["Transfer-Encoding: chunked", `${payload.length.toString(16)}\r\n${payload}\r\n0\r\n\r\n`]
      : [`Content-Length: ${payload.length}`, payload.toString()];
  const a2aHeaders =
    path === "/a2a"
      ? `A2A-Version: ${frame.headers["A2A-Version"]}\r\nA2A-Extensions: ${frame.headers["A2A-Extensions"]}\r\n`
      : "";
  const headers = `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: ${type}\r\n${a2aHeaders}${framingHeader}\r\n`;
  host.daemon.run = vi.fn(async () => {
    const socket = connect(port, "127.0.0.1");
    const reply: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => reply.push(chunk));
    const closed = new Promise<void>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
      socket.setTimeout(2000, () => reject(new Error("Completed requests did not drain")));
    });
    const statuses = () =>
      Array.from(
        Buffer.concat(reply)
          .toString()
          .matchAll(/HTTP\/1\.1 (\d+)/g),
        ([, status]) => status,
      );
    try {
      // Deliver the headers, final payload byte and HTTP body terminator in one write.
      socket.write(`${headers}\r\n${body}`);
      await vi.waitFor(() => expect(statuses()).toEqual(["200"]));
      // A full batch of 64 pipelined requests fits only once the first slot is released.
      socket.write(
        `${`${headers}\r\n${body}`.repeat(63)}${headers}Connection: close\r\n\r\n${body}`,
      );
      await closed;
      expect(statuses()).toEqual(Array(65).fill("200"));
      expect(host.gate.receiveCarriage).toHaveBeenCalledTimes(65);
      expect(host.gate.receiveCarriage).toHaveBeenLastCalledWith(
        path === "/a2a"
          ? {
              binding: A2A_BINDING,
              delivery: {
                carriage: "a2a-request",
                frame: expect.objectContaining({ body: payload }),
              },
            }
          : { binding: "direct-http", delivery: { bytes: payload, mediaType: type } },
        expect.any(AbortSignal),
      );
    } finally {
      socket.destroy();
      await closed.catch(() => undefined);
    }
  });
  await runCloud(async () => host, new AbortController().signal, env);
});

it.each([
  ["/a2a", "application/json"],
  ["/answerable", DOCUMENT_MEDIA_TYPE],
])("replies when the client half-closes right after a complete body on %s", async (path, type) => {
  const { env, port } = await setup();
  const host = {
    ...composition(),
    a2a: undefined,
    gate: {
      receiveCarriage: vi.fn<Gate["receiveCarriage"]>().mockImplementation(async () => {
        // The gate takes a moment to commit, so the FIN is processed before the reply.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { outcome: "admitted", digest: "" };
      }),
    },
  };
  const wire = carriageBytes({ format: "awp-jws-compact/0.1", jws: "a.b.c" });
  const frame = a2aRequest(wire, "half-close", "/a2a");
  const payload = Buffer.from(path === "/a2a" ? frame.body : wire.bytes);
  const a2aHeaders =
    path === "/a2a"
      ? `A2A-Version: ${frame.headers["A2A-Version"]}\r\nA2A-Extensions: ${frame.headers["A2A-Extensions"]}\r\n`
      : "";
  for (const framing of ["fixed-length", "chunked"]) {
    host.daemon.run = vi.fn(async () => {
      const [framingHeader, body] =
        framing === "chunked"
          ? [
              "Transfer-Encoding: chunked",
              `${payload.length.toString(16)}\r\n${payload}\r\n0\r\n\r\n`,
            ]
          : [`Content-Length: ${payload.length}`, payload.toString()];
      const socket = connect(port, "127.0.0.1");
      const reply: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => reply.push(chunk));
      const closed = new Promise<void>((resolve, reject) => {
        socket.once("close", resolve);
        socket.once("error", reject);
        socket.setTimeout(3000, () => reject(new Error("No reply after half-close")));
      });
      try {
        // Send the whole request and the TCP FIN together.
        socket.end(
          `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: ${type}\r\n${a2aHeaders}${framingHeader}\r\n\r\n${body}`,
        );
        await closed;
        expect(Buffer.concat(reply).toString()).toMatch(/^HTTP\/1\.1 200 /);
      } finally {
        socket.destroy();
      }
    });
    await runCloud(async () => host, new AbortController().signal, env);
  }
  expect(host.gate.receiveCarriage).toHaveBeenCalledTimes(2);
});

it("reserves shared slots for unfinished uploads and reclaims them on disconnect", async () => {
  const { env, port } = await setup();
  const host = { ...composition(), gate: { receiveCarriage: vi.fn() } };
  const upload = (path: string, mediaType: string) =>
    request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      agent: false,
      headers: {
        "content-type": mediaType,
        "transfer-encoding": "chunked",
        expect: "100-continue",
      },
    });
  host.daemon.run = vi.fn(async () => {
    for (const [path, type] of [
      ["/a2a", "application/json"],
      ["/answerable", DOCUMENT_MEDIA_TYPE],
    ] as const) {
      const reply = await send(port, path, "POST", "{}", {
        "content-type": type,
        expect: "unsupported",
      });
      expect(reply.status).toBe(417);
      expect(reply.headers.connection).toBe("close");
    }
    const uploads = Array.from({ length: 64 }, (_, index) =>
      index % 2 === 0
        ? upload("/a2a", "application/json")
        : upload("/answerable", DOCUMENT_MEDIA_TYPE),
    );
    let extra: ReturnType<typeof upload> | undefined;
    try {
      await Promise.all(
        uploads.map(
          (req) =>
            new Promise<void>((resolve, reject) => {
              req.on("error", reject);
              req.once("response", (res) => {
                res.resume();
                reject(new Error(`Slow upload received ${res.statusCode} before continuing`));
              });
              req.once("continue", () => {
                req.write("{");
                resolve();
              });
              req.flushHeaders();
            }),
        ),
      );
      const overflow = upload("/answerable", DOCUMENT_MEDIA_TYPE);
      extra = overflow;
      const response = await new Promise<{ status?: number; connection?: string }>(
        (resolve, reject) => {
          overflow.on("error", reject);
          overflow.once("continue", () => reject(new Error("Overloaded listener invited a body")));
          overflow.once("response", (res) => {
            res.resume();
            res.once("end", () =>
              resolve({ status: res.statusCode, connection: res.headers.connection }),
            );
          });
          overflow.flushHeaders();
        },
      );
      expect(response).toEqual({ status: 503, connection: "close" });
      expect(host.gate.receiveCarriage).not.toHaveBeenCalled();
      expect(host.a2a).not.toHaveBeenCalled();
      uploads[0]?.destroy();
      await vi.waitFor(async () => {
        const recovered = await send(port, "/a2a", "POST", "{}", {
          "content-type": "application/json",
        });
        expect(recovered.status).toBe(401);
      });
      expect(host.a2a).toHaveBeenCalledOnce();
    } finally {
      for (const req of uploads) req.destroy();
      extra?.destroy();
    }
  });
  await runCloud(async () => host, new AbortController().signal, env);
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
    expect(await send(port, "/a2a", "POST", "{}", headers)).toMatchObject({
      status: 503,
      body: "",
    });
    host.a2a.mockResolvedValueOnce({ status: 200, body: "x".repeat(65537) });
    expect(await send(port, "/a2a", "POST", "{}", headers)).toMatchObject({
      status: 500,
      body: "",
    });
  });
  await runCloud(async () => host, new AbortController().signal, env);
});

it("shares the in-flight limit even for pipelined requests on one connection", async () => {
  const { env, port } = await setup();
  const host = { ...composition(), gate: { receiveCarriage: vi.fn() } };
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
      for (let index = 0; index < 64; index++) {
        socket.write(
          "POST /a2a HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
        );
      }
      socket.write(
        `POST /answerable HTTP/1.1\r\nHost: localhost\r\nContent-Type: ${DOCUMENT_MEDIA_TYPE}\r\nContent-Length: 2\r\n\r\n{}`,
      );
      await vi.waitFor(() => expect(host.a2a).toHaveBeenCalledTimes(64));
      finish?.();
      await closed;
      const output = Buffer.concat(chunks).toString();
      expect(output.match(/HTTP\/1\.1 202/g)).toHaveLength(64);
      expect(output.match(/HTTP\/1\.1 503/g)).toHaveLength(1);
      expect(host.gate.receiveCarriage).not.toHaveBeenCalled();
    } finally {
      finish?.();
      socket.destroy();
    }
  });
  await runCloud(async () => host, new AbortController().signal, env);
});
