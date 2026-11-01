// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { grant, policy } from "../../test/helpers.js";
import {
  bob,
  manager,
  memoryAccess,
  owner,
  required,
  resource,
  selection,
} from "../../test/roles-helpers.js";
import { writeAcp } from "../index.js";
import { ACP, serialize } from "../rdf.js";
import { addGrant, grantsWithRoles, readGrants, removeGrant, setGrants } from "./index.js";
import { properties, roots } from "./rdf.js";

const nn = DataFactory.namedNode;
const endpoint = `${resource}.acr`;
const carol = { type: "webid" as const, id: "https://carol.example/#me" };
const MENTIONS = "https://example.org/mentions";

/** An ESS ACR anchored on its canonical URL, with an unrelated annotation pointing at that URL. */
async function annotatedEss() {
  const data = await parseRdf(
    await writeAcp(
      policy(
        grant([[{ kind: "agent", webId: owner }]], {
          modes: new Set(["read", "write", "control"]),
        }),
        grant([[{ kind: "agent", webId: bob }]]),
      ),
      resource,
      endpoint,
      "ess",
    ),
    "text/turtle",
    { baseIRI: endpoint },
  );
  data.addQuad(nn("urn:note"), nn(MENTIONS), nn(endpoint));
  return data;
}

describe("review round 3: ESS keeps controls on the canonical ACR subject", () => {
  it.each([
    "set",
    "add",
    "remove",
  ] as const)("%s writes onto the canonical subject when only an annotation references it", async (operation) => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await serialize(await annotatedEss()));
    const options = { ...mem.options, implementation: "ess" as const, webId: owner };
    const snapshot = await readGrants(resource, options);
    expect(snapshot.grants).toContainEqual({ ...manager, source: endpoint });
    const added = selection("viewer", carol);
    const result =
      operation === "set"
        ? await setGrants([resource], [...snapshot.grants, added], {
            ...options,
            expected: snapshot,
          })
        : operation === "add"
          ? await addGrant([resource], added, options)
          : await removeGrant([resource], selection().agent, options);
    expect(result.failed).toEqual([]);
    expect(result.applied).toEqual([resource]);

    const after = await parseRdf(required(mem.docs.get(endpoint)).body, "text/turtle", {
      baseIRI: endpoint,
    });
    // Every root bound to the resource is the canonical URL ESS resolves; no grant is stranded
    // on a blank root, and the annotation survives.
    const bound = roots(after).filter((acr) =>
      properties(acr as Term, after)
        .iris(`${ACP}resource`)
        .includes(resource),
    );
    expect(bound.map((acr) => acr.value)).toEqual([endpoint]);
    expect(after.match(nn("urn:note"), nn(MENTIONS), nn(endpoint)).size).toBe(1);
    const canonicalControls = properties(nn(endpoint), after).nodes(`${ACP}accessControl`);
    expect(canonicalControls.length).toBeGreaterThan(0);

    const grants = await grantsWithRoles(resource, options);
    expect(grants).toContainEqual({ ...manager, source: endpoint });
    if (operation === "remove")
      expect(grants.some((g) => "id" in g.agent && g.agent.id === bob)).toBe(false);
    else {
      expect(grants).toContainEqual({ ...added, source: endpoint });
      expect(grants.some((g) => "id" in g.agent && g.agent.id === bob)).toBe(true);
    }
  });
});
