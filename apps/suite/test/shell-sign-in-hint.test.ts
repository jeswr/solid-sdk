// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { hintFor } from "../src/shell/lib/sign-in-hint";

describe("hintFor", () => {
  it("treats documents and fragments as WebIDs", () => {
    expect(hintFor(" https://id.example/alice/profile/card#me ")).toEqual({
      webId: "https://id.example/alice/profile/card#me",
    });
    expect(hintFor("https://pod.example/#me")).toEqual({ webId: "https://pod.example/#me" });
    expect(hintFor("https://pod.example/alice")).toEqual({ webId: "https://pod.example/alice" });
  });
  it("treats bare origins and non-URLs as issuers", () => {
    expect(hintFor("https://login.example/")).toEqual({ issuer: "https://login.example/" });
    expect(hintFor("https://login.example")).toEqual({ issuer: "https://login.example" });
    expect(hintFor("notaurl")).toEqual({ issuer: "notaurl" });
  });
});
