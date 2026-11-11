// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, test, vi } from "vitest";
import { createMemoryCache } from "./cache.js";
import { parseLwsDescription } from "./lws-description.js";
import { resolveStorageDescription } from "./resolve.js";
import { parseSolidDescription } from "./solid-description.js";
import { sparqLwsCid } from "./testing.js";
import { PIM, SOLID } from "./vocab.js";

const ROOT = "https://pod.example/";
const OWNER = "https://id.example/alice#me";
const DESCRIPTION = `${ROOT}.well-known/solid`;
const readFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("storage owners", () => {
  test("CSS fixture maps solid:owner through discovery, refresh and cached reads", async () => {
    let now = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) =>
      init?.method === "HEAD"
        ? new Response(null, {
            headers: {
              link: `<${PIM.Storage}>; rel="type", <${DESCRIPTION}>; rel="${SOLID.storageDescription}"`,
            },
          })
        : new Response(readFixture("css.ttl"), {
            headers: { "content-type": "text/turtle", "cache-control": "max-age=1", etag: '"v1"' },
          }),
    );
    const options = { fetch, cache: createMemoryCache(), now: () => now };
    const description = await resolveStorageDescription(ROOT, options);
    expect(description.owner).toBe(OWNER);
    expect((await resolveStorageDescription(`${ROOT}sibling`, options)).owner).toBe(OWNER);
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 1000;
    fetch.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect((await resolveStorageDescription(ROOT, options)).owner).toBe(OWNER);
    now = 2000;
    fetch.mockResolvedValueOnce(new Response("", { headers: { "content-type": "text/turtle" } }));
    expect((await resolveStorageDescription(ROOT, options)).owner).toBeNull();
  });

  test("a version-2 parsed cache without owner is rediscovered unconditionally", async () => {
    const cache = createMemoryCache();
    const old = parseLwsDescription(sparqLwsCid, sparqLwsCid.id, "https://lws.example/doc");
    const { owner: _owner, ...legacy } = old;
    await cache.set(old.id, { version: 2, description: legacy as typeof old });
    await cache.rememberPrefix(old.root, old.id);
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify(sparqLwsCid), {
          headers: { "content-type": "application/lws+cid" },
        }),
    );
    const resolved = await resolveStorageDescription("https://lws.example/doc", {
      fetch,
      cache,
      seedHeaders: new Headers({ link: `<${old.id}>; rel="https://www.w3.org/ns/lws#storage"` }),
    });
    expect(resolved.owner).toBe(OWNER);
    expect(fetch).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has("if-none-match")).toBe(false);
  });

  test("the LWS fixture uses the CID controller, independently of verification method controllers", () => {
    expect(parseLwsDescription(sparqLwsCid, sparqLwsCid.id, "https://lws.example/doc").owner).toBe(
      OWNER,
    );
    expect(
      parseLwsDescription(
        { ...sparqLwsCid, controller: undefined },
        sparqLwsCid.id,
        "https://lws.example/doc",
      ).owner,
    ).toBeNull();
  });

  test.each([
    "http://id.example/me",
    OWNER,
    "https://id.example/雪#我",
  ])("accepts an absolute HTTP(S) IRI: %s", async (owner) => {
    const dataset = await parseRdf(`<${ROOT}> <${SOLID.owner}> <${owner}>.`, "text/turtle");
    expect(parseSolidDescription(dataset, ROOT).owner).toBe(owner);
    expect(
      parseLwsDescription(
        { ...sparqLwsCid, controller: owner },
        sparqLwsCid.id,
        "https://lws.example/doc",
      ).owner,
    ).toBe(owner);
  });

  test.each([
    undefined,
    null,
    "",
    "/relative",
    "id.example/alice",
    "urn:person:alice",
    "did:key:alice",
    "https:relative",
    "https:/relative",
    "https://[invalid",
    "https://id.example/white space",
    "https://id.example/\nme",
    "https://id.example/%GG",
    "https://id.example/\u0000me",
    "https://id.example/\ud800",
    "https://id.example/\\me",
    3,
    [],
    [OWNER],
    { id: OWNER },
  ])("invalid CID controller is advisory null: %j", (controller) => {
    expect(
      parseLwsDescription({ ...sparqLwsCid, controller }, sparqLwsCid.id, "https://lws.example/doc")
        .owner,
    ).toBeNull();
  });

  test.each([
    '"https://id.example/alice#me"',
    "[]",
    "<urn:alice>",
  ])("invalid Solid owner term is null: %s", async (term) => {
    const dataset = await parseRdf(`<${ROOT}> <${SOLID.owner}> ${term}.`, "text/turtle");
    expect(parseSolidDescription(dataset, ROOT).owner).toBeNull();
  });

  test("foreign subjects and assumed roots supply no owner", async () => {
    const dataset = await parseRdf(
      `<${ROOT}> <${SOLID.owner}> <${OWNER}>. <${ROOT}other> <${SOLID.owner}> <https://id.example/other>.`,
      "text/turtle",
    );
    expect(parseSolidDescription(dataset, `${ROOT}unrelated`).owner).toBeNull();
    expect(parseSolidDescription(dataset, ROOT, true).owner).toBeNull();
  });
});
