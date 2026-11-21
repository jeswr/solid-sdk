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
import { readLedgerSegment } from "@jeswr/agent-reference/store/ledger";
import { mkdtemp, open, readdir, readFile, rm, stat, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { event } from "../../../packages/agent-channels/test/fixtures/matrix.js";
import { readGateStatus } from "../src/gate.js";
import * as daemon from "../src/index.js";
import { createTestGate } from "../src/testing.js";

vi.mock("fs/promises", async (original) => {
  const fs = await original<typeof import("fs/promises")>();
  return { ...fs, open: vi.fn(fs.open), unlink: vi.fn(fs.unlink) };
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "brief-41-"));
});
afterEach(async () => {
  vi.mocked(open).mockReset();
  vi.mocked(unlink).mockReset();
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

it("allows another pin after the new lease fails to sync", async () => {
  const o = options();
  const { peer, gate } = await createTestGate();
  await gate.close();
  await daemon.initGate(o);
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  const lock = join(o.directory, "pin.lock");
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    const handle = await fs.open(path, flags, mode);
    if (path === lock && flags === "wx")
      handle.sync = async () => {
        throw new Error("pin lease sync failed");
      };
    return handle;
  });
  await expect(daemon.pinPeer({ ...o, card: peer.card })).rejects.toThrow("pin lease sync failed");
  vi.mocked(open).mockReset();
  await expect(stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(daemon.pinPeer({ ...o, card: peer.card })).resolves.toBe(true);
});

it("keeps both pins when two operators confirm concurrently", async () => {
  const o = options();
  await daemon.initGate(o);
  const peers = await Promise.all(
    ["first", "second"].map(async (name) => {
      const directory = join(root, name);
      await daemon.initGate({
        ...o,
        directory,
        agentWebId: `https://${name}.example/actor#id`,
        ownerWebId: `https://${name}.example/owner#id`,
      });
      return JSON.parse(await readFile(join(directory, "card.json"), "utf8"));
    }),
  );
  let confirmations = 0;
  let release!: () => void;
  const bothConfirmed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const confirm = async () => {
    if (++confirmations === peers.length) release();
    await bothConfirmed;
    return true;
  };
  expect(await Promise.all(peers.map((card) => daemon.pinPeer({ ...o, card, confirm })))).toEqual([
    true,
    true,
  ]);
  expect(
    (await readGateStatus(o.directory)).peers.map(({ thumbprint }) => thumbprint).sort(),
  ).toEqual(peers.flatMap(({ actorKey, partyKey }) => [actorKey.kid, partyKey.kid]).sort());
});

it.each([
  { outcome: "checking" },
  { outcome: "refused", reason: "bad-signature" },
])("holds an uncommitted $outcome verdict across Matrix bridge hints", async (verdict) => {
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
    expect(retry.jsonLdBlocks).toEqual(first.jsonLdBlocks);
    expect(retry.rawSha256).toBe(first.rawSha256);
    const stored = JSON.stringify({
      ...verdict,
      time: now().toISOString(),
    });
    const path = join(o.directory, `verdict-${first.rawSha256}.json`);
    await writeFile(path, stored, { mode: 0o600 });
    expect(
      await gate.check({ binding: "matrix", account: "fixture", message: retry }),
    ).toMatchObject({
      outcome: "refused",
      reason: "result-uncertain",
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
    const entries = readLedgerSegment(join(o.directory, "ledger.jsonl"));
    expect(entries.at(-1)?.record).toMatchObject({
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
  // The ledger is held as RDF: change a digest recorded in a sealed record in place.
  expect(JSON.stringify(readLedgerSegment(ledger).map((entry) => entry.record))).toContain(
    rawSha256,
  );
  const text = await readFile(ledger, "utf8");
  const altered = text.replace(rawSha256, "c".repeat(64));
  expect(altered).not.toBe(text);
  await writeFile(ledger, altered);
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

it.each([
  "admitted",
  "unstructured",
  "refused",
])("syncs the verdict directory after publishing the commit before returning %s", async (outcome) => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  await daemon.pinPeer({ ...o, card: peer.card });
  const { input } = await signedInput(o, peer);
  if (outcome !== "admitted") {
    input.message = {
      ...input.message,
      jsonLdBlocks: outcome === "refused" ? ['{"@type":"agent:SignedMessage"}'] : [],
    };
  }
  const gate = await daemon.openGate(o);
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  const commit = `verdict-${input.message.rawSha256}.commit`;
  let committed = false;
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    const handle = await fs.open(path, flags, mode);
    if (path === o.directory) {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        const files = await fs.readdir(o.directory);
        await sync();
        if (files.includes(commit)) committed = true;
      };
    }
    return handle;
  });
  try {
    expect(await gate.check(input)).toMatchObject({ outcome });
    expect(committed).toBe(true);
  } finally {
    await gate.close();
  }
});

it.each([
  { published: false, unlinkFails: false },
  { published: true, unlinkFails: false },
  { published: true, unlinkFails: true },
])("holds a verdict after sync failure (commit published: $published, unlink fails: $unlinkFails)", async ({
  published,
  unlinkFails,
}) => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  await daemon.pinPeer({ ...o, card: peer.card });
  const { input } = await signedInput(o, peer);
  const gate = await daemon.openGate(o);
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  const base = `verdict-${input.message.rawSha256}`;
  const commit = join(o.directory, `${base}.commit`);
  if (unlinkFails) {
    vi.mocked(unlink).mockImplementation(async (path) => {
      if (path === commit) throw new Error("commit cleanup failed");
      await fs.unlink(path);
    });
  }
  let failed = false;
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    if (failed && flags === "wx") throw new Error("cannot create another temporary file");
    const handle = await fs.open(path, flags, mode);
    if (path === o.directory) {
      const record = JSON.parse(await fs.readFile(join(o.directory, `${base}.json`), "utf8"));
      const files = await fs.readdir(o.directory);
      if (record.outcome === "admitted" && files.includes(`${base}.commit`) === published) {
        handle.sync = async () => {
          failed = true;
          throw new Error("directory fsync failed");
        };
      }
    }
    return handle;
  });
  try {
    expect(await gate.check(input)).toMatchObject({ outcome: "refused", reason: "indeterminate" });
    expect(failed).toBe(true);
    if (unlinkFails) {
      expect(unlink).toHaveBeenCalledWith(commit);
      expect((await stat(commit)).isFile()).toBe(true);
    }
    expect(await gate.check(input)).toMatchObject({
      outcome: "refused",
      reason: "result-uncertain",
    });
  } finally {
    await gate.close();
    vi.mocked(open).mockReset();
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

it.each([
  true,
  false,
])("checks a Matrix carrier across bridge hints (hint first: %s)", async (hintFirst) => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  await daemon.pinPeer({ ...o, card: peer.card });
  const { jws } = await signedInput(o, peer);
  const native = event("$signed", {
    msgtype: "m.text",
    body: "Fixture",
    ...encodeEventContent(jws),
  });
  const item = { id: native.event_id, raw: JSON.stringify(native) };
  const hint = JSON.stringify({ bridge: "signal", event: native });
  const base = { binding: "matrix", account: "fixture" };
  const gate = await daemon.openGate(o);
  const first = await gate.check({
    ...base,
    message: parseMatrixMessage({ ...item, native: hintFirst ? hint : undefined }),
  });
  await gate.close();
  expect(first).toMatchObject({ outcome: "admitted" });
  const reopened = await daemon.openGate(o);
  try {
    expect(
      await reopened.check({
        ...base,
        message: parseMatrixMessage({ ...item, native: hintFirst ? undefined : hint }),
      }),
    ).toEqual(first);
  } finally {
    await reopened.close();
  }
});

it.each([2, 3, 5])("refuses retries when verdict directory sync %i fails", async (failure) => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  await daemon.pinPeer({ ...o, card: peer.card });
  const { input } = await signedInput(o, peer);
  const gate = await daemon.openGate(o);
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  let directorySyncs = 0;
  let outcomeDuringSync: string | undefined;
  const verdictPath = join(o.directory, `verdict-${input.message.rawSha256}.json`);
  const failSync = vi.fn(async () => {
    outcomeDuringSync = JSON.parse(await fs.readFile(verdictPath, "utf8")).outcome;
    throw new Error("directory fsync failed");
  });
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    const handle = await fs.open(path, flags, mode);
    if (path === o.directory && ++directorySyncs === failure) handle.sync = failSync;
    return handle;
  });
  try {
    expect(await gate.check(input)).toMatchObject({ outcome: "refused", reason: "indeterminate" });
    expect(failSync).toHaveBeenCalledOnce();
    expect(outcomeDuringSync).toBe(failure === 2 ? "checking" : "admitted");
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

it.each([
  "warning",
  "parser refusal",
])("scopes a first account's parity %s across restarts", async (mode) => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  await daemon.pinPeer({ ...o, card: peer.card });
  const { input, jws } = await signedInput(o, peer);
  const mismatch = {
    ...input,
    binding: "email-mime",
    account: "different-footer",
    message: { ...input.message, warnings: ["human-parity-unverified"] },
  };
  const matching = { ...input, binding: "email-mime", account: "matching-footer" };
  const gate = await daemon.openGate(o);
  try {
    const decision =
      mode === "warning"
        ? await gate.check(mismatch)
        : await gate.recordParseRefusal({
            binding: mismatch.binding,
            account: mismatch.account,
            raw: encodeEnvelope(jws),
            reason: "human-parity-mismatch",
          });
    expect(decision).toMatchObject({
      outcome: "refused",
      reason: "human-parity-mismatch",
    });
    expect((await gate.status()).verdicts).toEqual({ admitted: 0, refused: 1, unstructured: 0 });
  } finally {
    await gate.close();
  }
  const reopened = await daemon.openGate(o);
  try {
    expect(await reopened.check(matching)).toMatchObject({ outcome: "admitted" });
    expect(await reopened.check({ ...mismatch, message: input.message })).toMatchObject({
      outcome: "refused",
      reason: "human-parity-mismatch",
    });
    expect(await reopened.check(matching)).toMatchObject({ outcome: "admitted" });
  } finally {
    await reopened.close();
  }
});

it.each([
  undefined,
  true,
])("holds a legacy cached admission without a commit (verified: %s)", async (verified) => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  const { input } = await signedInput(o, peer);
  await writeFile(
    join(o.directory, `verdict-${input.message.rawSha256}.json`),
    JSON.stringify({
      outcome: "admitted",
      verified,
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

it("holds a legacy shared parity refusal without a commit record", async () => {
  const o = options();
  const { peer, gate: memory } = await createTestGate();
  await memory.close();
  await daemon.initGate(o);
  await daemon.pinPeer({ ...o, card: peer.card });
  const { input } = await signedInput(o, peer);
  await writeFile(
    join(o.directory, `verdict-${input.message.rawSha256}.json`),
    JSON.stringify({
      outcome: "refused",
      reason: "human-parity-mismatch",
      time: now().toISOString(),
    }),
    { mode: 0o600 },
  );
  const gate = await daemon.openGate(o);
  try {
    const { jsonLdBlocks: _, ...unstructured } = input.message;
    expect(await gate.check({ ...input, message: unstructured })).toMatchObject({
      outcome: "refused",
      reason: "result-uncertain",
    });
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
