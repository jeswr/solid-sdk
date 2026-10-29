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
const inactivePrivateNotes = [
  'Resolved identity conflict: alice@example.com versus "private-user".',
  'No identity conflict: "private-user" versus alice@example.com.',
  'No contradiction between alice@example.com versus "private-user".',
  'Use "private-user" versus alice@example.com for comparison.',
  'Identity conflict: no conflict for alice@example.com versus "private-user".',
  'Identity conflict: alice@example.com versus "private-user". Resolved.',
  'Identity conflict: "private-user".',
  'No conflicts for "private-user".',
];

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
  it.each([
    "https://unlisted.example/profile#me",
    "did:web:unlisted.example",
    "+1 (202) 555-0100",
  ])("redacts metadata-only identity %s before exporting settings and RDF", async (identity) => {
    const ports = harness(
      stringify({
        version: 1,
        accounts: [
          {
            id: "placeholder-account",
            channel: "email",
            provider: "google",
            organization: `Contact ${identity}`,
            identifiers: { primary: "to_confirm" },
            connector: { target: "gmail", setup_status: "planned" },
          },
        ],
        communicationRules: {
          decision_policy: { ask_when_uncertain_about: ["identity"] },
          capability_policy: {
            default_allowed: ["read"],
            requires_current_instruction_or_narrow_active_authorization_rule: ["draft"],
            always_requires_fresh_explicit_instruction: ["send"],
          },
          triage_taxonomy: { action: `Contact ${identity}` },
        },
      }),
    );
    const report = await importRegistry(config, ports);
    const account = report.settings.connections[0];
    if (!account) throw new Error("Fixture account absent");
    expect(account.organisation).toBe("redacted");
    expect(report.settings.workflowPolicy?.taxonomy).toEqual({ action: "redacted" });
    const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
    expect(
      ports.storage.resources
        .get(url)
        ?.dataset.getObjects(term(url), term(`${AGENT}organisation`), null)
        .map((v) => v.value),
    ).toEqual(["redacted"]);
    expect(JSON.stringify({ report, resources: [...ports.storage.resources] })).not.toContain(
      identity,
    );
  });
  it("writes conflict RDF only for complete email identities", async () => {
    const ports = harness(
      stringify({
        version: 1,
        accounts: ["alice@example.com", "malice@example.com"].map((handle, index) => ({
          id: `account-${index}`,
          channel: "email",
          provider: "google",
          organization: "personal",
          identifiers: { primary: handle },
          connector: { target: "gmail", setup_status: "planned" },
        })),
        notes: ["Identity conflict: MALICE@example.com versus alternate@example.org."],
      }),
    );
    const report = await importRegistry(config, ports);
    const [alice, malice] = report.settings.connections;
    if (!alice || !malice) throw new Error("Fixture account absent");
    expect(alice.bindingState).toBe("setup-required");
    expect(malice.bindingState).toBe("error");
    for (const [account, expected] of [
      [alice, []],
      [malice, malice.identityConflicts],
    ] as const) {
      const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
      expect(
        ports.storage.resources
          .get(url)
          ?.dataset.getObjects(term(url), term(`${AGENT}identityConflict`), null)
          .map((v) => JSON.parse(v.value)),
      ).toEqual(expected);
    }
  });
  it.each([
    "private-user",
    "Private.User",
    "café-user",
  ])("redacts notes-only opaque conflict operand %s from settings and RDF", async (identity) => {
    const ports = harness(
      stringify({
        version: 1,
        accounts: [
          {
            id: "fixture-account",
            channel: "email",
            provider: "google",
            organization: `Contact ${identity.toUpperCase()}`,
            identifiers: { primary: "alice@example.com" },
            connector: { target: "gmail", setup_status: "planned" },
          },
        ],
        notes: [`Identity conflict: alice@example.com versus "${identity}".`],
        communicationRules: {
          decision_policy: { ask_when_uncertain_about: ["identity"] },
          capability_policy: {
            default_allowed: ["read"],
            requires_current_instruction_or_narrow_active_authorization_rule: ["draft"],
            always_requires_fresh_explicit_instruction: ["send"],
          },
          triage_taxonomy: { action: `Contact ${identity}` },
        },
      }),
    );
    const report = await importRegistry(config, ports);
    const account = report.settings.connections[0];
    if (!account) throw new Error("Fixture account absent");
    expect(account.organisation).toBe("redacted");
    expect(report.settings.workflowPolicy?.taxonomy).toEqual({ action: "redacted" });
    const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
    expect(
      ports.storage.resources
        .get(url)
        ?.dataset.getObjects(term(url), term(`${AGENT}organisation`), null)
        .map((value) => value.value),
    ).toEqual(["redacted"]);
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    expect(output.toLowerCase()).not.toContain(identity.toLowerCase());
  });
  it.each([
    "profile:private-user",
    "op://private-user/item/credential",
    "op://test-vault/PRIVATE-USER/credential",
    "op://test-vault/item/%70rivate-user",
    "op://test-vault/cafe%CC%81-user/credential",
  ])("rejects notes-only opaque identities in reference %s before storage", async (ref) => {
    const ports = harness(
      stringify({
        version: 1,
        accounts: [
          {
            id: "placeholder-account",
            channel: "email",
            provider: "google",
            organization: "personal",
            identifiers: { primary: "to_confirm" },
            credential_ref: ref,
            connector: { target: "gmail", setup_status: "planned" },
          },
        ],
        notes: ['Identity conflict: "private-user" versus "café-user".'],
      }),
    );
    await expect(importRegistry(config, ports)).rejects.toThrow("private identifier");
    expect(ports.storage.events).toEqual([]);
    expect(ports.storage.resources.size).toBe(0);
  });
  it.each(inactivePrivateNotes)("screens private identities in inactive note %s", async (note) => {
    const input = {
      version: 1,
      accounts: [
        {
          id: "fixture-account",
          channel: "email",
          provider: "google",
          organization: "Contact PRIVATE-USER",
          identifiers: { primary: "alice@example.com" },
          connector: { target: "gmail", setup_status: "planned" },
        },
      ],
      notes: [note],
      communicationRules: {
        decision_policy: { ask_when_uncertain_about: ["identity"] },
        capability_policy: {
          default_allowed: ["read"],
          requires_current_instruction_or_narrow_active_authorization_rule: ["draft"],
          always_requires_fresh_explicit_instruction: ["send"],
        },
        triage_taxonomy: { action: "Contact private-user", routine: "Needs owner attention" },
      },
    };
    const ports = harness(stringify(input));
    const report = await importRegistry(config, ports);
    const account = report.settings.connections[0];
    if (!account) throw new Error("Fixture account absent");
    expect(account).toMatchObject({
      organisation: "redacted",
      bindingState: "setup-required",
      identityConflicts: [],
      restrictions: DENY_ALL,
    });
    expect(report.settings.workflowPolicy?.taxonomy).toEqual({
      action: "redacted",
      routine: "Needs owner attention",
    });
    const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
    const dataset = ports.storage.resources.get(url)?.dataset;
    expect(
      dataset?.getObjects(term(url), term(`${AGENT}organisation`), null).map((v) => v.value),
    ).toEqual(["redacted"]);
    expect(dataset?.getObjects(term(url), term(`${AGENT}identityConflict`), null)).toEqual([]);
    expect(
      dataset?.getObjects(term(url), term(`${AGENT}bindingState`), null).map((v) => v.value),
    ).toEqual(["setup-required"]);
    expect(
      JSON.stringify({ report, resources: [...ports.storage.resources] }).toLowerCase(),
    ).not.toContain("private-user");
    for (const ref of [
      "profile:private-user",
      "op://PRIVATE-USER/item/credential",
      "op://test-vault/PRIVATE-USER/credential",
      "op://test-vault/item/%70rivate-user",
    ]) {
      const privateInput = {
        ...input,
        accounts: input.accounts.map((a) => ({ ...a, credential_ref: ref })),
      };
      expect(() =>
        inventorySettings(parseSnapshot(privateInput), new Uint8Array(32).fill(7)),
      ).toThrow("Credential reference contains a private identifier");
      const rejected = harness(stringify(privateInput));
      await expect(importRegistry(config, rejected)).rejects.toThrow(
        "Credential reference contains a private identifier",
      );
      expect(rejected.storage.events).toEqual([]);
      expect(rejected.storage.resources.size).toBe(0);
    }
  });
  it.each([
    "Alice",
    "alice?key=Value",
    "alice#Me",
  ])("keeps URI case in evidence, conflicts and RDF: %s", async (component) => {
    const own = `https://id.example/${component}`;
    const lower = own.toLowerCase();
    const other = "alternate@example.org";
    const ports = harness(
      stringify({
        version: 1,
        accounts: [own, lower].map((handle, index) => ({
          id: `web-${index}`,
          channel: "web",
          provider: "fixture_provider",
          organization: "personal",
          identifiers: { primary: handle },
          connector: { target: "fixture", setup_status: "planned" },
        })),
        evidence: [
          {
            channel: "web",
            provider: "other_provider",
            identifier: own,
            method: "historic_connector",
            source: "synthetic",
            observedOn: "2026-10-20",
          },
        ],
        notes: [`Identity conflict: <${own}> versus ${other}.`],
      }),
    );
    const report = await importRegistry(config, ports);
    const salt = await ports.salt.getSalt();
    const ownHash = hashHandle(own, salt, "web");
    const lowerHash = hashHandle(lower, salt, "web");
    expect(ownHash).not.toBe(lowerHash);
    const expected = [
      {
        kind: "identity-mismatch",
        handleHashes: [ownHash, hashHandle(other, salt, "email")].sort(),
      },
      { kind: "provider-mismatch", handleHashes: [ownHash] },
    ];
    for (const [index, account] of report.settings.connections.slice(0, 2).entries()) {
      expect(account).toMatchObject({
        channelHandles: [index === 0 ? ownHash : lowerHash],
        evidence: index === 0 ? [{ handleHash: ownHash, provider: "other_provider" }] : [],
        identityConflicts: index === 0 ? expected : [],
        bindingState: index === 0 ? "error" : "setup-required",
      });
      const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
      const dataset = ports.storage.resources.get(url)?.dataset;
      expect(
        dataset?.getObjects(term(url), term(`${AGENT}channelHandle`), null).map((v) => v.value),
      ).toEqual([index === 0 ? ownHash : lowerHash]);
      expect(
        dataset
          ?.getObjects(term(url), term(`${AGENT}identityConflict`), null)
          .map((v) => JSON.parse(v.value)),
      ).toEqual(index === 0 ? expected : []);
      expect(
        dataset
          ?.getObjects(term(url), term(`${AGENT}historicEvidence`), null)
          .map((v) => JSON.parse(v.value)),
      ).toEqual(account.evidence);
    }
    expect(report.settings.unmatchedEvidence).toEqual([]);
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    expect(output.toLowerCase()).not.toContain(lower);
    expect(output).not.toContain(other);
  });
  it.each([".", ":"])("keeps terminal URI %s in hash-only conflict RDF", async (suffix) => {
    const prefix = "https://profile.example/alice";
    const own = `${prefix}${suffix}`;
    const other = "alternate@example.org";
    const ports = harness(
      stringify({
        version: 1,
        accounts: [prefix, own].map((handle, index) => ({
          id: `account-${index}`,
          channel: "web",
          provider: "fixture_provider",
          organization: "personal",
          identifiers: { primary: handle },
          connector: { target: "fixture", setup_status: "planned" },
        })),
        notes: [`Identity conflict: "${own}". versus ${other}.`],
      }),
    );
    const report = await importRegistry(config, ports);
    const salt = await ports.salt.getSalt();
    const expected = [
      {
        kind: "identity-mismatch",
        handleHashes: [hashHandle(own, salt, "web"), hashHandle(other, salt, "email")].sort(),
      },
    ];
    for (const [index, account] of report.settings.connections.slice(0, 2).entries()) {
      expect(account.bindingState).toBe(index === 0 ? "setup-required" : "error");
      expect(account.identityConflicts).toEqual(index === 0 ? [] : expected);
      const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
      expect(
        ports.storage.resources
          .get(url)
          ?.dataset.getObjects(term(url), term(`${AGENT}identityConflict`), null)
          .map((v) => JSON.parse(v.value)),
      ).toEqual(index === 0 ? [] : expected);
    }
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    expect(output).not.toContain(prefix);
    expect(output).not.toContain(other);
  });
  it.each(
    [";v=2", ",v2", "(v2)"].flatMap((suffix) => [
      ['"', suffix, '"'],
      ["<", suffix, ">"],
    ]),
  )("writes complete delimited URI conflicts to RDF: %s%s%s", async (open, suffix, close) => {
    const prefix = "https://profile.example/alice";
    const own = `${prefix}${suffix}`;
    const other = `https://profile.example/bob${suffix}`;
    const ports = harness(
      stringify({
        version: 1,
        accounts: [prefix, own].map((handle, index) => ({
          id: `account-${index}`,
          channel: "web",
          provider: "fixture_provider",
          organization: "personal",
          identifiers: { primary: handle },
          connector: { target: "fixture", setup_status: "planned" },
        })),
        notes: [
          `Identity conflict: ${open}${own}${close} versus ${open}${other}${close}. Unresolved.`,
        ],
      }),
    );
    const report = await importRegistry(config, ports);
    const salt = await ports.salt.getSalt();
    const conflicts = [
      {
        kind: "identity-mismatch",
        handleHashes: [hashHandle(own, salt), hashHandle(other, salt)].sort(),
      },
    ];
    for (const [index, account] of report.settings.connections.slice(0, 2).entries()) {
      const expected = index === 0 ? [] : conflicts;
      const state = index === 0 ? "setup-required" : "error";
      expect(account).toMatchObject({ identityConflicts: expected, bindingState: state });
      const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
      const dataset = ports.storage.resources.get(url)?.dataset;
      expect(
        dataset
          ?.getObjects(term(url), term(`${AGENT}identityConflict`), null)
          .map((v) => JSON.parse(v.value)),
      ).toEqual(expected);
      expect(
        dataset?.getObjects(term(url), term(`${AGENT}bindingState`), null).map((v) => v.value),
      ).toEqual([state]);
    }
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    expect(output).not.toContain(prefix);
    expect(output).not.toContain(other);
  });
  it.each(
    [";v=2", ",v2", "(v2)", ";", ",", "()"].flatMap((suffix) =>
      ["", ". Unresolved."].map((ending) => [suffix, ending]),
    ),
  )("writes complete bare URI conflicts to RDF: %s%s", async (suffix, ending) => {
    const prefix = "https://id.example/Alice";
    const own = `${prefix}${suffix}`;
    const other = `https://id.example/Bob${suffix}`;
    const ports = harness(
      stringify({
        version: 1,
        accounts: [prefix, own].map((handle, index) => ({
          id: `account-${index}`,
          channel: "web",
          provider: "fixture_provider",
          organization: "personal",
          identifiers: { primary: handle },
          connector: { target: "fixture", setup_status: "planned" },
        })),
        notes: [`Identity conflict: ${own} versus ${other}${ending}`],
      }),
    );
    const report = await importRegistry(config, ports);
    const salt = await ports.salt.getSalt();
    const conflicts = [
      {
        kind: "identity-mismatch",
        handleHashes: [hashHandle(own, salt), hashHandle(other, salt)].sort(),
      },
    ];
    for (const [index, account] of report.settings.connections.slice(0, 2).entries()) {
      const expected = index === 0 ? [] : conflicts;
      const state = index === 0 ? "setup-required" : "error";
      expect(account).toMatchObject({ identityConflicts: expected, bindingState: state });
      const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
      const dataset = ports.storage.resources.get(url)?.dataset;
      expect(
        dataset
          ?.getObjects(term(url), term(`${AGENT}identityConflict`), null)
          .map((value) => JSON.parse(value.value)),
      ).toEqual(expected);
      expect(
        dataset?.getObjects(term(url), term(`${AGENT}bindingState`), null).map((v) => v.value),
      ).toEqual([state]);
    }
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    expect(output).not.toContain(prefix);
    expect(output).not.toContain(other);
  });
  it.each([
    "No conflicts for alice@example.com.",
    "Resolved identity conflict: alice@example.com versus bob@example.org.",
    "Identity conflict: alice@example.com versus bob@example.org. Resolved.",
  ])("omits inactive conflict notes from RDF: %s", async (note) => {
    const ports = harness(
      stringify({
        version: 1,
        accounts: [
          {
            id: "email-account",
            channel: "email",
            provider: "fixture_provider",
            organization: "personal",
            identifiers: { primary: "alice@example.com" },
            connector: { target: "fixture", setup_status: "planned" },
          },
        ],
        notes: [note],
      }),
    );
    const report = await importRegistry(config, ports);
    const account = report.settings.connections[0];
    if (!account) throw new Error("Fixture account absent");
    expect(account).toMatchObject({ bindingState: "setup-required", identityConflicts: [] });
    const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
    const dataset = ports.storage.resources.get(url)?.dataset;
    expect(dataset?.getObjects(term(url), term(`${AGENT}identityConflict`), null)).toEqual([]);
    expect(
      dataset?.getObjects(term(url), term(`${AGENT}bindingState`), null).map((v) => v.value),
    ).toEqual(["setup-required"]);
    expect(JSON.stringify({ report, resources: [...ports.storage.resources] })).not.toContain(
      "alice@example.com",
    );
  });
  it.each([
    "!",
    "?",
  ])("writes both sentence-final conflict identities to RDF: %s", async (punctuation) => {
    const handles = ["alice@example.com", "bob@example.com"];
    const ports = harness(
      stringify({
        version: 1,
        accounts: handles.map((handle, index) => ({
          id: `account-${index}`,
          channel: "email",
          provider: "google",
          organization: "personal",
          identifiers: { primary: handle },
          connector: { target: "gmail", setup_status: "planned" },
        })),
        notes: [`Identity conflict: alice@example.com versus bob@example.com${punctuation}`],
      }),
    );
    const report = await importRegistry(config, ports);
    const expected = [
      {
        kind: "identity-mismatch",
        handleHashes: handles
          .map((handle) => hashHandle(handle, new Uint8Array(32).fill(7)))
          .sort(),
      },
    ];
    for (const account of report.settings.connections.slice(0, 2)) {
      expect(account.bindingState).toBe("error");
      expect(account.identityConflicts).toEqual(expected);
      const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
      expect(
        ports.storage.resources
          .get(url)
          ?.dataset.getObjects(term(url), term(`${AGENT}identityConflict`), null)
          .map((v) => JSON.parse(v.value)),
      ).toEqual(expected);
    }
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    for (const handle of handles) expect(output).not.toContain(handle);
  });
  it("imports a to_ email identity with historic evidence and hash-only conflicts", async () => {
    const identity = "to_notify@example.com";
    const alternative = "alternate@example.org";
    const ports = harness(
      stringify({
        version: 1,
        accounts: [
          {
            id: "prefix-account",
            channel: "email",
            provider: "google",
            organization: "personal",
            identifiers: { primary: identity, aliases: ["to_confirm"] },
            connector: { target: "gmail", setup_status: "planned" },
          },
        ],
        evidence: [
          {
            channel: "email",
            provider: "microsoft",
            identifier: identity,
            method: "historic_connector",
            source: "synthetic",
            observedOn: "2026-10-20",
          },
        ],
        notes: [`Identity conflict: ${identity} versus ${alternative}.`],
      }),
    );
    const report = await importRegistry(config, ports);
    const account = report.settings.connections[0];
    if (!account) throw new Error("Fixture account absent");
    const salt = await ports.salt.getSalt();
    const hash = hashHandle(identity, salt, "email");
    const conflicts = [
      {
        kind: "identity-mismatch",
        handleHashes: [hash, hashHandle(alternative, salt, "email")].sort(),
      },
      { kind: "provider-mismatch", handleHashes: [hash] },
    ];
    expect(account.channelHandles).toEqual([hash]);
    expect(account.identityConflicts).toEqual(conflicts);
    expect(account.evidence).toMatchObject([{ handleHash: hash }]);
    expect(account.bindingState).toBe("error");
    expect(report.settings.unmatchedEvidence).toEqual([]);
    const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
    const dataset = ports.storage.resources.get(url)?.dataset;
    expect(
      dataset?.getObjects(term(url), term(`${AGENT}channelHandle`), null).map((v) => v.value),
    ).toEqual([hash]);
    expect(
      dataset
        ?.getObjects(term(url), term(`${AGENT}identityConflict`), null)
        .map((v) => JSON.parse(v.value)),
    ).toEqual(conflicts);
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    expect(output).not.toContain(identity);
    expect(output).not.toContain(alternative);
    expect(output).not.toContain("to_confirm");
  });
  it.each([
    ["matrix", "@fixture:matrix.example", "@Other:Elsewhere.example"],
    ["matrix_bot", "@fixture:matrix.example", "@Other:Elsewhere.example"],
    ["matrix", "@fixture:[2001:db8::1]", "@Other:[2001:DB8::2]"],
    ["matrix_bot", "@fixture:[2001:db8::1]", "@Other:[2001:DB8::2]"],
    ["matrix", "@fixture:[2001:db8::1]:8448", "@Other:[2001:DB8::2]:9448"],
    ["matrix_bot", "@fixture:[2001:db8::1]:8448", "@Other:[2001:DB8::2]:9448"],
    ["matrix", "@fixture:matrix.example", "@Other:[2001:DB8::2]"],
    ["matrix_bot", "@fixture:matrix.example", "@Other:[2001:DB8::2]"],
    ["matrix", "@fixture:matrix.example", "@Other:[2001:DB8::2]:9448"],
    ["matrix_bot", "@fixture:matrix.example", "@Other:[2001:DB8::2]:9448"],
    ["phone_messages", "+1 (202) 555-0100", "+1 202 555 0101"],
  ])("writes both %s conflict identities from notes as hashes in RDF", async (channel, own, other) => {
    const ports = harness(
      stringify({
        version: 1,
        accounts: [
          {
            id: "fixture-account",
            channel,
            provider: "fixture_provider",
            organization: "personal",
            identifiers: { primary: own },
            connector: { target: "fixture", setup_status: "planned" },
          },
        ],
        notes: [`Identity conflict: (${own}) versus "${other}".`],
      }),
    );
    const report = await importRegistry(config, ports);
    const account = report.settings.connections[0];
    if (!account) throw new Error("Fixture account absent");
    const salt = await ports.salt.getSalt();
    const expected = [
      {
        kind: "identity-mismatch",
        handleHashes: [hashHandle(own, salt, channel), hashHandle(other, salt, channel)].sort(),
      },
    ];
    expect(account.bindingState).toBe("error");
    expect(account.identityConflicts).toEqual(expected);
    const url = `${config.storageRoot}agent/accounts/${account.id}.ttl`;
    const dataset = ports.storage.resources.get(url)?.dataset;
    expect(
      dataset
        ?.getObjects(term(url), term(`${AGENT}identityConflict`), null)
        .map((v) => JSON.parse(v.value)),
    ).toEqual(expected);
    expect(
      dataset?.getObjects(term(url), term(`${AGENT}bindingState`), null).map((v) => v.value),
    ).toEqual(["error"]);
    const output = JSON.stringify({ report, resources: [...ports.storage.resources] });
    expect(output).not.toContain(own);
    expect(output).not.toContain(other);
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
  it.each([
    "op://test-vault/gmail-main%40example.com/credential",
    "op://gmail-main%40example.com/item/credential",
    "op://test-vault/item/gmail-main%40example.com",
    "op://test-vault/odi-mail%40example.com/credential",
    "op://test-vault/alternate-main%40example.org/credential",
    "op://test-vault/item%GG/credential",
    "op://test-vault/item/credential%0A",
  ])("rejects identifying or invalid encoded references before storage", async (ref) => {
    const ports = harness(fixture.replace("op://test-vault/account-01/credential", ref));
    await expect(importRegistry(config, ports)).rejects.toThrow(
      /Invalid registry|private identifier/,
    );
    expect(ports.storage.events).toEqual([]);
    expect(ports.storage.resources.size).toBe(0);
  });
  it.each(
    ["account", "evidence", "note", "resolved-note"].flatMap((source) =>
      [
        "op://PRIVATE%2DUSER/item/credential",
        "op://test-vault/PRIVATE%2DUSER/credential",
        "op://test-vault/item/PRIVATE%2DUSER",
      ].map((ref) => [source, ref]),
    ),
  )("rejects original references containing an encoded %s identity: %s", async (source, ref) => {
    const identity = "private%2duser";
    const input = {
      version: 1,
      accounts: [
        {
          id: "fixture-account",
          channel: "github_notifications",
          provider: "github",
          organization: "personal",
          identifiers: { primary: source === "account" ? identity : "to_confirm" },
          credential_ref: ref,
          connector: { target: "fixture", setup_status: "planned" },
        },
      ],
      evidence:
        source === "evidence"
          ? [
              {
                channel: "github_notifications",
                provider: "github",
                identifier: identity,
                method: "historic_connector",
                source: "synthetic",
                observedOn: "2026-10-20",
              },
            ]
          : [],
      notes:
        source === "note" || source === "resolved-note"
          ? [
              `Identity conflict: "${identity}" versus "other-user".${source === "resolved-note" ? " Resolved." : ""}`,
            ]
          : [],
    };
    expect(() => inventorySettings(parseSnapshot(input), new Uint8Array(32).fill(7))).toThrow(
      "Credential reference contains a private identifier",
    );
    const ports = harness(stringify(input));
    await expect(importRegistry(config, ports)).rejects.toThrow(
      "Credential reference contains a private identifier",
    );
    expect(ports.storage.events).toEqual([]);
    expect(ports.storage.resources.size).toBe(0);
  });
  it.each([
    "op://test-vault/unlisted@example.org/credential",
    "op://unlisted%40example.org/item/credential",
    "op://test-vault/item/%40unlisted%3AMatrix.example",
  ])("rejects unlisted identifying references with placeholder-only inventory", async (ref) => {
    const ports = harness(
      stringify({
        version: 1,
        accounts: [
          {
            id: "placeholder-account",
            channel: "email",
            provider: "google",
            organization: "personal",
            identifiers: { primary: "to_confirm" },
            credential_ref: ref,
            connector: { target: "gmail", setup_status: "planned" },
          },
        ],
      }),
    );
    await expect(importRegistry(config, ports)).rejects.toThrow(
      /Invalid registry|private identifier/,
    );
    expect(ports.storage.events).toEqual([]);
    expect(ports.storage.resources.size).toBe(0);
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
