// AUTHORED-BY Codex GPT-6.1-Sol
// Ported regression cases from apps/pod-drive.
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { assert, describe, expect, it } from "vitest";
import { DriveResource } from "../../src/apps/drive/lib/model/model.js";
import { quadsToTurtle } from "../../src/apps/drive/lib/model/serialize.js";
import {
  buildDriveRootMarker,
  buildDriveRootRegistration,
  findDriveRoots,
} from "../../src/apps/drive/lib/model/type-index.js";
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
});
