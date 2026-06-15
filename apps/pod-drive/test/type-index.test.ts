// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { quadsToTurtle } from "../src/serialize.js";
import {
  buildDriveRootMarker,
  buildDriveRootRegistration,
  findDriveRoots,
  TypeRegistration,
} from "../src/type-index.js";
import { PODDRIVE, SOLID } from "../src/vocab.js";
import { turtle } from "./helpers.js";

const INDEX = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix poddrive: <https://w3id.org/jeswr/pod-drive#> .
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .

<https://pod.example/settings/publicTypeIndex.ttl> a solid:TypeIndex, solid:ListedDocument .

<https://pod.example/settings/publicTypeIndex.ttl#drive> a solid:TypeRegistration ;
  solid:forClass poddrive:DriveRoot ;
  solid:instanceContainer <https://pod.example/drive/> .

<https://pod.example/settings/publicTypeIndex.ttl#drive2> a solid:TypeRegistration ;
  solid:forClass poddrive:DriveRoot ;
  solid:instanceContainer <https://pod.example/archive/> .

<https://pod.example/settings/publicTypeIndex.ttl#tasks> a solid:TypeRegistration ;
  solid:forClass wf:Task ;
  solid:instance <https://pod.example/tasks.ttl> .
`;

describe("findDriveRoots", () => {
  it("returns every container registered for poddrive:DriveRoot", () => {
    const roots = findDriveRoots(turtle(INDEX));
    expect(roots.sort()).toEqual(["https://pod.example/archive/", "https://pod.example/drive/"]);
  });

  it("does not return containers registered for other classes", () => {
    const roots = findDriveRoots(turtle(INDEX));
    expect(roots).not.toContain("https://pod.example/tasks.ttl");
  });

  it("returns an empty array for an index with no drive registration", () => {
    const empty = turtle(`
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://pod.example/idx.ttl> a solid:TypeIndex .
    `);
    expect(findDriveRoots(empty)).toEqual([]);
  });

  it("accepts an explicit forClass override", () => {
    const roots = findDriveRoots(turtle(INDEX), "http://www.w3.org/2005/01/wf/flow#Task");
    expect(roots).toEqual([]); // Task is registered as instance, not instanceContainer
  });

  it("finds a registration whose subject is a blank node", () => {
    // Type-index registrations are frequently blank nodes. The lookup must
    // preserve the blank-node term, not reconstruct a NamedNode from `.value`.
    const bnode = turtle(`
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix poddrive: <https://w3id.org/jeswr/pod-drive#> .
      [] a solid:TypeRegistration ;
        solid:forClass poddrive:DriveRoot ;
        solid:instanceContainer <https://pod.example/drive/> .
    `);
    expect(findDriveRoots(bnode)).toEqual(["https://pod.example/drive/"]);
  });

  it("de-dupes the same container registered twice", () => {
    const dup = turtle(`
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix poddrive: <https://w3id.org/jeswr/pod-drive#> .
      <#a> a solid:TypeRegistration ; solid:forClass poddrive:DriveRoot ;
        solid:instanceContainer <https://pod.example/drive/> .
      <#b> a solid:TypeRegistration ; solid:forClass poddrive:DriveRoot ;
        solid:instanceContainer <https://pod.example/drive/> .
    `);
    expect(findDriveRoots(dup)).toEqual(["https://pod.example/drive/"]);
  });
});

describe("TypeRegistration", () => {
  const reg = new TypeRegistration(
    "https://pod.example/settings/publicTypeIndex.ttl#drive",
    turtle(INDEX),
    DataFactory,
  );

  it("reads forClasses", () => {
    expect([...reg.forClasses]).toEqual([PODDRIVE.DriveRoot]);
  });

  it("reads instanceContainers", () => {
    expect([...reg.instanceContainers]).toEqual(["https://pod.example/drive/"]);
  });

  it("reads instances (empty for a container registration)", () => {
    expect([...reg.instances]).toEqual([]);
  });

  it("reads instances when present", () => {
    const taskReg = new TypeRegistration(
      "https://pod.example/settings/publicTypeIndex.ttl#tasks",
      turtle(INDEX),
      DataFactory,
    );
    expect([...taskReg.instances]).toEqual(["https://pod.example/tasks.ttl"]);
  });
});

describe("buildDriveRootRegistration", () => {
  it("builds the three registration triples", async () => {
    const quads = buildDriveRootRegistration(
      "https://pod.example/settings/publicTypeIndex.ttl#drive",
      "https://pod.example/drive/",
    );
    expect(quads).toHaveLength(3);
    const ttl = await quadsToTurtle(quads);
    expect(ttl).toContain("solid:TypeRegistration");
    expect(ttl).toContain("solid:forClass");
    expect(ttl).toContain("poddrive:DriveRoot");
    expect(ttl).toContain("solid:instanceContainer");
  });

  it("round-trips: the built registration is found by findDriveRoots", () => {
    const quads = buildDriveRootRegistration(
      "https://pod.example/idx.ttl#drive",
      "https://pod.example/photos/",
    );
    const store = turtle("");
    store.addQuads(quads);
    expect(findDriveRoots(store)).toEqual(["https://pod.example/photos/"]);
  });

  it("honours a custom forClass", () => {
    const quads = buildDriveRootRegistration(
      "https://pod.example/idx.ttl#x",
      "https://pod.example/c/",
      "https://example.org/Custom",
    );
    const forClass = quads.find((q) => q.predicate.value === SOLID.forClass);
    expect(forClass?.object.value).toBe("https://example.org/Custom");
  });
});

describe("buildDriveRootMarker", () => {
  it("builds the single rdf:type DriveRoot triple", () => {
    const quads = buildDriveRootMarker("https://pod.example/drive/");
    expect(quads).toHaveLength(1);
    const q = quads[0];
    expect(q?.subject.value).toBe("https://pod.example/drive/");
    expect(q?.object.value).toBe(PODDRIVE.DriveRoot);
  });
});
