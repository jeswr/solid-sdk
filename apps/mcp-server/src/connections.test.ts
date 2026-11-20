// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildConnectionRecord,
  connectionRecordUrl,
  MCP,
  parseConnectionRecord,
  revokeConnectionRecord,
} from "@jeswr/mcp-connections";
import type {
  AccessPrincipal,
  AuthorizationServerOptions,
  PodSessionProvider,
} from "@jeswr/mcp-oauth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionPod, ROOT, WEBID } from "../test/connection-pod.js";
import { createConnectionGate, provenanceId } from "./connections.js";

const RESOURCE = "https://mcp.example/mcp";
const ORIGIN = "https://mcp.example";
const principal: AccessPrincipal = {
  grantId: "verified-grant",
  sessionId: "session",
  webId: WEBID,
  clientId: "opaque",
  resource: RESOURCE,
  scope: "mcp",
};
const at = Date.parse("2026-11-11T23:55:00Z") / 1000;
const recordData = () => ({
  resource: RESOURCE,
  client: provenanceId(principal.clientId, ORIGIN),
  created: new Date(at * 1000),
  expiresAt: new Date((at + 86400) * 1000),
  access: `${MCP}ReadOnly` as const,
  personalDataMode: `${MCP}OwnerPolicy` as const,
});
async function fixture() {
  let now = at;
  const pod = connectionPod();
  const url = await connectionRecordUrl(ROOT, RESOURCE, principal.grantId);
  const original = buildConnectionRecord(url, recordData());
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: original,
  });
  const fetcher = vi.fn<typeof fetch>(pod.fetch);
  const sessions: PodSessionProvider = {
    begin: vi.fn(),
    complete: vi.fn(),
    fetchFor: vi.fn(async () => fetcher),
    revoke: vi.fn(),
  };
  const gate = createConnectionGate({
    resource: RESOURCE,
    origin: ORIGIN,
    sessions,
    upstreamFetch: pod.fetch,
    now: () => now,
  });
  return {
    pod,
    url,
    original,
    sessions,
    fetcher,
    gate,
    nextDay: () => {
      now += 86400;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe("per-request denial gate", () => {
  it.each([
    201, 204, 206, 301, 302, 303, 304, 307, 308, 400, 401, 403, 408, 412, 429, 500, 503, 404, 410,
  ])("classifies HTTP %s", async (status) => {
    const f = await fixture();
    f.fetcher.mockImplementation(async () => new Response(null, { status }));
    expect(await f.gate.check(principal, ROOT)).toBe(
      status === 404 || status === 410 ? "revoked" : "unavailable",
    );
  });
  it.each([
    "malformed",
    "resource",
    "client",
    "revoked",
    "oversized",
    "utf8",
    "type",
  ])("denies a %s record", async (kind) => {
    const f = await fixture();
    const data = recordData();
    if (kind === "resource") data.resource += "/other";
    if (kind === "client") data.client += "/other";
    let body = buildConnectionRecord(f.url, data);
    if (kind === "revoked")
      body = await revokeConnectionRecord(body, "text/turtle", f.url, new Date());
    if (kind === "malformed") body = "broken RDF";
    if (kind === "oversized") body = " ".repeat(65537);
    f.fetcher.mockImplementation(
      async () =>
        new Response(kind === "utf8" ? new Uint8Array([0xff]) : body, {
          headers: { "content-type": kind === "type" ? "text/plain" : "text/turtle" },
        }),
    );
    expect(await f.gate.check(principal, ROOT)).toBe("revoked");
  });
  it("reads every time and touches once per UTC day with the exact strong ETag", async () => {
    const f = await fixture();
    expect(await f.gate.check(principal, ROOT)).toBe("live");
    const writes = () =>
      f.fetcher.mock.calls
        .map(([input, init]) => (input instanceof Request ? input : new Request(input, init)))
        .filter((r) => r.method === "PUT");
    expect(writes()).toHaveLength(1);
    expect(
      f.fetcher.mock.calls
        .filter(([input]) => input instanceof Request && input.method === "GET")
        .every(([input]) => input instanceof Request && input.cache === "no-store"),
    ).toBe(true);
    expect(writes()[0]?.headers.get("if-match")).toMatch(/^"/);
    expect(writes()[0]?.headers.get("content-type")).toBe("text/turtle");
    expect(await f.gate.check(principal, ROOT)).toBe("live");
    expect(writes()).toHaveLength(1);
    f.nextDay();
    expect(await f.gate.check(principal, ROOT)).toBe("live");
    expect(writes()).toHaveLength(2);
    expect(
      (
        await parseConnectionRecord(await (await f.pod.fetch(f.url)).text(), "text/turtle", f.url)
      ).lastUsed?.toISOString(),
    ).toBe("2026-11-12T00:00:00.000Z");
  });
  it.each([
    "weak",
    "missing",
    "412",
    "500",
    "throw",
    "timeout",
  ])("ignores %s last-used failures", async (kind) => {
    const f = await fixture();
    f.fetcher.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "PUT") {
        if (kind === "throw") throw new Error("upstream failed");
        if (kind === "timeout") return new Promise(() => {});
        return new Response(null, { status: Number(kind) });
      }
      const response = await f.pod.fetch(request);
      if (kind === "missing") response.headers.delete("etag");
      if (kind === "weak") response.headers.set("etag", 'W/"one"');
      return response;
    });
    const check = f.gate.check(principal, ROOT);
    expect(await check).toBe("live");
  });
  it.each([
    "network",
    "body",
    "timeout",
    "broker",
    "redirected",
    "url",
  ])("fails closed without revoking on %s failures", async (kind) => {
    const f = await fixture();
    if (kind === "broker")
      vi.mocked(f.sessions.fetchFor).mockRejectedValue(new Error("broker offline"));
    else
      f.fetcher.mockImplementation(async () => {
        if (kind === "network") throw new TypeError("network disconnected");
        if (kind === "timeout") return new Promise(() => {});
        if (kind === "body")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("body network error"));
              },
            }),
          );
        const response = new Response(f.original, { headers: { "content-type": "text/turtle" } });
        Object.defineProperty(response, kind === "redirected" ? "redirected" : "url", {
          value: kind === "redirected" ? true : "https://foreign.example/",
        });
        return response;
      });
    const check = f.gate.check(principal, ROOT);
    expect(await check).toBe("unavailable");
    expect(f.sessions.revoke).not.toHaveBeenCalled();
  });
  it("writes and verifies consent records as system writes, and time-bounds hung consent", async () => {
    const f = await fixture();
    const grant = {
      id: "new-grant",
      clientId: "opaque",
      session: { id: "session", webId: WEBID },
      resource: RESOURCE,
      scope: "mcp",
      expiresAt: at + 86400,
      revoked: false,
      refreshAllowed: true,
    };
    const event: Parameters<NonNullable<AuthorizationServerOptions["grantCreated"]>>[0] = {
      grant,
      client: {
        client_id: "opaque",
        client_id_issued_at: at,
        client_name: "Test assistant",
        redirect_uris: ["https://assistant.example/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      redirectUri: "https://assistant.example/callback",
      issuedAt: at,
    };
    await f.gate.record(event, "ReadOnly");
    const url = await connectionRecordUrl(ROOT, RESOURCE, "new-grant");
    const record = await parseConnectionRecord(
      await (await f.pod.fetch(url)).text(),
      "text/turtle",
      url,
    );
    expect(record).toMatchObject({
      title: "Test assistant",
      access: `${MCP}ReadOnly`,
      personalDataMode: `${MCP}OwnerPolicy`,
      purposes: ["https://w3id.org/dpv#ServiceProvision", "https://w3id.org/dpv#Personalisation"],
    });
    expect((await f.pod.fetch(`${ROOT}private/pkg/clients/.acl`)).status).toBe(200);
    await expect(f.gate.record(event, "ReadOnly")).rejects.toThrow();
    await f.gate.record(
      {
        ...event,
        grant: { ...grant, id: "read-write" },
        client: { ...event.client, client_name: undefined },
      },
      "ReadWrite",
    );
    const writableUrl = await connectionRecordUrl(ROOT, RESOURCE, "read-write");
    expect(
      await parseConnectionRecord(
        await (await f.pod.fetch(writableUrl)).text(),
        "text/turtle",
        writableUrl,
      ),
    ).toMatchObject({ access: `${MCP}ReadWrite` });
    for (const status of [200, 404, 503]) {
      const id = `readback-${status}`;
      const target = await connectionRecordUrl(ROOT, RESOURCE, id);
      f.fetcher.mockImplementation(async (input, init) => {
        const request = new Request(input, init);
        if (request.method === "GET" && request.url === target) {
          const changed = buildConnectionRecord(target, {
            ...recordData(),
            client: "https://other.example/app",
          });
          return new Response(status === 200 ? changed : null, {
            status,
            headers: { "content-type": "text/turtle" },
          });
        }
        return f.pod.fetch(request);
      });
      await expect(
        f.gate.record({ ...event, grant: { ...grant, id } }, "ReadOnly"),
      ).rejects.toThrow("Connection verification failed");
    }
    f.fetcher.mockImplementation(f.pod.fetch);
    vi.mocked(f.sessions.fetchFor).mockImplementation(() => new Promise(() => {}));
    const writing = f.gate.record({ ...event, grant: { ...grant, id: "hung" } }, "ReadWrite");
    const assertion = expect(writing).rejects.toThrow("timed out");
    await assertion;
  });
});
