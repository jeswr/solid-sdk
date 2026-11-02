// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  ensurePrivateIndexAccess,
  ensurePrivateTasksAccess,
} from "../../src/apps/tasks/state/access";

const storageUrl = "https://alice.demo.pod/";
const webId = `${storageUrl}profile#me`;
const make = (fetch: typeof globalThis.fetch, mode = "demo") => ({
  mode,
  storageUrl,
  webId,
  fetch,
});
const marker = { "X-Solid-Demo-Access-Control": "none" };
describe("demo-only owner access verification", () => {
  it("fails closed for real sessions and wrong owners without fetching", async () => {
    const fetch = vi.fn();
    expect(await ensurePrivateTasksAccess(make(fetch, "real"), storageUrl, webId)).toBe(false);
    expect(await ensurePrivateIndexAccess(make(fetch), storageUrl, "other")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts only the explicit marker on an existing resource or its nearest existing parent", async () => {
    const visited: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      visited.push(String(input));
      return new Response(null, {
        status: String(input) === `${storageUrl}tasks/` ? 200 : 404,
        headers: marker,
      });
    };
    expect(
      await ensurePrivateTasksAccess(make(fetch), `${storageUrl}tasks/projects/home.ttl`, webId),
    ).toBe(true);
    expect(visited).toEqual([
      `${storageUrl}tasks/projects/home.ttl`,
      `${storageUrl}tasks/projects/`,
      `${storageUrl}tasks/`,
    ]);
    expect(
      await ensurePrivateIndexAccess(
        make(async () => new Response(null, { headers: marker })),
        `${storageUrl}settings/index.ttl`,
        webId,
      ),
    ).toBe(true);
  });
  it.each([405, 501])("falls back from HEAD %s to GET", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(null, { headers: marker }));
    expect(await ensurePrivateTasksAccess(make(fetch), storageUrl, webId)).toBe(true);
    expect(fetch.mock.calls[1]?.[1]?.method).toBeUndefined();
  });
  it("rejects missing/different markers, errors, redirects, outside paths and broken URLs", async () => {
    for (const response of [
      new Response(),
      new Response(null, { headers: { "X-Solid-Demo-Access-Control": "wac" } }),
      new Response(null, { status: 403 }),
      new Response(null, { status: 302 }),
      new Response(null, { status: 404 }),
    ]) {
      expect(
        await ensurePrivateTasksAccess(
          make(async () => response),
          storageUrl,
          webId,
        ),
      ).toBe(false);
    }
    const fetch = vi.fn(async () => new Response(null, { headers: marker }));
    for (const url of [
      "broken",
      "https://elsewhere.test/",
      "https://user:pass@alice.demo.pod/",
      "https://:pass@alice.demo.pod/",
      `${storageUrl}?x=1`,
      `${storageUrl}#x`,
    ])
      expect(await ensurePrivateTasksAccess(make(fetch), url, webId)).toBe(false);
    expect(
      await ensurePrivateTasksAccess(
        { ...make(fetch), storageUrl: `${storageUrl}alice/` },
        `${storageUrl}bob/`,
        webId,
      ),
    ).toBe(false);
    expect(
      await ensurePrivateTasksAccess(
        make(async () => {
          throw new Error("offline");
        }),
        storageUrl,
        webId,
      ),
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await ensurePrivateTasksAccess(
        {
          ...make(async () => new Response(null, { status: 404 })),
          storageUrl: `${storageUrl}alice`,
        },
        `${storageUrl}alice/child`,
        webId,
      ),
    ).toBe(false);
  });
});
