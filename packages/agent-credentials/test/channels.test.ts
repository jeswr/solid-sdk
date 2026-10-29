// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6
import type { AccountRef, RenderableProposal, TokenProvider } from "@jeswr/agent-channels";
import { DIRECT } from "@jeswr/agent-channels";
import { createInMemoryDirectBinding } from "@jeswr/agent-channels/testing";
import { generateKeyPairSync, sign, verify } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CredentialStore, StoreTokenProvider } from "../src/index.js";
import { provisionValue } from "../src/provision.js";

let base: string;
let store: CredentialStore;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "credentials-channels-"));
  store = new CredentialStore({ dir: join(base, "store") });
  for (const purpose of ["read", "send"] as const)
    provisionValue({
      store,
      provider: "slack",
      account: "owner",
      purpose,
      reference: `op://fixture/${purpose}/token`,
      value: `test-${purpose}-token-0123456789`,
      now: new Date("2026-10-26T12:00:00Z"),
    });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

it("implements the channel contract and supplies separate read/send files to the direct binding", async () => {
  // This assignment is also checked by the package's test TypeScript gate.
  const p: import("@jeswr/agent-channels").TokenProvider = new StoreTokenProvider("slack", {
    store,
  });
  const read = vi.spyOn(p, "read");
  const send = vi.spyOn(p, "send");
  const key = generateKeyPairSync("ed25519");
  const message: RenderableProposal["message"] = {
    profile: "https://agent.example/profile",
    configuration: "https://agent.example/config",
    id: "urn:example:message:1",
    conversation: "urn:example:conversation:1",
    kind: "describe",
    from: { actor: "https://sender.example/agent" },
    to: { actor: "https://receiver.example/agent" },
    createdAt: "2026-10-26T11:00:00Z",
    expiresAt: "2026-10-26T13:00:00Z",
    body: {},
  };
  const payload = `${Buffer.from('{"alg":"EdDSA"}').toString("base64url")}.${Buffer.from(JSON.stringify(message)).toString("base64url")}`;
  const compactJws = `${payload}.${sign(null, Buffer.from(payload), key.privateKey).toString("base64url")}`;
  const binding = createInMemoryDirectBinding({
    tokens: p,
    now: () => Date.parse("2026-10-26T12:00:00Z"),
    verify: async (jws) => {
      expect(jws).toBe(compactJws);
      const [header, body, signature] = jws.split(".") as [string, string, string];
      expect(
        verify(
          null,
          Buffer.from(`${header}.${body}`),
          key.publicKey,
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true);
      return JSON.parse(Buffer.from(body, "base64url").toString());
    },
  });
  const account = { id: "owner" };
  const wire = await binding.send.render({ message, compactJws }, DIRECT);
  expect(await binding.send.transmit(wire, { account, tokens: p, dryRun: false })).toMatchObject({
    outcome: "accepted",
  });
  expect(read).not.toHaveBeenCalled();
  expect(await send.mock.results[0]?.value).toEqual({
    access: "send",
    accessToken: "test-send-token-0123456789",
  });
  expect(
    (await binding.ingest.list(account, undefined, { maxItems: 10, maxBytes: 65536 })).items,
  ).toEqual([{ id: message.id, raw: wire.bytes }]);
  expect(send).toHaveBeenCalledExactlyOnceWith(account);
  expect(read).toHaveBeenCalledExactlyOnceWith(account);
  expect(await read.mock.results[0]?.value).toEqual({
    access: "read",
    accessToken: "test-read-token-0123456789",
  });
});

it.each([
  "read",
  "send",
] as const)("snapshots the account id once for %s and refuses malformed references", async (purpose) => {
  const tokens: TokenProvider = new StoreTokenProvider("slack", { store });
  const id = vi.fn().mockReturnValueOnce("owner").mockReturnValue("other");
  expect(
    await tokens[purpose]({
      get id() {
        return id();
      },
    }),
  ).toEqual({ access: purpose, accessToken: `test-${purpose}-token-0123456789` });
  expect(id).toHaveBeenCalledOnce();
  for (const account of [
    null,
    undefined,
    "owner",
    {},
    { id: "" },
    { id: 1 },
    { id: "a".repeat(2049) },
    {
      get id() {
        throw new Error("test-secret");
      },
    },
  ]) {
    await expect(tokens[purpose](account as AccountRef)).rejects.toMatchObject({
      code: "invalid",
      message: "invalid account reference",
    });
  }
});
