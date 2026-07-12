// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import { FinanceDocument } from "../src/model.js";
import { DataFactory, PREFIXES, serialiseTurtle } from "../src/serialise.js";
import { FIN } from "../src/vocab.js";
import { parseTurtle } from "./helpers.js";

const BASE = "https://pod.example/finance/ledger.ttl";

describe("serialiseTurtle", () => {
  it("emits Turtle with the standard prefix map", async () => {
    const doc = new FinanceDocument(parseTurtle("", BASE), DataFactory);
    const acc = doc.mintAccount(`${BASE}#acc`);
    acc.kind = "Current";
    const turtle = await serialiseTurtle(doc);
    expect(turtle).toContain("@prefix fin:");
    expect(turtle).toContain("fin:FinancialAccount");
  });

  it("produces empty-but-valid Turtle for an empty dataset", async () => {
    const doc = new FinanceDocument(parseTurtle("", BASE), DataFactory);
    const turtle = await serialiseTurtle(doc);
    // Re-parsing must succeed and yield zero quads.
    expect([...parseTurtle(turtle, BASE)]).toHaveLength(0);
  });

  it("exposes the finance namespace in the prefix map", () => {
    expect(PREFIXES.fin).toBe(FIN);
  });

  it("rejects with an Error when iteration throws an Error", async () => {
    const bad = {
      [Symbol.iterator]() {
        return {
          next(): never {
            throw new Error("boom");
          },
        };
      },
    } as unknown as Parameters<typeof serialiseTurtle>[0];
    await expect(serialiseTurtle(bad)).rejects.toThrow("boom");
  });

  it("wraps a non-Error throw into an Error", async () => {
    const bad = {
      [Symbol.iterator]() {
        return {
          next(): never {
            // Deliberately a non-Error throw to exercise the serialise.ts wrap path.
            throw "string failure";
          },
        };
      },
    } as unknown as Parameters<typeof serialiseTurtle>[0];
    await expect(serialiseTurtle(bad)).rejects.toThrow("string failure");
  });
});
