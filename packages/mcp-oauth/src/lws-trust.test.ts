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
  ])("accepts %s: %s", (_, as, realm, resource, expected) => {
    expect(trustsLwsBinding(trust, binding(as, realm, resource))).toBe(expected);
  });

  it("trusts nothing without roots", () => {
    expect(
      trustsLwsBinding({ ...trust, roots: [] }, binding("https://issuer.example/", note, note)),
    ).toBe(false);
  });
});
