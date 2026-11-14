// AUTHORED-BY Codex GPT-6.1-Sol
import { type Operation, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { readBackIdentityMatches, validateWriteResponsePolicy } from "../src/write-response.js";

const origin = "https://shop.test";
const read: Operation = {
  id: "urn:read",
  label: "Read example",
  actionType: `${SCHEMA}ViewAction`,
  effect: "read",
  session: "none",
  inputs: [],
  request: { method: "GET", urlTemplate: `${origin}/example` },
  extraction: {
    format: "json",
    itemType: `${SCHEMA}Thing`,
    fields: [
      { property: `${SCHEMA}identifier`, path: "/id" },
      { property: `${SCHEMA}name`, path: "/name", untrusted: true },
    ],
  },
  provenance: {
    method: "crawl",
    learnedAt: "2026-11-14T00:00:00Z",
    derivedFrom: [],
    confidence: 1,
  },
};
const model: SiteModel = {
  id: "urn:model",
  site: origin,
  generatedAt: read.provenance.learnedAt,
  version: "1",
  operations: [read],
  flows: [],
  login: [{ method: "password", sessionCookies: ["own"] }],
};

it.each([
  "session intake",
  "Set-Cookie intake",
])("r12 unions host and executor credential declarations at %s", async (path) => {
  const secrets = new Set(["Seed7y"]);
  const declarations = {
    model: {
      login: [{ method: "password", sessionCookies: ["key"] }],
      operations: [
        {
          ...read,
          csrf: [
            {
              source: { kind: "cookie" as const, name: "other" },
              target: { kind: "query" as const, name: "token" },
            },
          ],
        },
      ],
    },
    declaredNames: ["declared"],
    loginCookieNames: ["learned"],
    secrets,
  };
  const pairs = [
    ["key", "Ab7xQ2"],
    ["other", "Cd8yR3"],
    ["own", "Ef9zS4"],
    ["declared", "Gh2wT5"],
    ["learned", "Ij3vU6"],
    ["vault", "Kl4uV7"],
  ];
  const before = JSON.stringify(declarations);
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    credentialCookies: ["vault"],
    cookies:
      path === "session intake"
        ? pairs.map(([name = "", value = ""]) => ({
            name,
            value,
            domain: "shop.test",
            path: "/",
            secure: true,
          }))
        : [],
  });
  const executor = createExecutor({
    model,
    sessions,
    credentialContext: declarations,
    fetch: async () => {
      const headers = new Headers({ "content-type": "application/json" });
      if (path === "Set-Cookie intake")
        for (const [name, value] of pairs)
          headers.append("set-cookie", `${name}=${value}; Path=/; Secure`);
      return new Response(
        JSON.stringify({
          id: "73",
          name: [...pairs.map(([, value]) => value), "Seed7y"].join(" "),
        }),
        { headers },
      );
    },
  });
  const result = await executor.execute({
    node: "urn:request",
    types: [read.actionType],
    values: () => [],
  });
  expect(result.status).toBe("done");
  const rdf = result.observations.map((o) => o.turtle).join("\n");
  expect(rdf).toContain('"73"');
  expect(rdf).toContain("[redacted]");
  for (const [, value] of pairs) expect(JSON.stringify(result)).not.toContain(value);
  expect(JSON.stringify(result)).not.toContain("Seed7y");
  expect(secrets.has("Ab7xQ2")).toBe(true);
  expect(JSON.stringify(declarations)).toBe(before);
});

it.each([
  ["https://shop.test/products/73", true],
  ["https://shop.test/categories/73", false],
  ["https://shop.test/stores/other/products/73", false],
  ["https://elsewhere.test/products/73", false],
  ["https://shop.test/products/73?scope=other", false],
  ["https://shop.test/products/73#other", false],
  ["https://shop.test/products/74", false],
])("r12 requires the learned resource IRI for %s", (url, expected) => {
  expect(readBackIdentityMatches(["73"], [url], "73", origin, [`${origin}/products/{id}`])).toBe(
    expected,
  );
});
it("r12 rejects numeric-only and conflicting read-back identities", () => {
  const pattern = [`${origin}/products/{id}`];
  expect(readBackIdentityMatches(["73"], [], "73", origin, pattern)).toBe(false);
  expect(readBackIdentityMatches(["74"], [`${origin}/products/73`], "73", origin, pattern)).toBe(
    false,
  );
  expect(
    readBackIdentityMatches(
      ["73"],
      [`${origin}/products/73`, `${origin}/categories/73`],
      "73",
      origin,
      pattern,
    ),
  ).toBe(false);
});
it.each([
  "/products/{other}",
  "/products/{id}/{id}",
  "/products/prefix-{id}",
  "https://elsewhere.test/products/{id}",
  "/products/{id}?tenant=other",
])("r12 validates read-back identity patterns (%s)", (pattern) => {
  expect(() =>
    validateWriteResponsePolicy(
      {
        createdLocationPattern: "/products/edit/id/{id}",
        readBack: {
          operation: read.id,
          bind: { id: { identity: true } },
          identityPattern: pattern,
        },
      },
      origin,
    ),
  ).toThrow();
});
