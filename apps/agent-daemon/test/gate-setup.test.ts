// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.2 Sol

import { MemoryLedger } from "@jeswr/agent-audit";
import { encodeEnvelope } from "@jeswr/agent-channels";
import { createDirectReader } from "@jeswr/agent-channels/direct";
import { RecordingTokenProvider } from "@jeswr/agent-channels/testing";
import { CredentialStore, noTransport } from "@jeswr/agent-credentials";
import { CONFIG_ED25519, PILOT_PROFILE } from "@jeswr/agent-reference";
import { craftSigned } from "@jeswr/agent-reference/scenarios/common";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as daemon from "../src/index.js";
import { createTestGate } from "../src/testing.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "brief-41-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const now = () => new Date("2026-10-19T08:00:00Z");
const agentWebId = "https://agent.example/card#id";
const ownerWebId = "https://owner.example/card#id";
const approve = async () => true;
const options = () => ({
  directory: join(root, "gate"),
  ownerDir: join(root, "owner"),
  agentWebId,
  ownerWebId,
  now,
  confirm: approve,
});

it("refuses colocated custody before confirmation or filesystem writes", async () => {
  const o = options();
  const confirm = vi.fn(approve);
  await expect(
    daemon.initGate({ ...o, ownerDir: join(o.directory, "owner"), confirm }),
  ).rejects.toThrow(/outside/);
  expect(confirm).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});

it("confirms before writing and uses private keys in separate directories", async () => {
  const o = options();
  await daemon.initGate({
    ...o,
    confirm: async () => {
      expect(await readdir(root)).toEqual([]);
      return false;
    },
  });
  expect(await readdir(root)).toEqual([]);
  await daemon.initGate(o);
  await expect(daemon.initGate(o)).rejects.toThrow(/already exists/);
  expect((await stat(o.directory)).mode & 0o777).toBe(0o700);
  expect(await readdir(join(o.directory, "keys"))).toEqual(["actor.private.jwk.json"]);
  for (const key of [
    join(o.directory, "keys", "actor.private.jwk.json"),
    join(o.ownerDir, "gate", "owner.private.jwk.json"),
  ]) {
    expect((await stat(key)).mode & 0o777).toBe(0o600);
  }
});

it("rejects a card whose declared key thumbprint differs from its JWK", async () => {
  const o = options();
  await daemon.initGate(o);
  const peerDir = join(root, "peer");
  await daemon.initGate({
    ...o,
    directory: peerDir,
    agentWebId: "https://peer.example/actor#id",
    ownerWebId: "https://peer.example/owner#id",
  });
  const card = JSON.parse(await readFile(join(peerDir, "card.json"), "utf8"));
  card.actorKey.kid = card.partyKey.kid;
  const confirm = vi.fn(approve);
  await expect(daemon.pinPeer({ directory: o.directory, card, confirm })).rejects.toThrow();
  expect(confirm).not.toHaveBeenCalled();
});

it("keeps interrupted digests and refuses to open an altered ledger", async () => {
  const o = options();
  await daemon.initGate(o);
  const gate = await daemon.openGate(o);
  const rawSha256 = "a".repeat(64);
  const path = join(o.directory, `verdict-${rawSha256}.json`);
  try {
    await writeFile(path, JSON.stringify({ outcome: "checking", time: now().toISOString() }), {
      mode: 0o600,
    });
    const base = {
      channel: "direct",
      textBody: "",
      signals: {},
      rawSha256,
      rawByteLength: 0,
      rawMediaType: "application/json",
      warnings: [],
    };
    expect(
      await gate.check({
        binding: "direct",
        account: "fixture",
        message: {
          ...base,
          jsonLdBlocks: [
            '{"@context":{"agent":"https://jeswr.org/ns/agent#"},"@type":"agent:SignedMessage","agent:wireFormat":"jws-compact","agent:compactJws":"a.b.c"}',
          ],
        },
      }),
    ).toMatchObject({ outcome: "refused", reason: "result-uncertain" });
    expect(
      await gate.check({
        binding: "direct",
        account: "fixture",
        message: { ...base, rawSha256: "b".repeat(64) },
      }),
    ).toMatchObject({ outcome: "unstructured" });
    expect((await gate.status()).uncertainDigests).toEqual([`sha-256:${rawSha256}`]);
  } finally {
    await gate.close();
  }
  const ledger = join(o.directory, "ledger.jsonl");
  const lines = (await readFile(ledger, "utf8")).trimEnd().split("\n");
  const entry = JSON.parse(lines[0] as string);
  entry.record.reason = "altered";
  lines[0] = JSON.stringify(entry);
  await writeFile(ledger, `${lines.join("\n")}\n`);
  await expect(daemon.openGate(o)).rejects.toThrow(/ledger/i);
});

it("pins the operator-reviewed peer and keeps the admitted verdict through restart", async () => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  const output: string[] = [];
  const card = peer.card;
  await expect(
    daemon.pinPeer({
      directory: o.directory,
      card,
      print: (line) => output.push(line),
      async confirm() {
        expect(output.join("\n")).toContain(card.actorKey.kid);
        expect(output.join("\n")).toContain(card.partyKey.kid);
        expect(output.join("\n")).toContain(card.notice);
        return true;
      },
    }),
  ).resolves.toBe(true);
  const { jws } = await craftSigned(peer, {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:uuid:00000000-0000-4000-8000-000000000043",
    conversation: "urn:uuid:00000000-0000-4000-8000-100000000043",
    kind: "describe",
    from: { actor: peer.identity.actor },
    to: { actor: o.agentWebId },
    createdAt: now().toISOString(),
    expiresAt: "2026-10-19T09:00:00Z",
    body: {},
  });
  const direct = createDirectReader(
    { inboxes: new Map(), accepted: new Map() },
    new RecordingTokenProvider(),
  );
  const input = {
    binding: "direct",
    account: "fixture",
    message: direct.ingest.parse({ id: "message", raw: encodeEnvelope(jws) }),
  };
  const first = await daemon.openGate(o);
  const verdict = await first.check(input);
  await first.close();
  expect(verdict.outcome).toBe("admitted");
  const reopened = await daemon.openGate({ ...o, now: () => new Date("2026-10-20T08:00:00Z") });
  try {
    expect(await reopened.check(input)).toEqual(verdict);
    const status = await reopened.status();
    expect(status.peers).toContainEqual({
      subject: peer.identity.actor,
      thumbprint: card.actorKey.kid,
    });
    expect(status.ledger.ok).toBe(true);
    expect(status.verdicts).toEqual({ admitted: 1, refused: 0, unstructured: 0 });
    expect(JSON.stringify(status)).not.toContain(jws);
  } finally {
    await reopened.close();
  }
});

it("runs gate commands offline and takes the process lease only after confirmation", async () => {
  const stateDirectory = await mkdtemp(join(root, "state-"));
  const o = options();
  const local = daemon.createLocalState(stateDirectory);
  const composition = vi.fn(async () => {
    throw new Error("CLI gate commands are local");
  });
  const host = daemon.createCliHost({
    gate: { stateDirectory, agentWebId, ownerWebId },
    daemon: composition,
    local,
    ledger: new MemoryLedger(),
    launchCommand: ["/node", "run"],
    accounts: async () => [],
    openLoginUrl: vi.fn(),
    credentials: {
      store: new CredentialStore({ dir: stateDirectory }),
      transport: noTransport,
      now,
    },
  });
  const existing = await readdir(stateDirectory);
  const print = vi.fn();
  const io = {
    print,
    signal: new AbortController().signal,
    async confirm() {
      expect(await readdir(stateDirectory)).toEqual(existing);
      return true;
    },
  };
  expect(await daemon.runCli(["gate", "init", "--owner-dir", o.ownerDir], host, io)).toBe(0);
  expect(await readdir(stateDirectory)).toEqual(["gate", ...existing].sort());
  const { peer, gate } = await createTestGate();
  await gate.close();
  const cardPath = join(root, "peer.json");
  await writeFile(cardPath, JSON.stringify(peer.card), { mode: 0o600 });
  expect(await daemon.runCli(["gate", "pin", cardPath], host, { ...io, confirm: approve })).toBe(0);
  expect(await daemon.runCli(["gate", "status"], host, io)).toBe(0);
  const status = JSON.parse(print.mock.lastCall?.[0] ?? "{}");
  expect(status).toMatchObject({
    peers: expect.arrayContaining([
      { subject: peer.identity.actor, thumbprint: peer.actorKey.kid },
    ]),
    ledger: { ok: true, entries: 0 },
    verdicts: { admitted: 0, unstructured: 0, refused: 0 },
  });
  expect(composition).not.toHaveBeenCalled();
});
