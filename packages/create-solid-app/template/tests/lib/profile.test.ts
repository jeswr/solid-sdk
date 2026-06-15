// Unit test for the profile data layer. It runs WITHOUT a browser and WITHOUT a
// network: `readProfile` takes an injected `fetch`, so we hand it a mock that
// returns a Turtle profile. This is the house pattern — the data layer is a
// pure function of (webId, fetch), exercised here against the published
// @jeswr/fetch-rdf + @solid/object stack.
import { describe, it, expect } from "vitest";
import { readProfile } from "@/lib/solid/profile";

const WEBID = "https://alice.example/profile/card#me";

const PROFILE_TTL = `
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix pim: <http://www.w3.org/ns/pim/space#>.
@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.
<> a foaf:PersonalProfileDocument; foaf:primaryTopic <${WEBID}>.
<${WEBID}> a foaf:Person;
  foaf:name "Alice Example";
  vcard:note "Builds things on Solid.";
  solid:oidcIssuer <https://example.solidcommunity.net/>;
  pim:storage <https://alice.example/storage/>.
`;

/** A fetch that serves the fixture Turtle for the WebID document. */
function mockFetch(ttl: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    expect(url).toContain("/profile/card");
    return new Response(ttl, {
      status: 200,
      headers: { "content-type": "text/turtle", etag: '"abc"' },
    });
  }) as typeof fetch;
}

describe("readProfile", () => {
  it("reads name, bio, storage and issuer through the object mapper", async () => {
    const profile = await readProfile(WEBID, mockFetch(PROFILE_TTL));
    expect(profile.webId).toBe(WEBID);
    expect(profile.name).toBe("Alice Example");
    expect(profile.bio).toBe("Builds things on Solid.");
    expect(profile.storages).toEqual(["https://alice.example/storage/"]);
    expect(profile.oidcIssuers).toEqual([
      "https://example.solidcommunity.net/",
    ]);
  });

  it("falls back to the WebID IRI when no name is present", async () => {
    const bare = `
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<${WEBID}> a foaf:Person; solid:oidcIssuer <https://example.solidcommunity.net/>.
`;
    const profile = await readProfile(WEBID, mockFetch(bare));
    expect(profile.name).toBe(WEBID);
    expect(profile.storages).toEqual([]);
  });

  it("throws when the profile has no solid:oidcIssuer (unusable WebID)", async () => {
    const noIssuer = `
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
<${WEBID}> a foaf:Person; foaf:name "No Issuer".
`;
    await expect(readProfile(WEBID, mockFetch(noIssuer))).rejects.toThrow(
      /no Solid-OIDC subject/i,
    );
  });
});
