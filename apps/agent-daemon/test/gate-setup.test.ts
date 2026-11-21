// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.2 Sol

import { MemoryLedger } from "@jeswr/agent-audit";
import { encodeEnvelope, encodeEventContent } from "@jeswr/agent-channels";
import { createDirectReader } from "@jeswr/agent-channels/direct";
import { parseMatrixMessage } from "@jeswr/agent-channels/matrix";
import { RecordingTokenProvider } from "@jeswr/agent-channels/testing";
import { CredentialStore, noTransport } from "@jeswr/agent-credentials";
import { CONFIG_ED25519, PILOT_PROFILE } from "@jeswr/agent-reference";
import { craftSigned } from "@jeswr/agent-reference/scenarios/common";
import { mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { event } from "../../../packages/agent-channels/test/fixtures/matrix.js";
import { readGateStatus } from "../src/gate.js";
import * as daemon from "../src/index.js";
import { createTestGate } from "../src/testing.js";

vi.mock("fs/promises", async (original) => {
  const fs = await original<typeof import("fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "brief-41-"));
});
afterEach(async () => {
  vi.mocked(open).mockReset();
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

it("rejects a nested key subject that names the daemon's own actor", async () => {
  const o = options();
  const { peer, gate } = await createTestGate();
  await gate.close();
  await daemon.initGate(o);
  const card = { ...peer.card, actorKey: { ...peer.card.actorKey, subject: o.agentWebId } };
  const confirm = vi.fn(approve);
  await expect(daemon.pinPeer({ directory: o.directory, card, confirm })).rejects.toThrow(
    /subject/,
  );
  expect(confirm).not.toHaveBeenCalled();
  expect((await readGateStatus(o.directory)).peers).toEqual([]);
});

it("atomically replaces trust.json and preserves the previously opened pins", async () => {
  const o = options();
  const { peer, gate } = await createTestGate();
  await gate.close();
  await daemon.initGate(o);
  const path = join(o.directory, "trust.json");
  const previous = await open(path, "r");
  try {
    const before = await readFile(path, "utf8");
    expect(await daemon.pinPeer({ ...o, card: peer.card })).toBe(true);
    expect(await previous.readFile("utf8")).toBe(before);
    expect(await readFile(path, "utf8")).toContain(peer.actorKey.kid);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally {
    await previous.close();
  }
});

it.each([
  { outcome: "checking", reason: "result-uncertain" },
  { outcome: "refused", reason: "bad-signature" },
])("preserves a $outcome verdict when a Matrix bridge retry hides its carrier", async ({
  outcome,
  reason,
}) => {
  const o = options();
  await daemon.initGate(o);
  const gate = await daemon.openGate(o);
  try {
    const native = event("$signed", {
      msgtype: "m.text",
      body: "Fixture",
      ...encodeEventContent("a.b.c"),
    });
    const item = { id: native.event_id, raw: JSON.stringify(native) };
    const first = parseMatrixMessage(item);
    const retry = parseMatrixMessage({
      ...item,
      native: JSON.stringify({ bridge: "signal", event: native }),
    });
    expect(first.jsonLdBlocks).toHaveLength(1);
    expect(retry.jsonLdBlocks).toBeUndefined();
    expect(retry.rawSha256).toBe(first.rawSha256);
    const stored = JSON.stringify({
      outcome,
      ...(outcome === "refused" ? { reason } : {}),
      time: now().toISOString(),
    });
    const path = join(o.directory, `verdict-${first.rawSha256}.json`);
    await writeFile(path, stored, { mode: 0o600 });
    expect(
      await gate.check({ binding: "matrix", account: "fixture", message: retry }),
    ).toMatchObject({
      outcome: "refused",
      reason,
    });
    expect(await readFile(path, "utf8")).toBe(stored);
  } finally {
    await gate.close();
  }
});

it("records an indeterminate check for a malformed verdict in the gate ledger", async () => {
  const o = options();
  await daemon.initGate(o);
  const gate = await daemon.openGate(o);
  const message = parseMatrixMessage({ id: "$one", raw: JSON.stringify(event()) });
  try {
    await writeFile(join(o.directory, `verdict-${message.rawSha256}.json`), "{", { mode: 0o600 });
    expect(
      await gate.check({
        binding: "matrix",
        account: "fixture",
        message: { ...message, jsonLdBlocks: [encodeEnvelope("a.b.c")] },
      }),
    ).toMatchObject({ outcome: "refused", reason: "indeterminate" });
    const lines = (await readFile(join(o.directory, "ledger.jsonl"), "utf8")).trimEnd().split("\n");
    expect(JSON.parse(lines.at(-1) as string).record).toMatchObject({
      type: "binding-rejection",
      binding: "matrix",
      reason: "indeterminate",
      digest: `sha-256:${message.rawSha256}`,
    });
  } finally {
    await gate.close();
  }
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

async function signedInput(
  o: ReturnType<typeof options>,
  peer: Awaited<ReturnType<typeof createTestGate>>["peer"],
) {
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
  return {
    jws,
    input: {
      binding: "direct",
      account: "fixture",
      message: direct.ingest.parse({ id: "message", raw: encodeEnvelope(jws) }),
    },
  };
}

it("refuses retries after the final verdict directory sync fails", async () => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  await daemon.pinPeer({ ...o, card: peer.card });
  const { input } = await signedInput(o, peer);
  const gate = await daemon.openGate(o);
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  let directorySyncs = 0;
  const failSync = vi.fn(async () => {
    throw new Error("directory fsync failed");
  });
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    const handle = await fs.open(path, flags, mode);
    if (path === o.directory && ++directorySyncs === 2) handle.sync = failSync;
    return handle;
  });
  try {
    expect(await gate.check(input)).toMatchObject({ outcome: "refused", reason: "indeterminate" });
    expect(failSync).toHaveBeenCalledOnce();
    expect(await gate.check(input)).toMatchObject({
      outcome: "refused",
      reason: "result-uncertain",
    });
  } finally {
    await gate.close();
  }
  const reopened = await daemon.openGate(o);
  try {
    expect(await reopened.check(input)).toMatchObject({
      outcome: "refused",
      reason: "result-uncertain",
    });
  } finally {
    await reopened.close();
  }
});

it("holds a legacy cached admission that carries no positive admission evidence", async () => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  const { input } = await signedInput(o, peer);
  await writeFile(
    join(o.directory, `verdict-${input.message.rawSha256}.json`),
    JSON.stringify({
      outcome: "admitted",
      time: now().toISOString(),
      messageId: "urn:test:legacy",
      conversation: "urn:test:conversation",
    }),
    { mode: 0o600 },
  );
  const gate = await daemon.openGate(o);
  try {
    expect(await gate.check(input)).toMatchObject({
      outcome: "refused",
      reason: "result-uncertain",
    });
  } finally {
    await gate.close();
  }
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
  const { input, jws } = await signedInput(o, peer);
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
