// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer forbids scheme imports
import { mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import {
  DENY_ALL,
  FileRegistryReader,
  hashHandle,
  importRegistry,
  inventorySettings,
  MAX_REGISTRY_BYTES,
  parseRegistryYaml,
  parseSnapshot,
} from "../src/index.js";
import { AGENT } from "../src/rdf.js";
import { FixedSaltProvider, MemoryRegistryReader, MemoryStorageClient } from "../src/testing.js";

const fixturePath = new URL("./fixtures/registry.synthetic.yaml", import.meta.url);
const fixture = await readFile(fixturePath, "utf8");
const config = {
  registryPath: "/synthetic/registry.yaml",
  storageRoot: "https://pod.example/",
  ownerWebId: "https://owner.example/profile#me",
};
function harness(text = fixture) {
  return {
    reader: new MemoryRegistryReader(config.registryPath, text),
    salt: new FixedSaltProvider(),
    storage: new MemoryStorageClient(),
  };
}
const term = DataFactory.namedNode;

describe("synthetic registry import", () => {
  it("imports 28 accounts plus a default-deny Telegram bot as typed RDF, with ACLs first", async () => {
    const ports = harness();
    const report = await importRegistry(config, ports);
    expect(report).toMatchObject({ imported: 29, updated: 0, unchanged: 0 });
    expect(report.settings.connections).toHaveLength(29);
    const telegram = report.settings.connections.filter((a) => a.channel === "telegram");
    expect(telegram).toMatchObject([
      { provider: "telegram_bot", restrictions: DENY_ALL, credentialRefs: [] },
    ]);
    expect(
      report.settings.connections.find((a) => a.organisation === "ODI" && a.channel === "email")
        ?.provider,
    ).toBe("google_workspace");
    expect(
      report.settings.connections.find(
        (a) => a.organisation === "ODI" && a.channel === "microsoft_teams",
      )?.provider,
    ).toBe("microsoft");
    const mainHash = hashHandle("gmail-main@example.com", await ports.salt.getSalt());
    const main = report.settings.connections.find((a) => a.channelHandles.includes(mainHash));
    expect(main).toMatchObject({
      bindingState: "error",
      identityConflicts: [
        {
          kind: "identity-mismatch",
          handleHashes: expect.arrayContaining([
            mainHash,
            hashHandle("alternate-main@example.org", await ports.salt.getSalt()),
          ]),
        },
      ],
    });
    expect(report.settings.connections.every((a) => a.bindingState !== "connected")).toBe(true);
    const mainUrl = `https://pod.example/agent/accounts/${main?.id}.ttl`;
    expect(
      ports.storage.resources
        .get(mainUrl)
        ?.dataset.getObjects(term(mainUrl), term(`${AGENT}identityConflict`), null)
        .map((v) => JSON.parse(v.value)),
    ).toEqual(main?.identityConflicts);
    expect(ports.storage.events[0]).toEqual({
      operation: "acl",
      url: "https://pod.example/agent/accounts/",
    });
    for (const [url, resource] of ports.storage.resources) {
      const events = ports.storage.events.filter((e) => e.url === url);
      expect(events.map((e) => e.operation)).toEqual(["read", "acl", "write"]);
      expect(ports.storage.acls.get(url)).toEqual({
        owner: config.ownerWebId,
        public: false,
        modes: ["Read", "Write", "Control"],
      });
      expect(
        resource.dataset.countQuads(
          term(url),
          term("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          term(`${AGENT}Account`),
          null,
        ),
      ).toBe(1);
      const ref = resource.dataset.getObjects(term(url), term(`${AGENT}restrictions`), null)[0];
      if (!ref) throw new Error("Restrictions node absent");
      for (const cap of ["read", "triage", "draft", "send"]) {
        expect(
          resource.dataset.getObjects(ref, term(AGENT + cap), null).map((v) => v.value),
        ).toEqual(["false"]);
      }
    }
  });
  it("contains no raw handles in RDF, settings, ACLs, URLs or reports (grep equivalent)", async () => {
    const ports = harness();
    const report = await importRegistry(config, ports);
    const output = JSON.stringify({
      report,
      resources: [...ports.storage.resources],
      acls: [...ports.storage.acls],
      events: ports.storage.events,
    }).toLowerCase();
    const input = parseRegistryYaml(fixture);
    for (const handle of [
      ...input.accounts.flatMap((a) => a.handles),
      "alternate-main@example.org",
    ]) {
      expect(output).not.toContain(handle.toLowerCase());
    }
    expect(output).not.toContain(config.registryPath);
    expect(output).toContain("op://test-vault/account-01/credential");
    expect(output).not.toContain("test-token-0123456789");
  });
  it("re-imports without duplicate resources or redundant content writes", async () => {
    const ports = harness();
    await importRegistry(config, ports);
    const bodies = [...ports.storage.resources].map(([url, item]) => [url, item.body]);
    const repeated = await importRegistry(config, ports);
    expect(repeated).toMatchObject({ imported: 0, updated: 0, unchanged: 29 });
    expect(ports.storage.resources.size).toBe(29);
    expect([...ports.storage.resources].map(([url, item]) => [url, item.body])).toEqual(bodies);
    expect(ports.storage.events.filter((e) => e.operation === "write")).toHaveLength(29);
  });
  it("conditionally updates a changed record at its stable hashed resource URL", async () => {
    const ports = harness();
    await importRegistry(config, ports);
    const changed = fixture.replace(
      'organization: "Example University"',
      'organization: "Example College"',
    );
    const result = await importRegistry(config, {
      ...ports,
      reader: new MemoryRegistryReader(config.registryPath, changed),
    });
    expect(result).toMatchObject({ imported: 0, updated: 1, unchanged: 28 });
    expect(ports.storage.resources.size).toBe(29);
  });
  it("keeps an existing Telegram account without adding a duplicate", () => {
    const snap = parseRegistryYaml(fixture);
    snap.accounts.push({
      id: "telegram-bot",
      channel: "telegram",
      provider: "telegram_bot",
      organisation: "personal",
      handles: [],
      refs: ["profile:telegram-control"],
      setupStatus: "planned",
    });
    expect(
      inventorySettings(snap, new Uint8Array(32)).connections.filter(
        (a) => a.channel === "telegram",
      ),
    ).toHaveLength(1);
  });
  it("redacts handles in metadata and keeps provider conflicts as hashes", () => {
    const snap = parseRegistryYaml(fixture);
    const first = snap.accounts[0];
    if (!first) throw new Error("Fixture account absent");
    first.organisation = "gmail-main@example.com";
    snap.evidence.push({
      channel: "email",
      provider: "microsoft",
      identifier: "GMAIL-MAIN@example.com",
      method: "historic_connector",
      observedOn: "2026-10-20",
    });
    const settings = inventorySettings(snap, new Uint8Array(32));
    expect(settings.connections[0]).toMatchObject({
      organisation: "redacted",
      identityConflicts: expect.arrayContaining([
        expect.objectContaining({ kind: "provider-mismatch" }),
      ]),
    });
    expect(JSON.stringify(settings)).not.toContain("gmail-main@example.com");
  });
});

describe("fail-closed boundaries", () => {
  it.each([
    "version: 1\nversion: 1\naccounts: []",
    "version: 1\naccounts: !!js/function []",
    "version: 1\naccounts: &a []\nnotes: *a",
    "version: 1\naccounts: [",
    "version: 1\naccounts: []\naccess_token: test-token-0123456789",
    "version: 1\naccounts: []\n__proto__: {}",
    "version: 1\naccounts: null",
    "version: 2\naccounts: []",
    "#".repeat(MAX_REGISTRY_BYTES + 1),
  ])("rejects malformed, duplicate, tagged, aliased, oversized or secret-bearing YAML", async (input) => {
    const ports = harness(input);
    await expect(importRegistry(config, ports)).rejects.toThrow();
    expect(ports.storage.events).toEqual([]);
  });
  it("rejects duplicate ids and credential values without disclosing them", async () => {
    for (const content of [
      fixture.replace("id: gmail-secondary", "id: gmail-main"),
      fixture.replace("op://test-vault/account-01/credential", "test-token-0123456789"),
      fixture.replace(
        "op://test-vault/account-01/credential",
        "op://test-vault/gmail-main@example.com/credential",
      ),
    ]) {
      const ports = harness(content);
      await expect(importRegistry(config, ports)).rejects.toThrow(
        /Invalid registry|private identifier/,
      );
      expect(ports.storage.events).toEqual([]);
    }
  });
  it("rejects malformed account fields, unsafe ids, excessive lists and timestamps", () => {
    const baseline = {
      version: 1,
      accounts: [
        {
          id: "test-account",
          channel: "email",
          provider: "google",
          organization: "personal",
          identifiers: { primary: "test-account@example.com" },
          connector: { target: "gmail", setup_status: "connected" },
        },
      ],
    };
    const changes = [
      { id: "../escape" },
      { provider: "https://example.com" },
      { identifiers: { primary: 10 } },
      { identifiers: { primary: Array(11).fill("test-account@example.com") } },
      { access_token: "test-token-0123456789" },
      { connector: { target: "gmail", setup_status: "planned", last_tested: "invalid" } },
      { connector: { target: "gmail", setup_status: "planned", available_in_mcp: "yes" } },
      { credential_ref: "op://missing-field" },
      { id: "telegram-control" },
    ];
    for (const change of changes)
      expect(() =>
        parseSnapshot({ ...baseline, accounts: [{ ...baseline.accounts[0], ...change }] }),
      ).toThrow("Invalid registry schema");
    expect(() =>
      parseSnapshot({ version: 1, accounts: Array(200).fill(baseline.accounts[0]) }),
    ).toThrow();
    expect(() => parseRegistryYaml(stringify({ ...baseline, observedAt: "not-a-date" }))).toThrow();
  });
  it.each([
    new Uint8Array(0),
    new Uint8Array(31),
  ])("refuses missing/short salts before storage writes", async (salt) => {
    const ports = harness();
    await expect(
      importRegistry(config, { ...ports, salt: new FixedSaltProvider(salt) }),
    ).rejects.toThrow();
    expect(ports.storage.events).toEqual([]);
  });
  it("does not disclose reader/salt errors or fall back to a salt", async () => {
    for (const field of ["reader", "salt"] as const) {
      const ports = harness();
      const secretError = new Error("test-token-0123456789");
      if (field === "reader") vi.spyOn(ports.reader, "read").mockRejectedValue(secretError);
      else vi.spyOn(ports.salt, "getSalt").mockRejectedValue(secretError);
      await expect(importRegistry(config, ports)).rejects.toThrow(
        field === "reader" ? "Registry read failed" : "Daemon salt unavailable",
      );
      expect(ports.storage.events).toEqual([]);
    }
  });
  it.each([
    "setAcl",
    "read",
    "writeRdf",
  ] as const)("aborts on %s failure, never emitting secret-bearing transport errors", async (operation) => {
    const ports = harness();
    vi.spyOn(ports.storage, operation).mockRejectedValue(new Error("test-token-0123456789"));
    await expect(importRegistry(config, ports)).rejects.toThrow(
      "Registry storage operation failed",
    );
    expect(ports.storage.resources.size).toBe(0);
  });
  it("refuses a missing ETag rather than overwriting content unconditionally", async () => {
    const ports = harness();
    vi.spyOn(ports.storage, "read").mockResolvedValue({ body: "changed", etag: "" });
    await expect(importRegistry(config, ports)).rejects.toThrow(
      "Registry storage operation failed",
    );
    expect(ports.storage.resources.size).toBe(0);
  });
  it("refuses concurrent modifications rather than retrying over an owner edit", async () => {
    const ports = harness();
    await importRegistry(config, ports);
    const original = ports.storage.writeRdf.bind(ports.storage);
    vi.spyOn(ports.storage, "writeRdf").mockImplementation(async (url, dataset, opts) => {
      const current = ports.storage.resources.get(url);
      if (current) current.etag = '"owner-edit"';
      return original(url, dataset, opts);
    });
    await expect(
      importRegistry(config, {
        ...ports,
        reader: new MemoryRegistryReader(
          config.registryPath,
          fixture.replace('organization: "personal"', 'organization: "private"'),
        ),
      }),
    ).rejects.toThrow("Registry storage operation failed");
    expect(ports.storage.events.filter((e) => e.operation === "write")).toHaveLength(29);
  });
  it.each([
    { storageRoot: "https://pod.example/no-trailing-slash" },
    { storageRoot: "https://pod.example/?query=1" },
    { storageRoot: "https://pod.example/%2e%2e/" },
    { storageRoot: "file:///tmp/" },
    { ownerWebId: "https://user:pass@owner.example/" },
    { registryPath: "" },
  ])("rejects invalid import configuration before reading", async (override) => {
    const ports = harness();
    const read = vi.spyOn(ports.reader, "read");
    await expect(importRegistry({ ...config, ...override }, ports)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("reads only a bounded configured local fixture; refuses symlinks and invalid UTF-8", async () => {
    const directory = await mkdtemp("/tmp/agent-registry-");
    const path = `${directory}/synthetic.yaml`;
    const reader = new FileRegistryReader();
    try {
      await writeFile(path, fixture);
      expect(await reader.read(path, MAX_REGISTRY_BYTES)).toBe(fixture);
      await expect(reader.read(path, 5)).rejects.toThrow("byte limit");
      await symlink(path, `${directory}/link`);
      await expect(reader.read(`${directory}/link`, MAX_REGISTRY_BYTES)).rejects.toThrow();
      await expect(reader.read(directory, MAX_REGISTRY_BYTES)).rejects.toThrow("regular file");
      await writeFile(path, new Uint8Array([255]));
      await expect(reader.read(path, MAX_REGISTRY_BYTES)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
