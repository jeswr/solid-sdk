// AUTHORED-BY Codex GPT-6.1-Sol
import { issueControlStatement } from "@jeswr/agent-mandate/control";
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveContainers, archivePartition, readArchive } from "../src/apps/agent/lib/archive";
import { createAgentClient } from "../src/apps/agent/lib/client";
import { isComplete } from "../src/apps/agent/lib/collections";
import { loadedRecords } from "../src/apps/agent/lib/readers";
import { demoApprovalKey } from "../src/apps/agent/lib/seed";
import { createAgentVerifier } from "../src/apps/agent/lib/verify";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const now = new Date("2026-11-01T12:00:00Z");
const DAY = 86400000;
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(now.getTime()) });
  const client = createAgentClient({
    fetch: pod.fetch,
    storage: DEMO_ROOT,
    workspace: `${DEMO_ROOT}agent/`,
  });
  const verifier = createAgentVerifier({ fetch: pod.fetch, webId: DEMO_WEBID }, () => now);
  async function archive(
    createdAt: string,
    container = archivePartition(client, new Date(createdAt)),
  ) {
    const at = new Date(createdAt);
    const claims = {
      id: `${container}${at.getTime()}-Archive-${crypto.randomUUID()}.trig`,
      kind: "Archive" as const,
      target: `${client.paths.inbox}gmail/gmail/${at.getTime()}.ttl`,
      attributedTo: DEMO_WEBID,
      createdAt: at.toISOString(),
      expires: new Date(at.getTime() + 365 * DAY).toISOString(),
    };
    await client.create(
      claims.id,
      await issueControlStatement(claims, await demoApprovalKey(), at),
      "application/trig",
    );
    return claims;
  }
  return { pod, client, verifier, archive };
}
afterEach(() => vi.restoreAllMocks());

describe("archive partitions", () => {
  it.each([
    ["2026-01-31T23:59:59Z", "2026-01"],
    ["2026-02-01T00:00:00Z", "2026-02"],
    ["2026-02-01T00:30:00+01:00", "2026-01"],
    ["2025-12-31T23:30:00-01:00", "2026-01"],
  ])("uses the UTC month of %s", async (at, month) => {
    const { client } = await fixture();
    expect(archivePartition(client, new Date(at))).toBe(`${client.paths.archive}${month}/`);
  });

  it.each([
    "2026-11-01T12:00:00Z",
    "2024-03-01T00:00:00Z",
    "2026-01-31T23:59:59Z",
  ])("covers the expiry window with a day's margin, newest first and the legacy root last at %s", async (value) => {
    const { client } = await fixture();
    const at = new Date(value);
    const containers = archiveContainers(client, at);
    expect(containers[0]).toBe(archivePartition(client, at));
    expect(containers).toContain(archivePartition(client, new Date(at.getTime() - 365 * DAY)));
    expect(containers.at(-2)).toBe(archivePartition(client, new Date(at.getTime() - 366 * DAY)));
    expect(containers.at(-1)).toBe(client.paths.archive);
    expect(containers.slice(0, -1)).toEqual(containers.slice(0, -1).toSorted().reverse());
    expect(new Set(containers).size).toBe(containers.length);
    const old = new Date(at);
    old.setUTCDate(1);
    old.setUTCMonth(old.getUTCMonth() - 15);
    expect(containers).not.toContain(archivePartition(client, old));
  });

  it("merges and verifies several partitions and the legacy root, sorted by creation time", async () => {
    const { client, verifier, archive } = await fixture();
    const previous = await archive("2026-09-30T23:59:59Z");
    const legacy = await archive("2026-10-15T12:00:00Z", client.paths.archive);
    const latest = await archive(now.toISOString());
    const boundary = await archive(new Date(now.getTime() - 365 * DAY + 1).toISOString());
    const rows = await readArchive(client, verifier, now);
    expect(loadedRecords(rows)).toEqual(
      [latest, legacy, previous, boundary].map((claims) => ({
        ...claims,
        verification: "verified",
      })),
    );
    expect(rows).toHaveLength(4);
    expect(rows).toMatchObject({ complete: true, total: 4, truncated: false });
    expect(isComplete(rows)).toBe(true);
  });

  it.each([
    "partition",
    "legacy",
  ])("keeps other rows and reports incompleteness if the %s listing exceeds its cap", async (source) => {
    const { client, verifier, archive } = await fixture();
    const retained = await archive("2026-10-01T00:00:00Z");
    const capped = source === "partition" ? archivePartition(client, now) : client.paths.archive;
    const list = client.list;
    vi.spyOn(client, "list").mockImplementation(async (container) =>
      container === capped
        ? Array.from({ length: 5001 }, (_, i) => ({
            url: `${container}${i}.trig`,
            container: false,
          }))
        : list(container),
    );
    const graph = vi.spyOn(client, "graph");
    const rows = await readArchive(client, verifier, now);
    expect(isComplete(rows)).toBe(false);
    expect(rows).toMatchObject({
      total: 5002,
      truncated: false,
      incompleteMessage: "Too many control records to check",
    });
    expect(loadedRecords(rows).map((record) => record.id)).toEqual([retained.id]);
    expect(graph.mock.calls.map(([url]) => url)).toEqual([retained.id]);
  });

  it.each([404, 410])("treats missing partitions (%i) as empty and complete", async (status) => {
    const { pod, client, archive } = await fixture();
    const retained = await archive("2026-10-01T00:00:00Z", client.paths.archive);
    const fetch: typeof pod.fetch = async (url, init) =>
      String(url).startsWith(client.paths.archive) &&
      String(url).endsWith("/") &&
      String(url) !== client.paths.archive
        ? new Response(null, { status })
        : pod.fetch(url, init);
    const reader = createAgentClient({ fetch, storage: DEMO_ROOT, workspace: client.workspace });
    const verifier = createAgentVerifier({ fetch, webId: DEMO_WEBID }, () => now);
    const rows = await readArchive(reader, verifier, now);
    expect(isComplete(rows)).toBe(true);
    expect(loadedRecords(rows).map((record) => record.id)).toEqual([retained.id]);
    expect(rows.total).toBe(1);
  });

  it("does not read partitions older than the window, including through the legacy listing", async () => {
    const { client, verifier, archive } = await fixture();
    const old = await archive("2025-08-01T00:00:00Z");
    const list = vi.spyOn(client, "list");
    const graph = vi.spyOn(client, "graph");
    const rows = await readArchive(client, verifier, now);
    expect(rows).toHaveLength(0);
    expect(isComplete(rows)).toBe(true);
    expect(list).not.toHaveBeenCalledWith(archivePartition(client, new Date(old.createdAt)));
    expect(graph).not.toHaveBeenCalled();
  });

  it("preserves unreadable rows without treating a complete listing as incomplete", async () => {
    const { client, verifier } = await fixture();
    const id = `${archivePartition(client, now)}bad.trig`;
    await client.create(id, "bad", "application/trig");
    const rows = await readArchive(client, verifier, now);
    expect(rows).toEqual([{ url: id, error: expect.any(Error) }]);
    expect(rows).toMatchObject({ complete: true, total: 1 });
  });
});
