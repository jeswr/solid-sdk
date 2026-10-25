// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { assert, describe, expect, it } from "vitest";
import { DriveResource } from "../src/model.js";
import { quadsToTurtle } from "../src/serialize.js";
import {
  buildDriveRootMarker,
  buildDriveRootRegistration,
  findDriveRoots,
} from "../src/type-index.js";
import { turtle } from "./helpers.js";

const legacy = Object.keys(LEGACY_NAMESPACES).find(
  (key) => LEGACY_NAMESPACES[key] === NS.POD_DRIVE,
);
assert(legacy);
const root = "https://pod.example/drive/";

describe("canonical and legacy drive vocabulary", () => {
  it.each([NS.POD_DRIVE, legacy])("discovers and reads %s roots", (base) => {
    const index = turtle(`
      @prefix solid: <${NS.SOLID}> .
      [] a solid:TypeRegistration ; solid:forClass <${base}DriveRoot> ; solid:instanceContainer <${root}> .
    `);
    expect(findDriveRoots(index)).toEqual([root]);
    expect(findDriveRoots(index, `${legacy}DriveRoot`)).toEqual([root]);
    const container = turtle(
      `<${root}> a "not a class", <${NS.LDP}Container>, <${base}DriveRoot> .`,
    );
    expect(new DriveResource(root, container, DataFactory).isDriveRoot).toBe(true);
  });

  it("deduplicates roots registered under both classes", () => {
    const index = turtle(`
      @prefix solid: <${NS.SOLID}> .
      [] solid:forClass <${NS.POD_DRIVE}DriveRoot>, <${legacy}DriveRoot> ; solid:instanceContainer <${root}> .
      [] solid:forClass "invalid literal" ; solid:instanceContainer <https://pod.example/wrong/> .
    `);
    expect(findDriveRoots(index)).toEqual([root]);
  });

  it("writes only the canonical class even with a legacy class argument", async () => {
    const output = await quadsToTurtle([
      ...buildDriveRootRegistration(`${root}#registration`, root, `${legacy}DriveRoot`),
      ...buildDriveRootMarker(root),
    ]);
    expect(output).toContain(NS.POD_DRIVE);
    expect(output).not.toContain(legacy);
  });

  it("publishes the DriveRoot ontology", () => {
    const dataset = turtle(
      readFileSync(new URL("../vocab/pod-drive.ttl", import.meta.url), "utf8"),
    );
    expect([...dataset].some((q) => q.subject.value === `${NS.POD_DRIVE}DriveRoot`)).toBe(true);
  });
});
