// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { selfDescribe, serialize } from "../src/index.js";

describe("serialize", () => {
  it("serialises quads to Turtle by default", async () => {
    const { quads } = selfDescribe({
      id: "https://app.example/id",
      sectors: ["https://w3id.org/jeswr/sectors/media"],
      access: ["Read"],
    });
    const turtle = await serialize(quads);
    expect(turtle).toContain("@prefix fedapp:");
    expect(turtle).toContain("fedapp:App");
  });

  it("serialises an empty quad set without error", async () => {
    const out = await serialize([]);
    expect(typeof out).toBe("string");
  });
});
