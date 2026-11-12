// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildConnectionRecord,
  connectionRecordUrl,
  connectionsContainer,
  parseConnectionRecord,
  revokeConnectionRecord,
} from "@jeswr/mcp-connections";
import { describe, expect, it, vi } from "vitest";
import { DEMO_ROOT } from "../src/lib/demo-pod/constants";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { seedAssistants } from "../src/lib/demo-pod/seed-assistants";
import type { PodSession } from "../src/lib/session/types";
import {
  connectionName,
  connectionStatus,
  disconnectConnection,
  listConnections,
} from "../src/shell/settings/assistants/connections";

const at = Date.parse("2026-11-11T10:00:00Z");
const signal = () => new AbortController().signal;
function session(fetch: typeof globalThis.fetch): PodSession {
  return {
    mode: "solid",
    fetch,
    publicFetch: fetch,
    webId: `${DEMO_ROOT}profile/card#me`,
    storageUrl: DEMO_ROOT,
    displayName: "Alice",
    subscribe: () => () => {},
  };
}
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await seedAssistants(at) });
  const fetch = vi.fn(pod.fetch);
  const account = session(fetch);
  const url = await connectionRecordUrl(DEMO_ROOT, "https://mcp.example/mcp", "demo-grant-0");
  return { pod, fetch, account, url };
}
describe("connection list and owner disconnect", () => {
  it("lists connection metadata, orders recent use, and classifies display status", async () => {
    const f = await fixture();
    const result = await listConnections(f.account, signal());
    expect(result.rows).toHaveLength(2);
    expect(result.unreadable).toBe(0);
    const first = result.rows[0]?.record;
    expect(first).toBeDefined();
    if (!first) throw new Error();
    expect(connectionName(first)).toBe("Demo assistant");
    expect(connectionName({ ...first, title: undefined })).toBe("mcp.example");
    expect(connectionStatus(first, at)).toBe("Active");
    expect(connectionStatus(first, at + 31 * 86400000)).toBe("Expired");
    expect(connectionStatus({ ...first, revokedAt: new Date(at) }, at)).toBe(
      "Disconnected on 2026-11-11",
    );
  });
  it("revokes using fresh strong validators, survives reload, and treats already revoked as success", async () => {
    const f = await fixture();
    await disconnectConnection(f.account, f.url, signal(), new Date(at));
    expect(
      (await parseConnectionRecord(await (await f.pod.fetch(f.url)).text(), "text/turtle", f.url))
        .revokedAt,
    ).toEqual(new Date(at));
    const rows = await listConnections(f.account, signal());
    expect(rows.rows.filter((row) => connectionStatus(row.record, at) === "Active")).toHaveLength(
      1,
    );
    const calls = f.fetch.mock.calls.length;
    await disconnectConnection(f.account, f.url, signal(), new Date(at + 1));
    expect(f.fetch.mock.calls.length).toBe(calls + 1);
  });
  it.each([
    "edited",
    "revoked",
  ])("refetches once after a 412 with a concurrently %s record", async (kind) => {
    const f = await fixture();
    let writes = 0;
    f.fetch.mockImplementation(async (input, init) => {
      if (init?.method === "PUT" && writes++ === 0) {
        const read = await f.pod.fetch(f.url);
        const body =
          kind === "revoked"
            ? await revokeConnectionRecord(
                await read.text(),
                "text/turtle",
                f.url,
                new Date(at - 1000),
              )
            : buildConnectionRecord(f.url, {
                ...(await parseConnectionRecord(await read.text(), "text/turtle", f.url)),
                title: "Edited elsewhere",
              });
        await f.pod.fetch(f.url, {
          method: "PUT",
          headers: { "content-type": "text/turtle" },
          body,
        });
        return new Response(null, { status: 412 });
      }
      return f.pod.fetch(input, init);
    });
    await disconnectConnection(f.account, f.url, signal(), new Date(at));
    const record = await parseConnectionRecord(
      await (await f.pod.fetch(f.url)).text(),
      "text/turtle",
      f.url,
    );
    expect(record.revokedAt).toEqual(new Date(kind === "revoked" ? at - 1000 : at));
    expect(writes).toBe(kind === "revoked" ? 1 : 2);
    if (kind === "edited") expect(record.title).toBe("Edited elsewhere");
  });
  it.each([
    "weak",
    "missing",
    "412",
    "403",
    "network",
    "redirect",
    "malformed",
  ])("reports a generic failure for %s", async (kind) => {
    const f = await fixture();
    f.fetch.mockImplementation(async (input, init) => {
      if (kind === "network") throw new Error("secret backend detail");
      if (init?.method === "PUT") return new Response(null, { status: kind === "412" ? 412 : 403 });
      const read = await f.pod.fetch(input, init);
      if (kind === "weak") read.headers.set("etag", 'W/"x"');
      if (kind === "missing") read.headers.delete("etag");
      if (kind === "redirect") Object.defineProperty(read, "redirected", { value: true });
      if (kind === "malformed") return new Response("bad Turtle");
      return read;
    });
    await expect(disconnectConnection(f.account, f.url, signal())).rejects.toThrow(
      "Couldn't disconnect. Try again.",
    );
    expect(
      f.fetch.mock.calls.filter(([, init]) => init?.method === "PUT").length,
    ).toBeLessThanOrEqual(2);
  });
  it("rejects foreign, nested and non-record targets without IO and cancels aborted operations", async () => {
    const f = await fixture();
    for (const url of [
      "https://foreign.example/file.ttl",
      `${connectionsContainer(DEMO_ROOT)}../file.ttl`,
      `${f.url}?q=x`,
      `${f.url}#it`,
      `${connectionsContainer(DEMO_ROOT)}nested/${"a".repeat(32)}.ttl`,
    ])
      await expect(disconnectConnection(f.account, url, signal())).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(disconnectConnection(f.account, f.url, controller.signal)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("counts unreadable records, filters names, treats only missing listings as empty", async () => {
    const f = await fixture();
    await f.pod.fetch(`${connectionsContainer(DEMO_ROOT)}invalid.ttl`, {
      method: "PUT",
      body: "ignore",
    });
    await f.pod.fetch(f.url, { method: "PUT", body: "malformed" });
    const result = await listConnections(f.account, signal());
    expect(result.rows).toHaveLength(1);
    expect(result.unreadable).toBe(1);
    for (const status of [404, 410])
      expect(
        (
          await listConnections(
            session(async () => new Response(null, { status })),
            signal(),
          )
        ).rows,
      ).toEqual([]);
    await expect(
      listConnections(
        session(async () => new Response(null, { status: 403 })),
        signal(),
      ),
    ).rejects.toThrow();
  });
  it("caps reads at 100 files and six concurrent requests", async () => {
    const f = await fixture();
    const read = await parseConnectionRecord(
      await (await f.pod.fetch(f.url)).text(),
      "text/turtle",
      f.url,
    );
    for (let i = 0; i < 104; i++) {
      const url = new URL(
        `${i.toString(16).padStart(32, "0")}.ttl`,
        connectionsContainer(DEMO_ROOT),
      ).href;
      await f.pod.fetch(url, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: buildConnectionRecord(url, read),
      });
    }
    let active = 0;
    let max = 0;
    let count = 0;
    f.fetch.mockImplementation(async (input, init) => {
      if (String(input).endsWith(".ttl")) {
        count++;
        max = Math.max(max, ++active);
        await Promise.resolve();
        const response = await f.pod.fetch(input, init);
        active--;
        return response;
      }
      return f.pod.fetch(input, init);
    });
    const result = await listConnections(f.account, signal());
    expect(result.rows).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(count).toBe(100);
    expect(max).toBeLessThanOrEqual(6);
  });
  it("falls back to creation time and orders equal timestamps by record URL", async () => {
    const f = await fixture();
    const original = await listConnections(f.account, signal());
    for (const { url, record } of original.rows)
      await f.pod.fetch(url, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: buildConnectionRecord(url, { ...record, lastUsed: undefined, created: new Date(at) }),
      });
    const result = await listConnections(f.account, signal());
    expect(result.rows.map(({ url }) => url)).toEqual(original.rows.map(({ url }) => url).sort());
  });
  it.each([
    "redirected",
    "different final URL",
    "matching final URL",
  ])("checks the disconnect response's %s and ignores cancellation failures", async (kind) => {
    const f = await fixture();
    const cancel = vi.fn().mockRejectedValue(new Error("secret cancellation"));
    f.fetch.mockImplementation(async (input, init) => {
      if (init?.method !== "PUT") return f.pod.fetch(input, init);
      const response = new Response(new ReadableStream({ cancel }));
      Object.defineProperty(response, "redirected", { value: kind === "redirected" });
      Object.defineProperty(response, "url", {
        value: kind === "different final URL" ? "https://foreign.example/record.ttl" : f.url,
      });
      return response;
    });
    const edit = disconnectConnection(f.account, f.url, signal());
    if (kind === "matching final URL") await expect(edit).resolves.toBeUndefined();
    else await expect(edit).rejects.toEqual(new Error("Couldn't disconnect. Try again."));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
