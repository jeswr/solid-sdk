// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { list } from "../src/index.js";
import { CONTAINER_LISTING, REGISTRY_INLINE, VALID_FLAT } from "./fixtures.js";

/** Build a fetch stub that serves a fixed map of URL → Turtle body. */
function stubFetch(routes: Record<string, string>): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = routes[url];
    if (body === undefined) {
      return new Response("not found", { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/turtle" },
    });
  }) as typeof globalThis.fetch;
}

describe("list", () => {
  it("lists inline fedapp:App registrations from a registry resource", async () => {
    const fetch = stubFetch({ "https://registry.example/apps": REGISTRY_INLINE });
    const entries = await list("https://registry.example/apps", { fetch });
    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toEqual(["https://app.example/one", "https://app.example/two"]);
    for (const e of entries) {
      expect(e.valid).toBe(true);
      expect(e.source).toBe("https://registry.example/apps");
    }
  });

  it("follows ldp:contains members of a container when there are no inline apps", async () => {
    const fetch = stubFetch({
      "https://registry.example/apps/": CONTAINER_LISTING,
      "https://registry.example/apps/app-a": VALID_FLAT,
      "https://registry.example/apps/app-b": VALID_FLAT,
    });
    const entries = await list("https://registry.example/apps/", { fetch });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.source).sort()).toEqual([
      "https://registry.example/apps/app-a",
      "https://registry.example/apps/app-b",
    ]);
    expect(entries.every((e) => e.valid)).toBe(true);
  });

  it("skips broken container members without sinking the listing", async () => {
    const fetch = stubFetch({
      "https://registry.example/apps/": CONTAINER_LISTING,
      "https://registry.example/apps/app-a": VALID_FLAT,
      // app-b is intentionally absent → 404 → fetchRdf throws → skipped.
    });
    const entries = await list("https://registry.example/apps/", { fetch });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe("https://registry.example/apps/app-a");
  });

  it("does not follow members when followContainer is false", async () => {
    const fetch = stubFetch({ "https://registry.example/apps/": CONTAINER_LISTING });
    const entries = await list("https://registry.example/apps/", {
      fetch,
      followContainer: false,
    });
    expect(entries).toHaveLength(0);
  });

  it("returns nothing for a source that is neither a registry nor a container", async () => {
    const fetch = stubFetch({
      "https://registry.example/empty":
        "@prefix foaf: <http://xmlns.com/foaf/0.1/> .\n<#x> a foaf:Agent .",
    });
    const entries = await list("https://registry.example/empty", { fetch });
    expect(entries).toHaveLength(0);
  });

  it("carries verification issues for an invalid listed registration", async () => {
    const badRegistry = `
@prefix fedapp: <https://w3id.org/jeswr/fed#> .
<https://app.example/bad> a fedapp:App .
`;
    const fetch = stubFetch({ "https://registry.example/apps": badRegistry });
    const entries = await list("https://registry.example/apps", { fetch });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.valid).toBe(false);
    expect(entries[0]?.issues.map((i) => i.code)).toContain("empty-registration");
  });
});
