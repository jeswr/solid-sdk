// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { GmailChannelAdapter } from "./gmail.js";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

const RAW_EMAIL = [
  "From: Alice <alice@example.com>",
  "To: me@example.com",
  "Subject: Hello there",
  "Date: Mon, 06 Jul 2026 09:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi, quick question.",
  "",
].join("\r\n");

interface MockOptions {
  readonly listStatus?: number;
  readonly listBody?: unknown;
  readonly getStatus?: (id: string) => number;
  readonly getBody?: (id: string) => unknown;
}

function mockGmail(options: MockOptions = {}) {
  const requests: Array<{ url: string; auth: string | null }> = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    requests.push({ url, auth: headers.get("authorization") });
    if (url.includes("/messages?")) {
      const status = options.listStatus ?? 200;
      const body = options.listBody ?? { messages: [{ id: "m1" }, { id: "m2" }] };
      return new Response(status === 200 ? JSON.stringify(body) : null, { status });
    }
    const match = url.match(/\/messages\/([^?]+)\?format=raw/);
    const id = match?.[1] ? decodeURIComponent(match[1]) : "";
    const status = options.getStatus ? options.getStatus(id) : 200;
    const body = options.getBody ? options.getBody(id) : { raw: b64url(RAW_EMAIL) };
    return new Response(status === 200 ? JSON.stringify(body) : null, { status });
  }) as typeof fetch;
  return { fetchFn, requests };
}

describe("GmailChannelAdapter", () => {
  it("pulls raw messages and never leaks the token into a URL", async () => {
    const { fetchFn, requests } = mockGmail();
    const adapter = new GmailChannelAdapter({ token: () => "secret-token", fetch: fetchFn });
    const items = await adapter.pullInbound();
    expect(items.length).toBe(2);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.auth).toBe("Bearer secret-token");
      expect(request.url).not.toContain("secret-token");
    }
  });

  it("parses a pulled message through the bridge's hardened email parse", async () => {
    const { fetchFn } = mockGmail();
    const adapter = new GmailChannelAdapter({ token: () => "t", fetch: fetchFn });
    const [item] = await adapter.pullInbound();
    expect(item).toBeDefined();
    const message = adapter.parse(item as never);
    expect(message.channel).toBe("email");
    expect(message.subject).toContain("Hello");
    expect(message.sender?.handle).toContain("alice@example.com");
  });

  it("skips unsafe message ids without fetching them", async () => {
    const { fetchFn, requests } = mockGmail({
      listBody: { messages: [{ id: "m1" }, { id: "bad id!" }, { id: "../evil" }] },
    });
    const adapter = new GmailChannelAdapter({ token: () => "t", fetch: fetchFn });
    const items = await adapter.pullInbound();
    expect(items.length).toBe(1);
    expect(requests.some((r) => r.url.includes("bad"))).toBe(false);
    expect(requests.some((r) => r.url.includes("evil"))).toBe(false);
  });

  it("throws when the LIST call is not 2xx", async () => {
    const { fetchFn } = mockGmail({ listStatus: 500 });
    const adapter = new GmailChannelAdapter({ token: () => "t", fetch: fetchFn });
    await expect(adapter.pullInbound()).rejects.toThrow();
  });

  it("refuses a redirect on the LIST call (3xx throws)", async () => {
    const { fetchFn } = mockGmail({ listStatus: 302 });
    const adapter = new GmailChannelAdapter({ token: () => "t", fetch: fetchFn });
    await expect(adapter.pullInbound()).rejects.toThrow();
  });

  it("skips a message whose GET redirects or is not-ok (never aborts the batch)", async () => {
    const { fetchFn } = mockGmail({ getStatus: (id) => (id === "m1" ? 200 : 404) });
    const adapter = new GmailChannelAdapter({ token: () => "t", fetch: fetchFn });
    const items = await adapter.pullInbound();
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe("m1");
  });

  it("skips a message with a missing raw payload", async () => {
    const { fetchFn } = mockGmail({ getBody: () => ({}) });
    const adapter = new GmailChannelAdapter({ token: () => "t", fetch: fetchFn });
    expect((await adapter.pullInbound()).length).toBe(0);
  });

  it("caps the batch and asks Gmail for at most maxMessages", async () => {
    const { fetchFn, requests } = mockGmail();
    const adapter = new GmailChannelAdapter({ token: () => "t", fetch: fetchFn, maxMessages: 1 });
    const items = await adapter.pullInbound();
    expect(items.length).toBe(1);
    expect(requests[0]?.url).toContain("maxResults=1");
  });

  it("throws when the token provider yields nothing", async () => {
    const { fetchFn } = mockGmail();
    const adapter = new GmailChannelAdapter({ token: () => "", fetch: fetchFn });
    await expect(adapter.pullInbound()).rejects.toThrow();
  });
});
