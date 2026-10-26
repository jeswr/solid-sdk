// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { fixtureFetch } from "./fixture-fetch.js";
import { createFixtureRecorder, redactFixture } from "./fixture-recorder.js";

describe("fixture recorder redaction", () => {
  it("fails closed for unlisted scalars, arbitrary personal keys and nested structures", () => {
    const value = {
      personal: "private-value",
      "person@example.test": "private",
      items: [
        {
          id: 1,
          name: "Private Name",
          email: "private@example.test",
          profile: { city: "private-city" },
        },
      ],
      total: 1,
    };
    expect(redactFixture(value)).toEqual({});
    expect(redactFixture(value, ["total", "items.*.id"])).toEqual({ total: 1, items: [{ id: 1 }] });
    expect(value.items[0]?.name).toBe("Private Name");
    expect(redactFixture("private-value")).toBe("[REDACTED]");
    expect(redactFixture(null)).toBe("[REDACTED]");
    expect(redactFixture(["private-value"])).toEqual(["[REDACTED]"]);
  });

  it("rejects blanket wildcard paths rather than preserving an array of arbitrary scalars", () => {
    for (const path of ["*", "items.*", "items..id", ""]) {
      expect(() => redactFixture(["synthetic-private"], [path])).toThrow("scalar fields");
    }
  });

  it("never permits token, cookie or personal keys even when explicitly allowlisted", () => {
    const keys = [
      "access_token",
      "refreshToken",
      "Authorization",
      "Cookie",
      "Set-Cookie",
      "client_secret",
      "password",
      "api-key",
      "email",
      "phone_number",
      "postalAddress",
      "first_name",
      "last_name",
      "display_name",
      "name",
      "login",
      "accountId",
      "userId",
      "ssn",
      "birthdate",
      "latitude",
      "content",
      "bio",
      "avatar",
    ];
    const value = Object.fromEntries(keys.map((key) => [key, "synthetic-sensitive-value"]));
    expect(
      redactFixture(
        { nested: value },
        keys.map((key) => `nested.${key}`),
      ),
    ).toEqual({ nested: {} });
  });

  it("records only redacted JSON and public static URLs, preserving the source response", async () => {
    const body = {
      total: 1,
      items: [
        { id: "synthetic-id", name: "Private Name", access_token: "synthetic-private-token" },
      ],
    };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(body, {
        status: 201,
        headers: {
          "set-cookie": "synthetic-private-cookie",
          authorization: "synthetic-private-header",
        },
      }),
    );
    const recorder = createFixtureRecorder({
      fetch: transport,
      routes: [
        {
          url: "https://source.test/items",
          safeFields: ["total", "items.*.id", "items.*.access_token"],
        },
      ],
    });
    const request = new Request(
      "https://source.test/items/private-person?access_token=synthetic-query-token",
      {
        method: "POST",
        headers: { authorization: "Bearer synthetic-request-token", cookie: "synthetic-cookie" },
        body: "synthetic-private-body",
      },
    );
    const response = await recorder.fetch(request);
    expect(await response.json()).toEqual(body);
    expect(transport).toHaveBeenCalledWith(request, undefined);
    const fixtures = recorder.fixtures();
    expect(fixtures).toEqual([
      {
        url: "https://source.test/items",
        method: "POST",
        status: 201,
        json: { total: 1, items: [{ id: "synthetic-id" }] },
      },
    ]);
    const text = JSON.stringify(fixtures);
    for (const privateText of [
      "private-person",
      "access_token",
      "Private Name",
      "synthetic-private",
      "authorization",
      "cookie",
    ])
      expect(text).not.toContain(privateText);
    const replay = await fixtureFetch("recorder", fixtures)("https://source.test/items", {
      method: "POST",
    });
    expect(await replay.json()).toEqual(fixtures[0]?.json);
    fixtures.length = 0;
    expect(recorder.fixtures()).toHaveLength(1);
  });

  it("records pages in request order and replays different responses without saving dynamic URLs", async () => {
    let completeFirst: (response: Response) => void = () => {
      throw new Error("First request not started");
    };
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(
        Response.json({ page: 2, access_token: "synthetic-private" }, { status: 206 }),
      );
    const recorder = createFixtureRecorder({
      fetch: transport,
      routes: [{ url: "https://source.test/items", safeFields: ["page"] }],
    });
    const first = recorder.fetch("https://source.test/items?cursor=synthetic-private-first");
    const second = await recorder.fetch(
      "https://source.test/items?cursor=synthetic-private-second",
    );
    completeFirst(Response.json({ page: 1, email: "private@example.test" }));
    expect(await (await first).json()).toEqual({ page: 1, email: "private@example.test" });
    expect(await second.json()).toEqual({ page: 2, access_token: "synthetic-private" });
    const fixtures = recorder.fixtures();
    expect(fixtures.map((route) => route.json)).toEqual([{ page: 1 }, { page: 2 }]);
    expect(fixtures.map((route) => route.url)).toEqual([
      "https://source.test/items",
      "https://source.test/items",
    ]);
    expect(JSON.stringify(fixtures)).not.toMatch(/cursor|synthetic-private|email|access_token/);
    const replay = fixtureFetch("recorder", fixtures);
    expect(await (await replay("https://source.test/items?page=1")).json()).toEqual({ page: 1 });
    const replaySecond = await replay("https://source.test/items?page=2");
    expect(replaySecond.status).toBe(206);
    expect(await replaySecond.json()).toEqual({ page: 2 });
    await expect(replay("https://source.test/items?page=3")).rejects.toThrow("No fixture recorded");
  });

  it.each([
    false,
    true,
  ])("replays overlapping routes consistently with broad-first config %s", async (broadFirst) => {
    const routes = [
      { url: "https://source.test/items/special", safeFields: ["special"] },
      { url: "https://source.test/items", safeFields: ["ordinary"] },
    ];
    const recorder = createFixtureRecorder({
      routes: broadFirst ? routes.toReversed() : routes,
      fetch: async () => Response.json({ special: 1, ordinary: 2 }),
    });
    await recorder.fetch("https://source.test/items/ordinary");
    await recorder.fetch("https://source.test/items/special?cursor=synthetic");
    const fixtures = recorder.fixtures();
    expect(fixtures.map((route) => [route.url, route.json])).toEqual([
      ["https://source.test/items", { ordinary: 2 }],
      ["https://source.test/items/special", { special: 1 }],
    ]);
    const replay = fixtureFetch("recorder", fixtures);
    expect(await (await replay("https://source.test/items/special?cursor=replay")).json()).toEqual({
      special: 1,
    });
    expect(await (await replay("https://source.test/items/ordinary")).json()).toEqual({
      ordinary: 2,
    });
    await expect(replay("https://source.test/items-other")).rejects.toThrow("No fixture recorded");
  });

  it("leaves a Request body readable by the source transport and respects init overrides", async () => {
    const seen: string[] = [];
    const transport: typeof fetch = async (input, init) => {
      const sourceRequest = new Request(input, init);
      seen.push(await sourceRequest.text());
      return Response.json({ total: 1 });
    };
    const recorder = createFixtureRecorder({
      fetch: transport,
      routes: [{ url: "https://source.test/items", safeFields: ["total"] }],
    });
    await recorder.fetch(
      new Request("https://source.test/items", { method: "POST", body: "synthetic-first-body" }),
    );
    await recorder.fetch(
      new Request("https://source.test/items", { method: "POST", body: "synthetic-ignored-body" }),
      { method: "PUT", body: "synthetic-override-body" },
    );
    expect(seen).toEqual(["synthetic-first-body", "synthetic-override-body"]);
    expect(recorder.fixtures().map((route) => route.method)).toEqual(["POST", "PUT"]);
    expect(JSON.stringify(recorder.fixtures())).not.toContain("body");
  });

  it("defaults to redaction for URL inputs and explicit init, including error responses", async () => {
    const recorder = createFixtureRecorder({
      fetch: async () =>
        Response.json(
          { access_token: "synthetic-private", error: "private detail" },
          { status: 401 },
        ),
      routes: [{ url: "https://source.test/api/" }],
    });
    await recorder.fetch(new URL("https://source.test/api/items"), { method: "POST" });
    expect(recorder.fixtures()).toEqual([
      { url: "https://source.test/api/", method: "POST", status: 401, json: {} },
    ]);
  });

  it("refuses unsafe configuration and unconfigured requests before source I/O", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const url of [
      "http://source.test/items",
      "https://user:password@source.test/items",
      "https://source.test/items?token=value",
      "https://source.test/items#private",
    ])
      expect(() => createFixtureRecorder({ fetch, routes: [{ url }] })).toThrow(
        "public HTTPS prefixes",
      );
    const recorder = createFixtureRecorder({
      fetch,
      routes: [{ url: "https://source.test/items" }],
    });
    for (const url of ["https://foreign.test/items", "https://source.test/items-other"])
      await expect(recorder.fetch(url)).rejects.toThrow("no configured public recorder route");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose response bytes in non-JSON parse errors or snapshots", async () => {
    const recorder = createFixtureRecorder({
      fetch: async () => new Response("synthetic-private-invalid-json"),
      routes: [{ url: "https://source.test/items" }],
    });
    await expect(recorder.fetch("https://source.test/items")).rejects.toThrow(
      "accepts JSON responses only",
    );
    expect(recorder.fixtures()).toEqual([]);
  });
});
