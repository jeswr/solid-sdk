// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Node-description tests: assert the INodeType description matches the n8n
// community-node loader contract — the credential it references, the declared
// resource/operation surface, and the displayOptions wiring the UI depends on.

import { describe, expect, it } from "vitest";
import { Solid } from "../nodes/Solid/Solid.node.js";

const node = new Solid();
const d = node.description;

describe("Solid node description", () => {
  it("declares the node name + version the loader keys on", () => {
    expect(d.name).toBe("solid");
    expect(d.displayName).toBe("Solid");
    expect(d.version).toBe(1);
  });

  it("requires the solidApi credential the credential class declares", () => {
    expect(d.credentials).toEqual([{ name: "solidApi", required: true }]);
  });

  it("exposes Resource and Container resources", () => {
    const resourceProp = d.properties.find((p) => p.name === "resource");
    const values = (resourceProp?.options as { value: string }[] | undefined)?.map((o) => o.value);
    expect(values).toEqual(["resource", "container"]);
  });

  it("offers Read/Create/Update/Delete on Resource", () => {
    const op = d.properties.find(
      (p) =>
        p.name === "operation" &&
        (p.displayOptions?.show?.resource as string[] | undefined)?.includes("resource"),
    );
    const values = (op?.options as { value: string }[] | undefined)?.map((o) => o.value);
    expect(values?.sort()).toEqual(["create", "delete", "read", "update"]);
  });

  it("offers List on Container", () => {
    const op = d.properties.find(
      (p) =>
        p.name === "operation" &&
        (p.displayOptions?.show?.resource as string[] | undefined)?.includes("container"),
    );
    const values = (op?.options as { value: string }[] | undefined)?.map((o) => o.value);
    expect(values).toEqual(["list"]);
  });

  it("shows Content/Content-Type only for create+update", () => {
    const content = d.properties.find((p) => p.name === "content");
    expect(content?.displayOptions?.show?.operation).toEqual(["create", "update"]);
  });

  it("shows the If-Match field only for update", () => {
    const ifMatch = d.properties.find((p) => p.name === "ifMatch");
    expect(ifMatch?.displayOptions?.show?.operation).toEqual(["update"]);
  });

  it("requires a target on every operation", () => {
    const target = d.properties.find((p) => p.name === "target");
    expect(target?.required).toBe(true);
  });
});
