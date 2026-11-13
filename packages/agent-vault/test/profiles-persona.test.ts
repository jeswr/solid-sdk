// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { readFileSync } from "fs";
import { Parser } from "n3";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { PersonaResolver, Profiles } from "../src/index.js";
import { account, SITE, setup } from "./helpers.js";

describe("RDF profiles and deterministic persona selection", () => {
  it("round trips escaped RDF facts, several accounts and SSO provider account", async () => {
    const { profiles, store, dir } = setup();
    await account(profiles);
    await account(profiles, "business", "work");
    await profiles.putAccount({
      id: "provider",
      site: "https://identity.test",
      profile: "work",
      label: 'Alex "Example"\nwork',
    });
    const route = {
      site: SITE,
      account: "business",
      profile: "work",
      method: "sso:identity",
      provider: "identity",
      providerAccount: "provider",
      refresh: { urlTemplate: `${SITE}/token`, tokenPointer: "/access" },
      sessionCookies: ["sid"],
    };
    await profiles.putRoute(route);
    expect(new Profiles(store).route(SITE, "business")).toEqual(route);
    expect(profiles.accounts()).toHaveLength(3);
    expect(profiles.profiles()).toHaveLength(2);
    const raw = JSON.parse(readFileSync(join(dir, "vault/account-graph.json"), "utf8"));
    expect(new Parser().parse(raw.turtle).length).toBeGreaterThan(15);
    expect(raw.turtle).toContain("schema:label");
  });
  it("filters site, profile, domain, then explicit lastUsed; never silently chooses among ties", async () => {
    const { profiles } = setup();
    const personal = await account(profiles);
    const work = await account(profiles, "business", "work");
    const resolver = new PersonaResolver(profiles);
    expect(resolver.resolveAccount(SITE)).toMatchObject({
      ask: { candidates: [personal, work].sort((a, b) => a.id.localeCompare(b.id)) },
    });
    expect(resolver.resolveAccount(SITE, { profileHint: "work" })).toEqual({ account: work });
    expect(resolver.resolveAccount(SITE, { emailDomain: "EXAMPLE.TEST" })).toEqual({
      account: personal,
    });
    expect(resolver.resolveAccount(SITE, { lastUsed: "alex" })).toEqual({ account: personal });
    expect(resolver.resolveAccount(SITE, { profileHint: "work", lastUsed: "alex" })).toEqual({
      account: work,
    });
    expect(resolver.resolveAccount("https://other.test")).toMatchObject({
      ask: { candidates: [] },
    });
    expect(resolver.resolveAccount(SITE, { profileHint: "missing" })).toMatchObject({
      ask: { candidates: [] },
    });
  });
  it("rejects profile/account/route cross-binding, malformed origin and unknown fields", async () => {
    const { profiles } = setup();
    await account(profiles);
    await expect(
      profiles.putAccount({ id: "x", site: SITE, profile: "missing", label: "x" }),
    ).rejects.toThrow("Vault invalid");
    await expect(
      profiles.putAccount({
        id: "alex",
        site: "https://other.test",
        profile: "personal",
        label: "x",
      }),
    ).rejects.toThrow();
    await expect(
      profiles.putRoute({ site: SITE, account: "alex", profile: "work", method: "passkey" }),
    ).rejects.toThrow();
    await expect(
      profiles.putRoute({
        site: SITE,
        account: "alex",
        profile: "personal",
        method: "sso:identity",
      }),
    ).rejects.toThrow();
    await expect(
      profiles.putAccount({ id: "bad", site: `${SITE}/path`, profile: "personal", label: "x" }),
    ).rejects.toThrow();
    await expect(
      profiles.putProfile({ id: "valid", label: "x", password: "no" } as never),
    ).rejects.toThrow();
  });
  it("serializes concurrent fact updates without losing accounts", async () => {
    const { profiles } = setup();
    await account(profiles);
    await Promise.all(
      ["a", "b", "c"].map((id) =>
        profiles.putAccount({ id, site: SITE, profile: "personal", label: id }),
      ),
    );
    expect(profiles.accounts(SITE)).toHaveLength(4);
  });
});
