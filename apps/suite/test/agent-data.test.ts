// AUTHORED-BY Codex GPT-6.1-Sol
import { issueApproval } from "@jeswr/agent-mandate/approval";
import {
  digestOf,
  type PodRecord,
  recordFromTurtle,
  recordToTurtle,
  toRdf,
} from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  AgentReadError,
  ConflictError,
  createAgentClient,
  isLoaded,
} from "../src/apps/agent/lib/client";
import {
  AGENT,
  agentPaths,
  discoverWorkspace,
  guardSlug,
  metadataNode,
  PROV,
  RDF,
  resourceSlug,
  SOLID,
} from "../src/apps/agent/lib/paths";
import { readRdfDocument } from "../src/apps/agent/lib/rdf";
import * as readers from "../src/apps/agent/lib/readers";
import { buildAgentSeed, demoApprovalKey } from "../src/apps/agent/lib/seed";
import { createAgentVerifier } from "../src/apps/agent/lib/verify";
import { createDemoPod, type DemoSeedFile } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const BASE = `${DEMO_ROOT}agent/`;
const url = (path: string) => `${BASE}${path}`;
const clientFor = (fetch: typeof globalThis.fetch) =>
  createAgentClient({ fetch, storage: DEMO_ROOT, workspace: BASE });
async function meta(
  path: string,
  configure: (node: ReturnType<typeof metadataNode>, store: Store) => void,
): Promise<DemoSeedFile> {
  const store = new Store();
  configure(metadataNode(store, new URL(path, DEMO_ROOT).href), store);
  return {
    path,
    body: await serialize([...store], { format: "text/turtle" }),
    contentType: "text/turtle",
  };
}
const seedRecord = async (record: PodRecord): Promise<DemoSeedFile> => ({
  path: record.id,
  body:
    record.type === "approval"
      ? await issueApproval(record, await demoApprovalKey(), new Date(record.createdAt))
      : await recordToTurtle(record),
  contentType: record.type === "approval" ? "application/trig" : "text/turtle",
});
async function fixturePod() {
  const locations = {
    account: "accounts/a.ttl",
    "channel-capability": "descriptors/a.ttl",
    "inbound-message": "inbox/direct/a/message.ttl",
    "conversation-turn": "conversations/example/0.ttl",
    "action-proposal": "proposals/a.ttl",
    approval: "approvals/a.ttl",
    "mandate-reference": "mandates/a.ttl",
    "control-statement": "control/a.ttl",
    transmission: "outbox/a.ttl",
    "audit-entry": "audit/1.ttl",
  };
  const expected = Object.values(exampleRecords).map((record) => ({
    ...record,
    id: url(locations[record.type]),
  }));
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await Promise.all(expected.map(seedRecord)) });
  return { pod, client: clientFor(pod.fetch), expected };
}

describe("agent paths and discovery", () => {
  it("derives daemon paths and accepts only route slugs", () => {
    const paths = agentPaths(BASE);
    expect(paths.heartbeat).toBe(url("control/heartbeat.ttl"));
    expect(paths.auditChain).toBe(url("audit/chain.ttl"));
    expect(paths.mandatesCurrent).toBe(url("mandates/current.ttl"));
    for (const key of [
      "accounts",
      "descriptors",
      "inbox",
      "conversations",
      "proposals",
      "approvals",
      "mandates",
      "control",
      "outbox",
      "audit",
      "memory",
    ] as const)
      expect(paths[key]).toBe(url(`${key}/`));
    expect(paths.resolveSlug("conversations", "welcome")).toBe(url("conversations/welcome/"));
    expect(paths.resolveSlug("proposals", "item-1")).toBe(url("proposals/item-1.ttl"));
    expect(resourceSlug(url("conversations/welcome/"))).toBe("welcome");
    expect(resourceSlug(url("approvals/reply.trig"))).toBe("reply");
    expect(guardSlug("a._-Z09")).toBe("a._-Z09");
    for (const slug of [
      "",
      ".",
      "..",
      "a..b",
      "a/b",
      "a%2Fb",
      "a%2fb",
      "%252f",
      "https://evil/",
      "a\\b",
      "x?y",
      "x#y",
      "a".repeat(129),
    ]) {
      expect(() => paths.resolveSlug("accounts", slug)).toThrow();
    }
    for (const ref of [
      DEMO_ROOT,
      "urn:test:proposal",
      "not a URL",
      url("a..b.ttl"),
      "data:text/plain,a",
    ])
      expect(resourceSlug(ref)).toBeUndefined();
  });
  it("discovers the seeded private registration and refuses off-pod links", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
    expect(await discoverWorkspace(pod.fetch, DEMO_WEBID)).toBe(BASE);
    const profile = await meta("profile/card", (_, store) => {
      const node = metadataNode(store, DEMO_WEBID);
      node.setIri("http://www.w3.org/ns/pim/space#storage", DEMO_ROOT);
      node.setIri(`${SOLID}privateTypeIndex`, "https://evil.example/index");
    });
    const bad = createDemoPod({ root: DEMO_ROOT, seed: [profile] });
    const spy = vi.fn(bad.fetch);
    await expect(discoverWorkspace(spy, DEMO_WEBID, DEMO_ROOT)).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("falls back when unregistered and handles preferences and multiple storages", async () => {
    const profile = await meta("profile/card", (_, store) => {
      const node = metadataNode(store, DEMO_WEBID);
      node.iris("http://www.w3.org/ns/pim/space#storage").add(DEMO_ROOT);
    });
    let pod = createDemoPod({ root: DEMO_ROOT, seed: [profile] });
    expect(await discoverWorkspace(pod.fetch, DEMO_WEBID)).toBe(BASE);
    const preferencesProfile = await meta("profile/card", (_, store) => {
      const node = metadataNode(store, DEMO_WEBID);
      node.setIri("http://www.w3.org/ns/pim/space#storage", DEMO_ROOT);
      node.setIri(
        "http://www.w3.org/ns/pim/space#preferencesFile",
        `${DEMO_ROOT}settings/prefs.ttl`,
      );
    });
    const preferences = await meta("settings/prefs.ttl", (_, store) =>
      metadataNode(store, DEMO_WEBID).setIri(
        `${SOLID}privateTypeIndex`,
        `${DEMO_ROOT}settings/index.ttl`,
      ),
    );
    const index = await meta("settings/index.ttl", (_, store) => {
      const unrelated = metadataNode(store, `${DEMO_ROOT}settings/index.ttl#unrelated`);
      unrelated.setIri(`${RDF}type`, `${SOLID}TypeRegistration`);
      unrelated.setIri(`${SOLID}forClass`, "https://schema.org/Thing");
      const empty = metadataNode(store, `${DEMO_ROOT}settings/index.ttl#empty`);
      empty.setIri(`${RDF}type`, `${SOLID}TypeRegistration`);
      empty.setIri(`${SOLID}forClass`, `${AGENT}AgentWorkspace`);
    });
    pod = createDemoPod({ root: DEMO_ROOT, seed: [preferencesProfile, preferences, index] });
    expect(await discoverWorkspace(pod.fetch, DEMO_WEBID)).toBe(BASE);
    await pod.fetch(`${DEMO_ROOT}settings/prefs.ttl`, { method: "DELETE" });
    await expect(discoverWorkspace(pod.fetch, DEMO_WEBID)).rejects.toThrow("404");
    const multi = await meta("profile/card", (_, store) => {
      const node = metadataNode(store, DEMO_WEBID);
      node.iris("http://www.w3.org/ns/pim/space#storage").add(DEMO_ROOT);
      node.iris("http://www.w3.org/ns/pim/space#storage").add(`${DEMO_ROOT}second/`);
    });
    pod = createDemoPod({ root: DEMO_ROOT, seed: [multi] });
    await expect(discoverWorkspace(pod.fetch, DEMO_WEBID)).rejects.toThrow("Choose");
    expect(await discoverWorkspace(pod.fetch, DEMO_WEBID, DEMO_ROOT)).toBe(BASE);
    await expect(discoverWorkspace(pod.fetch, DEMO_WEBID, `${DEMO_ROOT}other/`)).rejects.toThrow();
    const noStorage = createDemoPod({
      root: DEMO_ROOT,
      seed: [await meta("profile/card", () => {})],
    });
    await expect(discoverWorkspace(noStorage.fetch, DEMO_WEBID)).rejects.toThrow("Choose");
  });
  it("refuses off-pod instances before returning a workspace", async () => {
    const seed = await buildDemoSeed(NOW);
    const badIndex = await meta("settings/privateTypeIndex.ttl", (_, store) => {
      const node = metadataNode(store, `${DEMO_ROOT}settings/privateTypeIndex.ttl#agent`);
      node.setIri(`${RDF}type`, `${SOLID}TypeRegistration`);
      node.setIri(`${SOLID}forClass`, `${AGENT}AgentWorkspace`);
      node.setIri(`${SOLID}instance`, "https://evil.example/agent/");
    });
    await expect(
      discoverWorkspace(
        createDemoPod({ root: DEMO_ROOT, seed: [...seed, badIndex] }).fetch,
        DEMO_WEBID,
      ),
    ).rejects.toThrow();
  });
});

describe("agent client", () => {
  it("bounds and checks the format of every listing and discovery document", async () => {
    const seed = await buildDemoSeed(NOW);
    const pod = createDemoPod({ root: DEMO_ROOT, seed });
    const responses = [
      () =>
        new Response("", {
          headers: { "content-type": "text/turtle", "content-length": "1048577" },
        }),
      () =>
        new Response(new Uint8Array(1048577), { headers: { "content-type": "application/trig" } }),
      () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    ];
    for (const response of responses) {
      await expect(clientFor(async () => response()).list(url("accounts/"))).rejects.toThrow();
      for (const target of [
        `${DEMO_ROOT}profile/card`,
        `${DEMO_ROOT}settings/privateTypeIndex.ttl`,
      ]) {
        const io: typeof fetch = async (input, init) =>
          String(input) === target ? response() : pod.fetch(input, init);
        await expect(discoverWorkspace(io, DEMO_WEBID)).rejects.toThrow();
      }
    }
    // Preferences are also discovery input, with exactly the same read policy.
    const profile = await meta("profile/card", (_, store) => {
      const node = metadataNode(store, DEMO_WEBID);
      node.setIri("http://www.w3.org/ns/pim/space#storage", DEMO_ROOT);
      node.setIri(
        "http://www.w3.org/ns/pim/space#preferencesFile",
        `${DEMO_ROOT}settings/prefs.ttl`,
      );
    });
    const preferencesPod = createDemoPod({ root: DEMO_ROOT, seed: [profile] });
    for (const response of responses)
      await expect(
        discoverWorkspace(
          async (input, init) =>
            String(input).endsWith("prefs.ttl") ? response() : preferencesPod.fetch(input, init),
          DEMO_WEBID,
        ),
      ).rejects.toThrow();
    expect(
      await clientFor(async () => new Response(null, { status: 410 })).list(url("accounts/")),
    ).toEqual([]);
    const exact = " ".repeat(1048576);
    expect(
      (
        await readRdfDocument(
          new Response(exact, { headers: { "content-type": "Text/Turtle; charset=utf-8" } }),
        )
      ).text.length,
    ).toBe(1048576);
    await expect(
      readRdfDocument(
        new Response(null, {
          headers: { "content-type": "text/turtle", "content-length": "1048577" },
        }),
      ),
    ).rejects.toThrow("1 MiB");
  });
  it("conditional creates and replaces preserve validators and conflict", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const client = clientFor(pod.fetch);
    const target = url("accounts/new.ttl");
    const record = { ...exampleRecords.account, id: target };
    const body = await recordToTurtle(record);
    expect(await client.list(client.paths.accounts)).toEqual([]);
    const etag = await client.create(target, body);
    expect(etag).toMatch(/^"demo/);
    await expect(client.create(target, body)).rejects.toBeInstanceOf(ConflictError);
    const read = await client.read(target, "account");
    expect(read).toMatchObject({ record, url: target, etag, verified: "unchecked" });
    await expect(client.replace(target, body, '"old"')).rejects.toBeInstanceOf(ConflictError);
    expect(await client.replace(target, body, etag as string, "text/turtle")).not.toBe(etag);
    expect(() => client.replace(target, body, " ")).toThrow("validator");
    await expect(client.read(target, "approval")).rejects.toThrow("Unexpected");
    await expect(client.read(url("missing.ttl"), "account")).rejects.toMatchObject({ status: 404 });
    await expect(client.read("https://evil.example/a", "account")).rejects.toThrow();
    expect(() =>
      createAgentClient({
        fetch: pod.fetch,
        storage: DEMO_ROOT,
        workspace: "https://evil.example/",
      }),
    ).toThrow();
  });
  it("reads TriG default claims and ignores conflicting proof graph claims", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT });
    const client = clientFor(pod.fetch);
    for (const type of ["account", "control-statement"] as const) {
      const target = url(`${type === "account" ? "accounts" : "control"}/proof.trig`);
      const record = { ...exampleRecords[type], id: target };
      const body = await serialize(
        [
          ...toRdf(record),
          ...[...toRdf({ ...record, id: "urn:test:proof" })].map((q) =>
            DataFactory.quad(
              q.subject,
              q.predicate,
              q.object,
              DataFactory.namedNode("urn:test:proof-graph"),
            ),
          ),
        ],
        { format: "application/trig" },
      );
      await client.create(target, body, "application/trig");
      expect((await client.read(target, type)).record).toEqual(record);
    }
  });
  it("caps streamed bytes, checks HTTP and content types and refuses redirects", async () => {
    const request = (response: Response) => clientFor(async () => response);
    await expect(
      request(new Response("bad", { status: 403 })).read(url("a"), "account"),
    ).rejects.toBeInstanceOf(AgentReadError);
    await expect(
      request(new Response("bad", { status: 403 })).list(url("accounts/")),
    ).rejects.toThrow("403");
    await expect(
      request(new Response("bad", { status: 500 })).create(url("a"), "body", "application/trig"),
    ).rejects.toThrow("save");
    await expect(
      request(
        new Response("", {
          headers: { "content-length": "1048577", "content-type": "text/turtle" },
        }),
      ).read(url("a"), "account"),
    ).rejects.toThrow("1 MiB");
    await expect(
      request(
        new Response(new Uint8Array(1048577), { headers: { "content-type": "text/turtle" } }),
      ).graph(url("a")),
    ).rejects.toThrow("1 MiB");
    await expect(
      request(new Response("<html>", { headers: { "content-type": "text/html" } })).read(
        url("a"),
        "account",
      ),
    ).rejects.toThrow("Unsupported");
    await expect(
      request(new Response(null, { status: 204 })).read(url("a"), "account"),
    ).rejects.toThrow("Unsupported");
    await expect(
      request(
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
      ).read(url("a"), "account"),
    ).rejects.toThrow();
    await expect(request(new Response(null)).read(url("a"), "account")).rejects.toThrow(
      "Unsupported",
    );
    const graph = await request(
      new Response(null, { status: 204, headers: { "content-type": "text/turtle" } }),
    ).graph(url("a"));
    expect(graph.dataset.size).toBe(0);
  });
});

describe("typed readers", () => {
  it("selects newest audit sequence IRIs before fetching and caps concurrent reads at six", async () => {
    const seed = await Promise.all(
      Array.from({ length: 40 }, (_, seq) =>
        seedRecord({
          ...exampleRecords["audit-entry"],
          id: url(`audit/${seq}.ttl`),
          seq,
          // Sequence order, rather than timestamps or lexicographic path order, is canonical.
          at: new Date(NOW - seq * 1000).toISOString(),
        }),
      ),
    );
    const pod = createDemoPod({ root: DEMO_ROOT, seed });
    let active = 0;
    let peak = 0;
    const reads: string[] = [];
    const client = clientFor(async (input, init) => {
      const target = String(input);
      if (!target.endsWith(".ttl") || (init?.method && init.method !== "GET"))
        return pod.fetch(input, init);
      reads.push(target);
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      try {
        return await pod.fetch(input, init);
      } finally {
        --active;
      }
    });
    expect(
      readers.loadedRecords(await readers.readAudit(client, { limit: 1 })).map((r) => r.seq),
    ).toEqual([39]);
    expect(reads).toEqual([url("audit/39.ttl")]);
    reads.length = 0;
    expect(
      readers
        .loadedRecords(await readers.readAudit(client, { before: 20, limit: 12 }))
        .map((r) => r.seq),
    ).toEqual(Array.from({ length: 12 }, (_, i) => 19 - i));
    expect(reads).toHaveLength(12);
    expect(peak).toBe(6);
    reads.length = 0;
    expect(await readers.readAudit(client, { limit: 0 })).toEqual([]);
    expect(await readers.readAudit(client, { before: 0 })).toEqual([]);
    expect(reads).toEqual([]);
    for (const limit of [-1, NaN, 1.5])
      await expect(readers.readAudit(client, { limit })).rejects.toThrow("limit");
    await client.create(url("audit/chain.ttl"), "");
    await client.create(url("audit/subfolder/"), "");
    for (const name of ["bad", "9007199254740992"])
      await client.create(url(`audit/${name}.ttl`), "");
    await client.replace(
      url("audit/39.ttl"),
      await recordToTurtle({ ...exampleRecords["audit-entry"], id: url("audit/39.ttl"), seq: 3 }),
      (await pod.fetch(url("audit/39.ttl"))).headers.get("etag") as string,
    );
    const rows = await readers.readAudit(client);
    expect(rows).toHaveLength(42);
    expect(rows[0]).toMatchObject({ url: url("audit/39.ttl"), error: expect.any(Error) });
    expect(rows.filter((row) => !isLoaded(row))).toHaveLength(3);
    expect(reads.some((ref) => ref.endsWith("bad.ttl"))).toBe(false);
  });
  it("round-trips every golden record family through the demo pod", async () => {
    const { client, expected } = await fixturePod();
    const results = await Promise.all([
      readers.readAccounts(client),
      readers.readDescriptors(client),
      readers.readInbox(client, "direct"),
      readers.readTurns(client, "example"),
      readers.readProposals(client),
      readers.readApprovals(client),
      readers.readMandates(client),
      readers.readControl(client),
      readers.readOutbox(client),
      readers.readAudit(client),
    ]);
    results.forEach((rows, index) => {
      expect(rows).toHaveLength(1);
      const want: Record<string, unknown> = { ...expected[index] };
      if (index === 5 || index === 7) {
        delete want.type;
        delete (want as Partial<import("@jeswr/agent-model").Approval>).proof;
      }
      if (index === 5) {
        delete (want as Partial<import("@jeswr/agent-model").Approval>).attributedTo;
        want.createdAt = new Date(String(want.createdAt)).toISOString();
      }
      expect(rows[0] && isLoaded<unknown>(rows[0]) && rows[0].record).toMatchObject(want);
    });
    const conversations = readers.loadedRecords(await readers.readConversations(client));
    expect(conversations[0]).toMatchObject({ title: "Synthetic turn", unread: false });
    expect(await readers.readMandateCurrent(client)).toEqual([]);
    expect(await readers.readHeartbeat(client)).toEqual([]);
    expect(await readers.readAudit(client, { before: 1, limit: 10 })).toEqual([]);
    expect(await readers.readAudit(client, { before: 2, limit: 1 })).toHaveLength(1);
  });
  it("keeps malformed members, container failures and triage failures as independent rows", async () => {
    const { pod, client } = await fixturePod();
    await pod.fetch(url("accounts/bad.ttl"), { method: "PUT", body: "bad turtle" });
    expect((await readers.readAccounts(client)).filter((row) => !isLoaded(row))).toHaveLength(1);
    await pod.fetch(url("inbox/direct/a/message.triage.ttl"), {
      method: "PUT",
      body: "bad turtle",
    });
    let inbox = readers.loadedRecords(await readers.readInbox(client, "direct"));
    expect(inbox[0]?.triageError).toBeDefined();
    await pod.fetch(url("inbox/direct/a/message.triage.ttl"), { method: "PUT", body: "" });
    inbox = readers.loadedRecords(await readers.readInbox(client, "direct"));
    expect(inbox[0]?.triageError).toBeDefined();
    await pod.fetch(url("inbox/direct/ignored.ttl"), { method: "PUT", body: "ignored" });
    const badClient = clientFor(async (input, init) =>
      String(input) === url("inbox/direct/a/")
        ? new Response(null, { status: 403 })
        : pod.fetch(input, init),
    );
    expect(await readers.readInbox(badClient, "direct")).toMatchObject([
      { url: url("inbox/direct/a/"), error: expect.any(Error) },
    ]);
    await pod.fetch(url("conversations/example/bad.ttl"), { method: "PUT", body: "bad" });
    expect((await readers.readConversations(client))[0]).toHaveProperty("error");
    await pod.fetch(url("conversations/empty/"), { method: "PUT" });
    const empty = readers
      .loadedRecords(await readers.readConversations(client))
      .find((row) => row.id === url("conversations/empty/"));
    expect(empty).toMatchObject({ title: "empty", unread: false, updatedAt: "" });
    await pod.fetch(url("conversations/bad%20slug/"), { method: "PUT" });
    expect(
      (await readers.readConversations(client)).find(
        (row) => row.url === url("conversations/bad%20slug/"),
      ),
    ).toMatchObject({ error: expect.any(Error) });
    const forbidden = clientFor(async () => new Response(null, { status: 403 }));
    await expect(readers.readMandateCurrent(forbidden)).rejects.toMatchObject({ status: 403 });
    await expect(readers.readHeartbeat(forbidden)).rejects.toMatchObject({ status: 403 });
  });
  it("reads the daemon metadata using typed accessors and validates heartbeat", async () => {
    for (const confidence of ["0.9", undefined]) {
      const { pod, client } = await fixturePod();
      const file = await meta("agent/inbox/direct/a/message.triage.ttl", (node) => {
        node.setIri(`${RDF}type`, `${AGENT}TriageAssessment`);
        node.setIri(`${PROV}wasDerivedFrom`, url("inbox/direct/a/message.ttl"));
        node.setText(`${AGENT}primaryClass`, "meeting");
        if (confidence) node.setText(`${AGENT}confidence`, confidence);
      });
      await pod.fetch(url("inbox/direct/a/message.triage.ttl"), {
        method: "PUT",
        body: file.body as string,
        headers: { "content-type": file.contentType },
      });
      const message = readers.loadedRecords(await readers.readInbox(client, "direct"))[0];
      expect(message?.triage).toEqual({
        primary: "meeting",
        urgency: undefined,
        confidence: confidence ? 0.9 : undefined,
      });
    }
    for (const kind of ["Wrong", "TriageAssessment"]) {
      const { pod, client } = await fixturePod();
      const file = await meta("agent/inbox/direct/a/message.triage.ttl", (node) => {
        node.setIri(`${RDF}type`, `${AGENT}${kind}`);
        node.setIri(`${PROV}wasDerivedFrom`, "urn:wrong:source");
      });
      await pod.fetch(url("inbox/direct/a/message.triage.ttl"), {
        method: "PUT",
        body: file.body as string,
        headers: { "content-type": file.contentType },
      });
      expect(
        readers.loadedRecords(await readers.readInbox(client, "direct"))[0]?.triageError,
      ).toBeDefined();
    }
    for (const [type, time] of [
      ["Wrong", "2026-11-01T00:00:00Z"],
      ["Heartbeat", undefined],
      ["Heartbeat", "invalid"],
      ["Heartbeat", "2026-11-01T00:00:00Z"],
    ] as const) {
      const heartbeat = await meta("agent/control/heartbeat.ttl", (node) => {
        node.setIri(`${RDF}type`, `${AGENT}${type}`);
        if (time) node.setText(`${PROV}generatedAtTime`, time);
      });
      const pod = createDemoPod({ root: DEMO_ROOT, seed: [heartbeat] });
      const result = readers.readHeartbeat(clientFor(pod.fetch));
      if (type === "Heartbeat" && time && time !== "invalid")
        expect(readers.loadedRecords(await result)).toMatchObject([{ at: time }]);
      else await expect(result).rejects.toThrow("heartbeat");
    }
  });
  it("orders all supported timestamp families newest first, preserving unreadable rows", () => {
    const timestamps = [
      "createdAt",
      "receivedAt",
      "startedAt",
      "at",
      "validFrom",
      "lastIngest",
      "updatedAt",
    ];
    const rows = timestamps.map((key, index) => ({
      url: String(index),
      etag: null,
      verified: "unchecked" as const,
      record: { [key]: new Date(NOW + index * 1000).toISOString() },
    }));
    expect(readers.newest([...rows]).map((row) => row.url)).toEqual([
      "6",
      "5",
      "4",
      "3",
      "2",
      "1",
      "0",
    ]);
    expect(
      readers
        .newest([
          { url: "b", error: new Error() },
          { url: "a", record: {}, etag: null, verified: "unchecked" },
        ])
        .map((row) => row.url),
    ).toEqual(["a", "b"]);
  });
});

describe("agent demo seed", () => {
  it("round-trips every seeded record, matches daemon layout and seals the entire audit chain", async () => {
    const seed = await buildAgentSeed(NOW);
    const pod = createDemoPod({ root: DEMO_ROOT, seed });
    const client = clientFor(pod.fetch);
    for (const file of seed.filter(
      (file) =>
        !file.path.includes("heartbeat") &&
        !file.path.includes(".triage.") &&
        !file.path.endsWith(".trig") &&
        file.contentType !== "application/trig" &&
        !file.path.endsWith("descriptors/agent.ttl"),
    )) {
      const record = await recordFromTurtle(
        file.body as string,
        new URL(file.path, DEMO_ROOT).href,
      );
      expect(record.id).toBe(new URL(file.path, DEMO_ROOT).href);
    }
    expect(await readers.readAccounts(client)).toHaveLength(4);
    expect(await readers.readDescriptors(client)).toHaveLength(2);
    expect(await readers.readConversations(client)).toHaveLength(2);
    expect(await readers.readTurns(client, "welcome")).toHaveLength(4);
    expect(await readers.readTurns(client, "preferences")).toHaveLength(2);
    expect(await readers.readProposals(client)).toHaveLength(3);
    expect(await readers.readMandateCurrent(client)).toHaveLength(1);
    expect(await readers.readMandates(client)).toHaveLength(1);
    expect(await readers.readOutbox(client)).toHaveLength(1);
    expect((await readers.readApprovals(client)).every(isLoaded)).toBe(true);
    const fullPod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
    const verified = await readers.readApprovals(
      clientFor(fullPod.fetch),
      createAgentVerifier({ fetch: fullPod.fetch, webId: DEMO_WEBID }, () => new Date(NOW)),
    );
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({ verified: "verified" });
    expect(await readers.readControl(client)).toHaveLength(1);
    expect(readers.loadedRecords(await readers.readHeartbeat(client))[0]?.at).toBe(
      new Date(NOW - 30_000).toISOString(),
    );
    const inbox = readers.loadedRecords(await readers.readInbox(client, "gmail"));
    expect(inbox).toHaveLength(3);
    expect(inbox[1]?.triage?.primary).toBe("meeting");
    expect(inbox[1]?.structuredPart).toMatchObject([{ type: "text/calendar" }]);
    expect(await readers.readInbox(client, "graph-mail")).toHaveLength(1);
    const audit = readers.loadedRecords(await readers.readAudit(client));
    expect(audit.map((row) => row.seq)).toEqual(Array.from({ length: 12 }, (_, i) => 11 - i));
    let prev = "sha-256:genesis";
    for (const entry of audit.toReversed()) {
      expect(entry.prev).toBe(prev);
      expect(entry.hash).toBe(
        digestOf({ seq: entry.seq, at: entry.at, prev: entry.prev, record: entry.record }),
      );
      prev = entry.hash;
    }
  });
});
