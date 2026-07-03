// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { DIET_MEAL, DIET_SYMPTOM } from "@jeswr/solid-health-diary";
import { describe, expect, it, vi } from "vitest";
import { mealsContainer } from "./layout";
import { registerDiaryTypes } from "./type-index";

const WEBID = "https://alice.example/profile/card#me";
const ROOT = "https://alice.example/";
const INDEX = "https://alice.example/settings/privateTypeIndex.ttl";

const PROFILE_TTL = `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<${WEBID}> solid:privateTypeIndex <${INDEX}> .`;

const EMPTY_INDEX_TTL = `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<${INDEX}> a solid:TypeIndex, solid:UnlistedDocument .`;

describe("registerDiaryTypes", () => {
  it("registers diet:Meal + diet:Symptom into an existing private index", async () => {
    const puts: { url: string; body: string }[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        puts.push({ url, body: String(init?.body ?? "") });
        return new Response("", { status: 200 });
      }
      const body =
        url === "https://alice.example/profile/card"
          ? PROFILE_TTL
          : url === INDEX
            ? EMPTY_INDEX_TTL
            : "";
      return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
    }) as unknown as typeof globalThis.fetch;

    const result = await registerDiaryTypes(fetch, { webId: WEBID, storageRoot: ROOT });
    expect(result.registered).toBe(true);
    expect(result.indexUrl).toBe(INDEX);
    const indexPut = puts.find((p) => p.url === INDEX);
    expect(indexPut).toBeTruthy();
    expect(indexPut?.body).toContain(DIET_MEAL);
    expect(indexPut?.body).toContain(DIET_SYMPTOM);
    expect(indexPut?.body).toContain(mealsContainer(ROOT));
  });

  it("never throws — a fetch failure resolves { registered: false }", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    await expect(registerDiaryTypes(fetch, { webId: WEBID, storageRoot: ROOT })).resolves.toEqual({
      registered: false,
    });
  });
});
