// AUTHORED-BY Codex GPT-5
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { serializeTurtle } from "../src/serialize.js";

const { literal, namedNode, quad } = DataFactory;

describe("serializeTurtle", () => {
  it("preserves the raw Writer bytes for an empty unprefixed store", async () => {
    await expect(serializeTurtle(new Store())).resolves.toBe("");
  });

  it("flattens named graphs and preserves the raw Writer Turtle bytes", async () => {
    const store = new Store([
      quad(
        namedNode("https://example.com/s"),
        namedNode("https://example.com/p"),
        literal("value"),
        namedNode("https://example.com/g"),
      ),
    ]);

    const result = await serializeTurtle(store);

    expect(result).toBe('<https://example.com/s> <https://example.com/p> "value".\n');
    expect(result).not.toContain("https://example.com/g");
  });
});
