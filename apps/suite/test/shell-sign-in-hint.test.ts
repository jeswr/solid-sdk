// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { hintForField, rememberedIssuer } from "../src/shell/lib/sign-in-hint";

describe("hintForField", () => {
  it("keeps the WebID field's intent, even for a bare origin", () => {
    expect(hintForField("webid", " https://alice.example/ ")).toEqual({
      webId: "https://alice.example/",
    });
    expect(hintForField("webid", "https://id.example/alice/profile/card#me")).toEqual({
      webId: "https://id.example/alice/profile/card#me",
    });
  });
  it("keeps the provider field's intent, even for a provider under a path", () => {
    expect(hintForField("provider", "https://id.example/realms/solid")).toEqual({
      issuer: "https://id.example/realms/solid",
    });
    expect(hintForField("provider", " notaurl ")).toEqual({ issuer: "notaurl" });
  });
});

describe("rememberedIssuer", () => {
  it("remembers issuers and never WebIDs", () => {
    expect(rememberedIssuer({ issuer: "https://login.example/" })).toBe("https://login.example/");
    expect(rememberedIssuer({ webId: "https://alice.example/profile/card#me" })).toBeNull();
  });
});
