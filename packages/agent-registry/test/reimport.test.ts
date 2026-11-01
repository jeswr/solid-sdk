// AUTHORED-BY Codex GPT-6
import type { Account as PodAccount } from "@jeswr/agent-model";
import { fromRdf, recordFromTurtle, recordToTurtle, toRdf } from "@jeswr/agent-model/rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { readFile } from "fs/promises";
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { importRegistry } from "../src/importer.js";
import { FixedSaltProvider, MemoryRegistryReader, MemoryStorageClient } from "../src/testing.js";

const config = {
  registryPath: "/synthetic/registry.yaml",
  storageRoot: "https://pod.example/",
  ownerWebId: "https://owner.example/profile#me",
};
const fixture = await readFile(
  new URL("./fixtures/registry.synthetic.yaml", import.meta.url),
  "utf8",
);
const input = {
  version: 1,
  observedAt: "2026-10-20",
  accounts: [
    {
      id: "fixture-account",
      channel: "email",
      provider: "google",
      organization: "personal",
      identifiers: { primary: "alice@example.com", aliases: ["bob@example.org"] },
      credential_ref: ["profile:fixture", "op://test-vault/account-01/credential"],
      connector: { target: "gmail", setup_status: "planned", last_tested: "2026-10-19" },
    },
  ],
};
function harness(text = stringify(input)) {
  return {
    reader: new MemoryRegistryReader(config.registryPath, text),
    salt: new FixedSaltProvider(),
    storage: new MemoryStorageClient(),
  };
}
async function readAccount(storage: MemoryStorageClient, url: string): Promise<PodAccount> {
  const stored = await storage.read(url);
  if (!stored) throw new Error("Fixture account absent");
  const account = await recordFromTurtle(stored.body, url);
  if (account.type !== "account") throw new Error("Expected account");
  return account;
}
async function editAccount(ports: ReturnType<typeof harness>) {
  await importRegistry(config, ports);
  const url = [...ports.storage.resources.keys()][0];
  if (!url) throw new Error("Fixture account absent");
  const account = await readAccount(ports.storage, url);
  const edited: PodAccount = {
    ...account,
    label: "Owner label",
    bindingState: "disabled",
    restrictions: { read: true, triage: true, draft: true, send: true },
  };
  await ports.storage.writeRdf(url, new Store([...toRdf(edited)]), {
    ifMatch: ports.storage.resources.get(url)?.etag,
  });
  return { url, edited };
}

describe("shared account RDF and inventory reconciliation", () => {
  it.each([
    { name: "full synthetic fixture", text: fixture },
    { name: "multiple handles and references", text: stringify(input) },
  ])("decodes every written account with agent-model: $name", async ({ text }) => {
    const ports = harness(text);
    const report = await importRegistry(config, ports);
    expect(ports.storage.resources.size).toBe(report.settings.connections.length);
    for (const account of report.settings.connections) {
      const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
      const stored = ports.storage.resources.get(url);
      if (!stored) throw new Error("Fixture account absent");
      const decoded = fromRdf(stored.dataset, url);
      expect(await recordFromTurtle(stored.body, url)).toEqual(decoded);
      expect(decoded).toEqual({
        type: "account",
        id: url,
        channel: account.channel,
        provider: account.provider,
        organisation: account.organisation,
        ...(account.channelHandles[0] ? { channelHandleHash: account.channelHandles[0] } : {}),
        ...(account.credentialRefs[0] ? { credentialRef: account.credentialRefs[0] } : {}),
        bindingState: account.bindingState,
        restrictions: account.restrictions,
        inventory: {
          ...account.inventory,
          channelHandles: account.channelHandles,
          credentialRefs: account.credentialRefs,
          evidence: account.evidence,
          identityConflicts: account.identityConflicts,
        },
      });
    }
  });
  it("leaves owner-edited settings, bytes and ETag untouched for unchanged YAML", async () => {
    const ports = harness();
    const { url, edited } = await editAccount(ports);
    const before = await ports.storage.read(url);
    const write = vi.spyOn(ports.storage, "writeRdf");
    const report = await importRegistry(config, ports);
    expect(report).toMatchObject({ imported: 0, updated: 0, unchanged: 2 });
    expect(write).not.toHaveBeenCalled();
    expect(await ports.storage.read(url)).toEqual(before);
    expect(await readAccount(ports.storage, url)).toEqual(edited);
    expect(report.settings.connections[0]).toMatchObject({
      bindingState: edited.bindingState,
      restrictions: edited.restrictions,
    });
  });
  it("treats different Turtle formatting and structural blank nodes as unchanged", async () => {
    const ports = harness();
    const { url, edited } = await editAccount(ports);
    const item = ports.storage.resources.get(url);
    if (!item) throw new Error("Fixture account absent");
    item.body = `# Owner formatting\n${await recordToTurtle(edited)}`;
    const childIds = [...new Set([...toRdf(edited)].map((quad) => quad.subject.value))].filter(
      (id) => id !== url,
    );
    childIds.forEach((id, index) => {
      item.body = item.body.replaceAll(`<${id}>`, `_:child${index}`);
    });
    const before = await ports.storage.read(url);
    const write = vi.spyOn(ports.storage, "writeRdf");
    expect(await importRegistry(config, ports)).toMatchObject({ updated: 0, unchanged: 2 });
    expect(write).not.toHaveBeenCalled();
    expect(await ports.storage.read(url)).toEqual(before);
  });
  it("refreshes inventory while preserving owner settings and using the read ETag", async () => {
    const ports = harness();
    const { url, edited } = await editAccount(ports);
    const etag = ports.storage.resources.get(url)?.etag;
    const write = vi.spyOn(ports.storage, "writeRdf");
    const changed = stringify({
      ...input,
      accounts: input.accounts.map((account) => ({
        ...account,
        organization: "Example College",
        identifiers: { primary: "corrected@example.org" },
        credential_ref: ["profile:corrected"],
        connector: { ...account.connector, setup_status: "connected" },
      })),
    });
    const report = await importRegistry(config, {
      ...ports,
      reader: new MemoryRegistryReader(config.registryPath, changed),
    });
    expect(report).toMatchObject({ imported: 0, updated: 1, unchanged: 1 });
    expect(write).toHaveBeenCalledExactlyOnceWith(url, expect.any(Store), { ifMatch: etag });
    const restored = await readAccount(ports.storage, url);
    expect(restored).toMatchObject({
      organisation: "Example College",
      label: edited.label,
      restrictions: edited.restrictions,
      bindingState: edited.bindingState,
      credentialRef: "profile:corrected",
      inventory: { setupStatus: "connected", credentialRefs: ["profile:corrected"] },
    });
    expect(restored.channelHandleHash).not.toBe(edited.channelHandleHash);
    expect(report.settings.connections[0]?.restrictions).toEqual(edited.restrictions);
    write.mockClear();
    expect(
      await importRegistry(config, {
        ...ports,
        reader: new MemoryRegistryReader(config.registryPath, changed),
      }),
    ).toMatchObject({ updated: 0, unchanged: 2 });
    expect(write).not.toHaveBeenCalled();
  });
  it("requires an ETag for a valid account when its inventory needs updating", async () => {
    const ports = harness();
    const { url } = await editAccount(ports);
    const item = ports.storage.resources.get(url);
    if (!item) throw new Error("Fixture account absent");
    item.etag = "";
    const body = item.body;
    const write = vi.spyOn(ports.storage, "writeRdf");
    await expect(
      importRegistry(config, {
        ...ports,
        reader: new MemoryRegistryReader(
          config.registryPath,
          stringify({ ...input, observedAt: "2026-10-21" }),
        ),
      }),
    ).rejects.toThrow("Registry storage operation failed");
    expect(write).not.toHaveBeenCalled();
    expect(item.body).toBe(body);
  });
  it.each([
    "malformed",
    "wrong-type",
    "wrong-boolean",
    "ambiguous-boolean",
    "missing-boolean",
  ])("rejects %s stored content without replacing owner data", async (kind) => {
    const ports = harness();
    const { url } = await editAccount(ports);
    const item = ports.storage.resources.get(url);
    if (!item) throw new Error("Fixture account absent");
    if (kind === "malformed") item.body = "invalid RDF [";
    if (kind === "wrong-type")
      item.body = await recordToTurtle({
        type: "conversation-turn",
        id: url,
        conversation: "urn:test:conversation",
        attributedTo: "urn:test:owner",
        role: "owner",
        text: "",
        createdAt: "2026-10-20T00:00:00Z",
        refersToProposal: [],
      });
    if (kind === "wrong-boolean")
      item.body = item.body.replace("agent:read true", 'agent:read "true"');
    if (kind === "ambiguous-boolean")
      item.body = item.body.replace("agent:read true", "agent:read true, false");
    if (kind === "missing-boolean") item.body = item.body.replace("agent:read true;", "");
    const before = item.body;
    const write = vi.spyOn(ports.storage, "writeRdf");
    await expect(importRegistry(config, ports)).rejects.toThrow(
      "Registry storage operation failed",
    );
    expect(write).not.toHaveBeenCalled();
    expect(item.body).toBe(before);
  });
});
