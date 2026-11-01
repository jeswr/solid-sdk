// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { describe, expect, it } from "vitest";
import { grant, policy } from "../../test/helpers.js";
import {
  bob,
  manager,
  memoryAccess,
  owner,
  required,
  resource,
  root,
  selection,
} from "../../test/roles-helpers.js";
import { writeAcp } from "../index.js";
import { ACP, RDF, serialize } from "../rdf.js";
import { addGrant, grantsWithRoles, readGrants, removeGrant, setGrants } from "./index.js";
import { properties } from "./rdf.js";

const nn = DataFactory.namedNode;
const endpoint = `${resource}.acr`;
const comments = `${root}comments/`;
const parent = `${root}folder/`;
const carol = { type: "webid" as const, id: "https://carol.example/#me" };
const app = { type: "app" as const, id: "https://app.example/" };

async function essData(url = resource) {
  return parseRdf(
    await writeAcp(
      policy(
        grant([[{ kind: "agent", webId: owner }]], {
          modes: new Set(["read", "write", "control"]),
        }),
        grant([[{ kind: "agent", webId: bob }]]),
      ),
      url,
      `${url}.acr`,
      "ess",
    ),
    "text/turtle",
    { baseIRI: `${url}.acr` },
  );
}
function bobPolicy(data: Store, url = resource) {
  return properties(
    required(
      properties(nn(`${url}.acr`), data)
        .nodes(`${ACP}accessControl`)
        .flatMap((control) => control.nodes(`${ACP}apply`))
        .find((p) => p.nodes(`${ACP}allOf`).some((m) => m.iris(`${ACP}agent`).includes(bob))),
    ) as Term,
    data,
  );
}

describe("review round 2: ESS policy login requirements", () => {
  for (const location of [resource, parent, comments])
    for (const scope of ["accessControl", "memberAccessControl", "access", "memberAccess"])
      it.each([
        "read",
        "grants",
        "set",
        "add",
        "remove",
      ] as const)(`%s refuses mixed public/client ${scope} policies in ${location}`, async (operation) => {
        const mem = memoryAccess("acp");
        mem.attach(resource, await serialize(await essData()));
        const data = await essData(location);
        const p = bobPolicy(data, location);
        const publicMatcher = properties(required(p.nodes(`${ACP}allOf`)[0]) as Term, data);
        publicMatcher.values(`${ACP}agent`).clear();
        publicMatcher.add(`${ACP}agent`, `${ACP}PublicAgent`);
        const clientMatcher = properties(nn("urn:client-matcher"), data);
        clientMatcher.add(`${ACP}agent`, `${ACP}PublicAgent`);
        clientMatcher.add(`${ACP}client`, app.id);
        p.terms(`${ACP}allOf`).clear();
        p.terms(`${ACP}anyOf`).add(publicMatcher as Term);
        p.terms(`${ACP}anyOf`).add(clientMatcher as Term);
        const binding = properties(nn(`${location}.acr`), data);
        const control = required(
          binding
            .nodes(`${ACP}accessControl`)
            .find((c) => c.nodes(`${ACP}apply`).some((v) => v.equals(p as Term))),
        );
        if (scope !== "accessControl") {
          binding.terms(`${ACP}accessControl`).delete(control as Term);
          if (scope === "memberAccessControl") binding.terms(ACP + scope).add(control as Term);
          else {
            properties(control as Term, data)
              .terms(`${ACP}apply`)
              .clear();
            binding.terms(ACP + scope).add(p as Term);
            p.add(`${ACP}allow`, `${ACP}Write`);
          }
        }
        const body = await serialize(data);
        mem.attach(location, body);
        const options = {
          ...mem.options,
          implementation: "ess" as const,
          webId: owner,
          ...(location === comments ? { commentsContainer: comments } : {}),
        };
        // Refuse the projection itself, including the snapshot that could otherwise
        // be reapplied as a new anonymous Read policy when adding another person.
        if (operation === "read")
          await expect(readGrants(resource, options)).rejects.toThrow("login");
        else if (operation === "grants")
          await expect(grantsWithRoles(resource, options)).rejects.toThrow("login");
        else {
          const result =
            operation === "set"
              ? await setGrants(
                  [resource],
                  [
                    manager,
                    selection("viewer", { type: "public" }),
                    selection("viewer", app),
                    selection("viewer", carol),
                  ],
                  options,
                )
              : operation === "add"
                ? await addGrant([resource], selection("viewer", carol), options)
                : await removeGrant([resource], app, options);
          expect(result.applied).toEqual([]);
          expect(result.failed).toHaveLength(1);
          expect(result.failed[0]?.error).toMatchObject({
            message: expect.stringContaining("login"),
          });
        }
        expect(mem.writes()).toHaveLength(0);
        expect(mem.docs.get(`${location}.acr`)?.body).toBe(body);
      });

  it.each([
    "css",
    "ess",
  ] as const)("keeps independent public and app policies editable on %s", async (implementation) => {
    const mem = memoryAccess("acp");
    mem.attach(
      resource,
      await writeAcp(
        policy(
          grant([[{ kind: "agent", webId: owner }]], {
            modes: new Set(["read", "write", "control"]),
          }),
          grant([[{ kind: "public" }]]),
          grant([[{ kind: "client", clientId: app.id }]]),
        ),
        resource,
        endpoint,
        implementation,
      ),
    );
    const options = { ...mem.options, webId: owner, implementation };
    const snapshot = await readGrants(resource, options);
    expect(snapshot.grants).toContainEqual({
      ...selection("viewer", { type: "public" }),
      source: endpoint,
    });
    expect(
      (
        await setGrants([resource], [...snapshot.grants, selection("viewer", carol)], {
          ...options,
          expected: snapshot,
        })
      ).failed,
    ).toEqual([]);
    expect((await removeGrant([resource], app, options)).failed).toEqual([]);
    expect(await grantsWithRoles(resource, options)).toContainEqual({
      ...selection("viewer", { type: "public" }),
      source: endpoint,
    });
  });

  it("preserves ESS anyOf clients when every alternative already implies login", async () => {
    const mem = memoryAccess("acp");
    const data = await essData();
    const p = bobPolicy(data);
    const named = required(p.nodes(`${ACP}allOf`)[0]);
    p.terms(`${ACP}allOf`).clear();
    p.terms(`${ACP}anyOf`).add(named as Term);
    const client = properties(nn("urn:client-matcher"), data);
    client.add(`${ACP}agent`, `${ACP}PublicAgent`);
    client.add(`${ACP}client`, app.id);
    p.terms(`${ACP}anyOf`).add(client as Term);
    mem.attach(resource, await serialize(data));
    const options = { ...mem.options, webId: owner, implementation: "ess" as const };
    expect((await removeGrant([resource], app, options)).failed).toEqual([]);
    const snapshot = await readGrants(resource, options);
    expect(snapshot.grants).toContainEqual({ ...selection(), source: endpoint });
    expect(snapshot.grants.some((g) => g.agent.type === "public" || g.agent.type === "app")).toBe(
      false,
    );
    expect(
      (
        await setGrants([resource], [...snapshot.grants, selection("viewer", carol)], {
          ...options,
          expected: snapshot,
        })
      ).failed,
    ).toEqual([]);
  });
});

describe("review round 2: ACP root identity collisions", () => {
  for (const location of [resource, comments])
    for (const occupied of [
      "self",
      "foreign",
      "control",
      "policy",
      "matcher",
      "annotation",
      "empty-matcher",
      "root-matcher",
    ] as const)
      it.each([
        "set",
        "add",
        "remove",
      ] as const)(`%s refuses an ESS canonical subject occupied as ${occupied} while editing ${location}`, async (operation) => {
        const mem = memoryAccess("acp");
        mem.attach(resource, await serialize(await essData()));
        const data = await essData(location);
        const url = `${location}.acr`;
        const canonical = properties(nn(url), data);
        const p = bobPolicy(data, location);
        if (location === comments) {
          p.values(`${ACP}allow`).clear();
          p.add(`${ACP}allow`, `${ACP}Append`);
        }
        const binding = properties(nn("urn:resource-root"), data);
        for (const q of [...data.match(canonical as Term)]) {
          binding.terms(q.predicate.value).add(q.object);
          canonical.terms(q.predicate.value).clear();
        }
        if (occupied === "self" || occupied === "foreign") {
          canonical.add(`${RDF}type`, `${ACP}AccessControlResource`);
          canonical.add(`${ACP}resource`, occupied === "self" ? url : "urn:foreign-resource");
          const control = properties(nn("urn:canonical-control"), data);
          canonical.terms(`${ACP}accessControl`).add(control as Term);
          if (occupied === "self") {
            for (const management of binding.terms(`${ACP}access`))
              control.terms(`${ACP}apply`).add(management);
            binding.terms(`${ACP}access`).clear();
          } else control.terms(`${ACP}apply`).add(p as Term);
        } else if (occupied === "empty-matcher" || occupied === "root-matcher") {
          // A canonical IRI can be referenced without any outgoing statements,
          // or can be both an unbound root and an inert matcher. Neither is a
          // free identity for the writer to turn into a resource-control root.
          p.terms(`${ACP}anyOf`).add(required(p.nodes(`${ACP}allOf`)[0]) as Term);
          p.terms(`${ACP}anyOf`).add(canonical as Term);
          if (occupied === "root-matcher")
            canonical.add(`${RDF}type`, `${ACP}AccessControlResource`);
        } else if (occupied !== "annotation") {
          const control = required(
            binding
              .nodes(`${ACP}accessControl`)
              .find((c) => c.nodes(`${ACP}apply`).some((v) => v.equals(p as Term))),
          );
          const term =
            occupied === "control"
              ? (control as Term)
              : occupied === "policy"
                ? (p as Term)
                : (required(p.nodes(`${ACP}allOf`)[0]) as Term);
          for (const q of [...data.match(term)]) {
            canonical.terms(q.predicate.value).add(q.object);
            properties(term, data).terms(q.predicate.value).clear();
          }
          const referrer =
            occupied === "control"
              ? binding
              : occupied === "policy"
                ? properties(control as Term, data)
                : p;
          const predicate =
            ACP +
            (occupied === "control" ? "accessControl" : occupied === "policy" ? "apply" : "allOf");
          referrer.terms(predicate).delete(term);
          referrer.terms(predicate).add(canonical as Term);
        }
        if (occupied !== "empty-matcher") canonical.add(`${RDF}type`, "urn:Preserved");
        mem.attach(location, await serialize(data));
        const options = {
          ...mem.options,
          implementation: "ess" as const,
          webId: owner,
          ...(location === comments ? { commentsContainer: comments } : {}),
        };
        const snapshot = await readGrants(resource, options);
        expect(snapshot.grants).toContainEqual({ ...manager, source: endpoint });
        const added = selection(location === comments ? "commenter" : "viewer", carol);
        const result =
          operation === "set"
            ? await setGrants([resource], [...snapshot.grants, added], {
                ...options,
                expected: JSON.parse(JSON.stringify(snapshot)),
              })
            : operation === "add"
              ? await addGrant([resource], added, options)
              : await removeGrant([resource], selection().agent, options);
        // ESS reads an ACR through its canonical URL (review round 3), so a canonical subject
        // occupied by anything other than this resource's root is refused before any write
        // instead of anchoring new grants on a node ESS would never read.
        expect(result.applied).toEqual([]);
        expect(result.failed).toEqual([
          { url: resource, error: expect.objectContaining({ code: "unsupported", url }) },
        ]);
        expect(mem.writes()).toHaveLength(0);
        const grants = await grantsWithRoles(resource, options);
        expect(grants).toContainEqual({ ...manager, source: endpoint });
      });
});
