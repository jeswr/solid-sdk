// AUTHORED-BY Codex GPT-6

import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { BY_CLASS } from "../src/apps/home/lib/model/domains";
import { serializeTurtle } from "../src/apps/home/lib/model/rdf";
import {
  applyRevoke,
  loadPermissions,
  planRevoke,
  resolveClientName,
} from "../src/apps/home/lib/permissions";
import { dataTypeLabel } from "../src/apps/home/lib/permissions/view";
import { ACL, AccessNode } from "../src/apps/home/lib/permissions/vocab";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

describe("permissions demo seed", () => {
  it("keeps registered collection data types distinct across the full Home catalogue", async () => {
    const seed = await buildDemoSeed(Date.UTC(2026, 10, 1));
    const ownerFile = seed.find((file) => file.path === ".acl");
    if (!ownerFile) throw new Error("Missing owner policy");
    const owner = await parseRdf(String(ownerFile.body), "text/turtle", { baseIRI: DEMO_ROOT });
    const registered = new Map(
      [...BY_CLASS].flatMap(([forClass, classification]) =>
        classification.dataType
          ? ([
              [classification.dataType.id, { forClass, dataType: classification.dataType }],
            ] as const)
          : [],
      ),
    );
    const locations = [...registered.values()].map(({ forClass, dataType }) => ({
      forClass,
      container: `${DEMO_ROOT}catalogue/${dataType.id}/`,
      dataType,
    }));
    for (const location of locations) {
      const graph = new Store([...owner]);
      const control = new AccessNode(
        DataFactory.namedNode(`${DEMO_ROOT}.acl#owner`),
        graph,
        DataFactory,
      );
      for (const scope of ["accessTo", "default"]) {
        control.values(ACL + scope).delete(DEMO_ROOT);
        control.values(ACL + scope).add(location.container);
      }
      const bob = new AccessNode(
        DataFactory.namedNode(`${location.container}.acl#bob`),
        graph,
        DataFactory,
      );
      bob.values(`${NS.RDF}type`).add(`${ACL}Authorization`);
      bob.values(`${ACL}agent`).add("https://bob.demo.pod/profile/card#me");
      bob.values(`${ACL}accessTo`).add(location.container);
      bob.values(`${ACL}mode`).add(`${ACL}Read`);
      seed.push(
        { path: location.container.slice(DEMO_ROOT.length), body: "", contentType: "text/turtle" },
        {
          path: `${location.container.slice(DEMO_ROOT.length)}.acl`,
          body: await serializeTurtle(graph),
          contentType: "text/turtle",
        },
      );
    }
    const pod = createDemoPod({ root: DEMO_ROOT, seed });
    const result = await loadPermissions({
      fetch: pod.fetch,
      storage: DEMO_ROOT,
      webId: DEMO_WEBID,
      typeIndex: locations,
    });
    expect(result.failures).toEqual([]);
    const person = result.rows.find((row) => row.id === "https://bob.demo.pod/profile/card#me");
    for (const location of locations) {
      const line = person?.lines.find((line) =>
        line.resources.some((r) => r.url === location.container),
      );
      expect(line?.dataType?.id).toBe(location.dataType.id);
    }
  });

  it("ignores a public client response without a declared media type", async () => {
    expect(
      await resolveClientName(
        "https://untyped-client.demo.example/id.json",
        async () => new Response(null),
      ),
    ).toEqual({});
  });

  it("walks real grants, preserves the owner, revokes Bob's inherited line and restores it", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.UTC(2026, 10, 1)),
    });
    const options = { fetch: pod.fetch, storage: DEMO_ROOT, webId: DEMO_WEBID };
    const snapshot = await loadPermissions(options);
    expect(snapshot.failures).toEqual([]);
    expect(snapshot.rows.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["public", "person", "app"]),
    );
    const bob = snapshot.rows.find((r) => r.id === "https://bob.demo.pod/profile/card#me");
    expect(bob?.lines).toHaveLength(1);
    const line = bob?.lines[0];
    if (!line) throw new Error("Missing Bob grant");
    expect(dataTypeLabel(line)).toBe("Files");
    expect(line.inherited).toBe(true);
    const app = snapshot.rows.find((r) => r.kind === "app");
    expect(app?.lines[0]?.purpose?.label).toBe("Personalise the service");
    expect(app?.lines[0]?.dataType?.label).toBe("Activity");
    const result = await applyRevoke(planRevoke(line, "line"), options);
    expect((await loadPermissions(options)).rows.some((r) => r.id === bob?.id)).toBe(false);
    const rules = await (await pod.fetch(`${DEMO_ROOT}drive/Work/.acl`)).text();
    expect(rules).not.toContain("bob.demo.pod");
    expect(rules).toContain(DEMO_WEBID);
    await applyRevoke(result.undo, options);
    expect((await loadPermissions(options)).rows.find((r) => r.id === bob?.id)?.lines).toHaveLength(
      1,
    );
    await applyRevoke(planRevoke(snapshot, "make-private"), options);
    expect((await loadPermissions(options)).rows.some((r) => r.kind === "public")).toBe(false);
  });
});
