// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { profileReader } from "../src/apps/agent/lib/profile";

const credentialed = async () => new Response("credentialed");
const publicFetch = async () => new Response("public");
const webId = "https://alice.example/profile/card#me";

describe("profileReader", () => {
  it("uses the credentialed fetch without a public fetch or a granted storage", () => {
    expect(profileReader({ fetch: credentialed, webId })).toBe(credentialed);
    expect(profileReader({ fetch: credentialed, webId, publicFetch })).toBe(credentialed);
    expect(
      profileReader({ fetch: credentialed, webId, storageUrl: "https://other.example/" }),
    ).toBe(credentialed);
  });
  it("keeps the credentialed fetch for a profile inside the granted storage", () => {
    expect(
      profileReader({
        fetch: credentialed,
        webId,
        publicFetch,
        storageUrl: "https://alice.example/",
      }),
    ).toBe(credentialed);
  });
  it("reads a profile outside the granted storage credential-free", () => {
    for (const storageUrl of ["https://other.example/", "https://alice.example/pod/"])
      expect(profileReader({ fetch: credentialed, webId, publicFetch, storageUrl })).toBe(
        publicFetch,
      );
  });
});
