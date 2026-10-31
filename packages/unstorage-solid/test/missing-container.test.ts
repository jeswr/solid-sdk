// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { listContainer } from "../src/container.js";
import solidDriver from "../src/index.js";

vi.unmock("@jeswr/storage-client");

let fixtureId = 0;

function fixture(status: number) {
  const base = `https://unstorage-absent-${++fixtureId}.example/kv/`;
  const cancel = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(new ReadableStream({ cancel }), { status }),
  );
  return { base, fetch, cancel };
}

describe.each([404, 410])("cold discovery on an absent mount (%s)", (status) => {
  it("returns null from the compatibility listing without discovery links", async () => {
    const { base, fetch, cancel } = fixture(status);
    await expect(listContainer(base, base, fetch)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(base, expect.objectContaining({ method: "HEAD" }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    "",
    "sub:",
  ])("lists and clears the absent prefix %j without mutations", async (prefix) => {
    const { base, fetch } = fixture(status);
    const driver = solidDriver({ base, fetch });
    await expect(driver.getKeys(prefix, {})).resolves.toEqual([]);
    await expect(driver.clear?.(prefix, {})).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(base);
      expect(init?.method).toBe("HEAD");
    }
  });
});

it.each([200, 401, 403, 500])("does not infer absence from discovery status %s", async (status) => {
  const { base, fetch } = fixture(status);
  await expect(listContainer(base, base, fetch)).rejects.toMatchObject({ code: "no-storage-link" });
  const driver = solidDriver({ base, fetch });
  await expect(driver.getKeys("", {})).rejects.toMatchObject({ code: "no-storage-link" });
  await expect(driver.clear?.("", {})).rejects.toMatchObject({ code: "no-storage-link" });
});

it.each([
  [404, false],
  [404, true],
  [410, false],
  [410, true],
] as const)("does not confuse an absent description (%s, same URL: %s) with an absent mount", async (status, sameUrl) => {
  const { base } = fixture(status);
  const description = sameUrl ? base : new URL("/.well-known/storage", base).href;
  const fetch: typeof globalThis.fetch = async (input, init) =>
    String(input) === base && init?.method === "HEAD"
      ? new Response(null, {
          headers: {
            link: `<${description}>; rel="https://www.w3.org/ns/lws#storage"`,
          },
        })
      : new Response(null, { status });
  await expect(listContainer(base, base, fetch)).rejects.toMatchObject({
    code: "description-unreachable",
    status,
  });
  const driver = solidDriver({ base, fetch });
  await expect(driver.getKeys("", {})).rejects.toMatchObject({ code: "description-unreachable" });
  await expect(driver.clear?.("", {})).rejects.toMatchObject({ code: "description-unreachable" });
});

it.each([
  404, 410,
])("does not infer mount absence from an OPTIONS probe returning %s", async (status) => {
  const { base } = fixture(status);
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: {
          link: '<http://www.w3.org/ns/pim/space#Storage>; rel="type"',
          "updates-via": "wss://notifications.example/updates",
        },
      });
    if (init?.method === "OPTIONS") return new Response(null, { status });
    return new Response("", { headers: { "content-type": "text/turtle" } });
  };
  await expect(listContainer(base, base, fetch)).resolves.toEqual([]);
});
