// AUTHORED-BY Codex GPT-6.1-Sol
import { issueApproval } from "@jeswr/agent-mandate/approval";
import { issueControlStatement } from "@jeswr/agent-mandate/control";
import { recordToTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { afterEach, expect, it, vi } from "vitest";
import { createAgentClient, isLoaded, type Row } from "../src/apps/agent/lib/client";
import {
  collection,
  isTruncated,
  mapBounded,
  selectMembers,
} from "../src/apps/agent/lib/collections";
import * as readers from "../src/apps/agent/lib/readers";
import { demoApprovalKey } from "../src/apps/agent/lib/seed";
import { DEMO_ROOT } from "../src/lib/demo-pod/seed";

const BASE = `${DEMO_ROOT}agent/`;
afterEach(() => vi.restoreAllMocks());

it("bounds a thousand tasks at six and preserves order, including an empty collection", async () => {
  let active = 0;
  let peak = 0;
  const input = Array.from({ length: 1000 }, (_, i) => i);
  const result = await mapBounded(input, async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    --active;
    return value;
  });
  expect(result).toEqual(input);
  expect(peak).toBe(6);
  expect(active).toBe(0);
  expect(await mapBounded([], async () => "unused")).toEqual([]);
  expect(collection([]).truncated).toBe(false);
  expect(isTruncated([])).toBe(false);
  expect(selectMembers([{ url: "2" }, { url: "10" }]).members.map((m) => m.url)).toEqual([
    "10",
    "2",
  ]);
  expect(
    selectMembers([{ url: "a/2.ttl" }, { url: "z/1.ttl" }, { url: "b/2.ttl" }]).members.map(
      (m) => m.url,
    ),
  ).toEqual(["b/2.ttl", "a/2.ttl", "z/1.ttl"]);
});

const families = [
  ["accounts", "account", readers.readAccounts],
  ["descriptors", "channel-capability", readers.readDescriptors],
  ["proposals", "action-proposal", readers.readProposals],
  ["outbox", "transmission", readers.readOutbox],
  ["mandates", "mandate-reference", readers.readMandates],
  [
    "conversations/thread",
    "conversation-turn",
    (c: ReadersClient) => readers.readTurns(c, "thread"),
  ],
  ["approvals", "approval", readers.readApprovals],
  ["control", "control-statement", readers.readControl],
  ["audit", "audit-entry", readers.readAudit],
  ["inbox/direct/account", "inbound-message", (c: ReadersClient) => readers.readInbox(c, "direct")],
] as const;
type ReadersClient = ReturnType<typeof createAgentClient>;

it.each(
  families,
)("caps %s at the newest 500 before GETs and bounds all reads", async (path, type, read) => {
  let active = 0;
  let peak = 0;
  const requested: string[] = [];
  const key = await demoApprovalKey();
  const templateId = "urn:test:collection-member";
  const template =
    type === "approval"
      ? await issueApproval({ ...exampleRecords.approval, id: templateId }, key, new Date())
      : type === "control-statement"
        ? await issueControlStatement(
            { ...exampleRecords["control-statement"], id: templateId },
            key,
            new Date(),
          )
        : undefined;
  const client = createAgentClient({
    storage: DEMO_ROOT,
    workspace: BASE,
    fetch: async (input) => {
      const url = String(input);
      peak = Math.max(peak, ++active);
      requested.push(url);
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (url.endsWith(".triage.ttl")) return new Response(null, { status: 404 });
        const seq = Number(url.slice(url.lastIndexOf("/") + 1).replace(".ttl", ""));
        const body =
          template?.replaceAll(templateId, url) ??
          (await recordToTurtle({
            ...exampleRecords[type],
            id: url,
            ...(type === "audit-entry" ? { seq } : {}),
          }));
        return new Response(body, {
          headers: { "content-type": template ? "application/trig" : "text/turtle" },
        });
      } finally {
        --active;
      }
    },
  });
  const members = Array.from({ length: 1000 }, (_, i) => ({
    url: `${BASE}${path}/${i}.ttl`,
    container: false,
  }));
  vi.spyOn(client, "list").mockImplementation(async (url) =>
    url === `${BASE}inbox/direct/` ? [{ url: `${BASE}${path}/`, container: true }] : members,
  );
  const rows: Row<unknown>[] = await read(client);
  expect(rows).toHaveLength(500);
  expect(rows.every(isLoaded)).toBe(true);
  expect(isTruncated(rows)).toBe(true);
  expect(new Set(rows.map((row) => row.url))).toEqual(
    new Set(members.slice(500).map((m) => m.url)),
  );
  const records = requested.filter((url) => !url.endsWith(".triage.ttl"));
  expect(records).toHaveLength(500);
  expect(peak).toBe(6);
  expect(active).toBe(0);
  // The cap is also reported accurately when no truncation is necessary.
  vi.mocked(client.list).mockResolvedValue(members.slice(0, 2));
  expect(isTruncated(await read(client))).toBe(false);
});

it("caps conversation containers and each turn collection without multiplying nested concurrency", async () => {
  let active = 0;
  let peak = 0;
  const reads: string[] = [];
  const client = createAgentClient({
    storage: DEMO_ROOT,
    workspace: BASE,
    fetch: async (input) => {
      const url = String(input);
      reads.push(url);
      peak = Math.max(peak, ++active);
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return new Response(
          await recordToTurtle({ ...exampleRecords["conversation-turn"], id: url }),
          { headers: { "content-type": "text/turtle" } },
        );
      } finally {
        --active;
      }
    },
  });
  const containers = Array.from({ length: 1000 }, (_, i) => ({
    url: `${BASE}conversations/${i}/`,
    container: true,
  }));
  const list = vi
    .spyOn(client, "list")
    .mockImplementation(async (url) =>
      url === client.paths.conversations ? containers : [{ url: `${url}0.ttl`, container: false }],
    );
  const rows = await readers.readConversations(client);
  expect(rows).toHaveLength(500);
  expect(rows.every(isLoaded)).toBe(true);
  expect(isTruncated(rows)).toBe(true);
  expect(reads).toHaveLength(500);
  expect(list.mock.calls.slice(1).every(([url]) => Number(url.split("/").at(-2)) >= 500)).toBe(
    true,
  );
  list.mockImplementation(async (url) =>
    url === client.paths.conversations
      ? containers.slice(0, 2)
      : Array.from({ length: 1000 }, (_, i) => ({ url: `${url}${i}.ttl`, container: false })),
  );
  reads.length = 0;
  expect(isTruncated(await readers.readConversations(client))).toBe(true);
  expect(reads).toHaveLength(1000);
  expect(peak).toBe(6);
});

it("bounds inbox account listings and caps messages across accounts", async () => {
  let active = 0;
  let peak = 0;
  const client = createAgentClient({
    storage: DEMO_ROOT,
    workspace: BASE,
    fetch: async () => new Response(null, { status: 404 }),
  });
  const accounts = Array.from({ length: 1000 }, (_, i) => ({
    url: `${BASE}inbox/direct/${i}/`,
    container: true,
  }));
  const list = vi.spyOn(client, "list").mockImplementation(async (url) => {
    if (url === `${BASE}inbox/direct/`) return accounts;
    peak = Math.max(peak, ++active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    --active;
    return [];
  });
  const rows = await readers.readInbox(client, "direct");
  expect(isTruncated(rows)).toBe(true);
  expect(list).toHaveBeenCalledTimes(501);
  expect(peak).toBe(6);
  list.mockImplementation(async (url) =>
    url === `${BASE}inbox/direct/`
      ? accounts.slice(0, 2)
      : Array.from({ length: 300 }, (_, i) => ({ url: `${url}${i}.ttl`, container: false })),
  );
  const messages = await readers.readInbox(client, "direct");
  expect(messages).toHaveLength(500);
  expect(isTruncated(messages)).toBe(true);
});
