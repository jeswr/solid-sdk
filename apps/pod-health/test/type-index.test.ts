// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { toTurtle } from "../src/serialise.js";
import { TypeIndexDataset } from "../src/type-index.js";
import { HealthClass, SolidTerm } from "../src/vocab.js";
import { TYPE_INDEX_TTL } from "./fixtures.js";

const INDEX_URL = "https://carol.example/settings/publicTypeIndex.ttl";

function loadIndex(ttl: string): TypeIndexDataset {
  return new TypeIndexDataset(new Store(new Parser().parse(ttl)), DataFactory);
}

describe("TypeIndexDataset — reading an existing index", () => {
  it("locates the HealthRecord registration's container", () => {
    const index = loadIndex(TYPE_INDEX_TTL);
    const where = index.locate(HealthClass.HealthRecord);
    expect(where).toEqual([{ container: "https://carol.example/health/" }]);
  });

  it("returns an empty list for an unregistered class", () => {
    const index = loadIndex(TYPE_INDEX_TTL);
    expect(index.locate("https://example.org/Unknown")).toEqual([]);
  });

  it("lists the registration entries", () => {
    const index = loadIndex(TYPE_INDEX_TTL);
    const regs = [...index.registrations];
    expect(regs).toHaveLength(1);
    expect(regs[0]?.forClass).toBe(HealthClass.HealthRecord);
    expect(regs[0]?.instanceContainer).toBe("https://carol.example/health/");
    expect(regs[0]?.instance).toBeUndefined();
  });
});

describe("TypeIndexDataset — creating + registering", () => {
  it("marks a fresh public index document and registers HealthRecords", async () => {
    const index = new TypeIndexDataset(new Store(), DataFactory);
    index.markIndexDocument(INDEX_URL, true);
    const reg = index.registerHealthRecords(INDEX_URL, "https://carol.example/health/");

    expect(reg.forClass).toBe(HealthClass.HealthRecord);
    expect(reg.instanceContainer).toBe("https://carol.example/health/");
    expect([...reg.types]).toContain(SolidTerm.TypeRegistration);

    // The locate path finds the just-added registration.
    expect(index.locate(HealthClass.HealthRecord)).toEqual([
      { container: "https://carol.example/health/" },
    ]);

    // The serialised document is a valid TypeIndex + ListedDocument.
    const ttl = await toTurtle(index);
    expect(ttl).toContain("TypeIndex");
    expect(ttl).toContain("ListedDocument");
    expect(ttl).toContain("registration-pod-health-records");
  });

  it("marks a private index as UnlistedDocument", async () => {
    const index = new TypeIndexDataset(new Store(), DataFactory);
    index.markIndexDocument(INDEX_URL, false);
    const ttl = await toTurtle(index);
    expect(ttl).toContain("UnlistedDocument");
    expect(ttl).not.toContain("ListedDocument");
  });

  it("registers an instance (single resource) when given one", () => {
    const index = new TypeIndexDataset(new Store(), DataFactory);
    const reg = index.register(INDEX_URL, "#reg-one", HealthClass.HealthRecord, {
      instance: "https://carol.example/health/record.ttl",
    });
    expect(reg.instance).toBe("https://carol.example/health/record.ttl");
    expect(reg.instanceContainer).toBeUndefined();
    expect(index.locate(HealthClass.HealthRecord)).toEqual([
      { instance: "https://carol.example/health/record.ttl" },
    ]);
  });

  it("round-trips a registration's setters including clears", () => {
    const index = new TypeIndexDataset(new Store(), DataFactory);
    const reg = index.register(INDEX_URL, "#reg", HealthClass.Observation, {});
    reg.instance = "urn:one";
    reg.instanceContainer = "urn:cont";
    reg.forClass = HealthClass.Condition;
    expect(reg.instance).toBe("urn:one");
    expect(reg.instanceContainer).toBe("urn:cont");
    expect(reg.forClass).toBe(HealthClass.Condition);
    reg.instance = undefined;
    reg.instanceContainer = undefined;
    reg.forClass = undefined;
    expect(reg.instance).toBeUndefined();
    expect(reg.instanceContainer).toBeUndefined();
    expect(reg.forClass).toBeUndefined();
  });
});
