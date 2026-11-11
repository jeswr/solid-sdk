// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { trustsExchangeOrigin, trustsLwsBinding } from "./lws-trust.js";

const trust = {
  issuer: "https://issuer.example/",
  roots: ["https://pod.example/alice/"],
  authorizationServers: ["https://lws.example/"],
};
const binding = (authorizationServer: string, realm: string, resource: string) => ({
  authorizationServer: new URL(authorizationServer),
  realm: new URL(realm),
  resource: new URL(resource),
});
const note = "https://pod.example/alice/note.txt";
/** Storage descriptions on pod.example and what each advertises. */
const descriptions: Record<string, string[]> = {
  "https://pod.example/storage": ["https://pod.example/alice/"],
  "https://pod.example/broad": ["https://pod.example/"],
  "https://pod.example/odd": [
    "https://pod.example/alice",
    "not a url/",
    "https://pod.example/alice/sub/",
  ],
};
const described = async (storage: string) => descriptions[storage] ?? [];

describe("LWS exchange trust for a pod session", () => {
  it.each([
    ["issuer origin", "https://issuer.example/as", true],
    ["storage root origin", "https://pod.example/as", true],
    ["configured server origin", "https://lws.example/other", true],
    ["foreign origin", "https://attacker.example/", false],
    ["issuer host on another port", "https://issuer.example:8443/", false],
  ])("trusts the %s as an exchange endpoint: %s", (_, endpoint, expected) => {
    expect(trustsExchangeOrigin(trust, new URL(endpoint))).toBe(expected);
  });

  it.each([
    [
      "a storage description on the resource origin",
      "https://lws.example/",
      "https://pod.example/storage",
      note,
      true,
    ],
    [
      "a container realm inside a root",
      "https://lws.example/",
      "https://pod.example/alice/",
      note,
      true,
    ],
    ["the resource itself as realm", "https://lws.example/", note, note, true],
    [
      "a foreign authorization server",
      "https://attacker.example/",
      "https://pod.example/storage",
      note,
      false,
    ],
    [
      "a resource outside every root",
      "https://lws.example/",
      "https://pod.example/storage",
      "https://pod.example/bob/x",
      false,
    ],
    [
      "a container realm outside every root",
      "https://lws.example/",
      "https://pod.example/",
      note,
      false,
    ],
    [
      "a storage description on another origin",
      "https://lws.example/",
      "https://other.example/storage",
      note,
      false,
    ],
    // #405 gate: a same-origin description can't widen the audience beyond the stored grant.
    [
      "a same-origin description whose root lies outside the grant",
      "https://lws.example/",
      "https://pod.example/broad",
      note,
      false,
    ],
    [
      "a description whose roots are not containers, unparseable, or don't contain the resource",
      "https://lws.example/",
      "https://pod.example/odd",
      note,
      false,
    ],
    [
      "an unreadable or empty description",
      "https://lws.example/",
      "https://pod.example/missing",
      note,
      false,
    ],
  ])("accepts %s: %s", async (_, as, realm, resource, expected) => {
    expect(await trustsLwsBinding(trust, binding(as, realm, resource), described)).toBe(expected);
  });

  it("reads a description only for a same-origin non-container realm of a trusted binding", async () => {
    const reads: string[] = [];
    const spy = async (storage: string) => {
      reads.push(storage);
      return described(storage);
    };
    await trustsLwsBinding(
      trust,
      binding("https://lws.example/", "https://pod.example/alice/", note),
      spy,
    );
    await trustsLwsBinding(
      trust,
      binding("https://attacker.example/", "https://pod.example/storage", note),
      spy,
    );
    await trustsLwsBinding(
      trust,
      binding("https://lws.example/", "https://other.example/storage", note),
      spy,
    );
    expect(reads).toEqual([]);
    await trustsLwsBinding(
      trust,
      binding("https://lws.example/", "https://pod.example/storage", note),
      spy,
    );
    expect(reads).toEqual(["https://pod.example/storage"]);
  });

  it("trusts nothing without roots", async () => {
    expect(
      await trustsLwsBinding(
        { ...trust, roots: [] },
        binding("https://issuer.example/", note, note),
        described,
      ),
    ).toBe(false);
  });
});
