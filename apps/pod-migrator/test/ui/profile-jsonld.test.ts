// AUTHORED-BY Codex GPT-6
import { LiteralFrom, SetFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { PodConnection } from "../../src/auth/connections.js";
import { FOAF, RdfNode, serialize } from "../../src/engine/rdf.js";
import { fakeAuth, sourceRoot, sourceWebId } from "./fixtures.js";

it.each([
  false,
  true,
])("discovers storage from a Unicode profile on a JSON-LD-only server (private=%s)", async (privateProfile) => {
  const url = sourceWebId.split("#")[0] as string;
  const dataset = new Store();
  const agent = new RdfNode(sourceWebId, dataset, DataFactory);
  agent.add("http://www.w3.org/ns/pim/space#storage", sourceRoot);
  SetFrom.subjectPredicate(agent, `${FOAF}name`, (term) => term.value, LiteralFrom.string).add(
    "Zoë 漢字 🌱",
  );
  const turtle = await serialize(dataset);
  const jsonld = JSON.stringify({
    "@context": { pim: "http://www.w3.org/ns/pim/space#", foaf: FOAF },
    "@id": sourceWebId,
    "pim:storage": { "@id": sourceRoot },
    "foaf:name": "Zoë 漢字 🌱",
  });
  const auth = fakeAuth();
  const authenticatedFetch = auth.authenticatedFetch.getMockImplementation() as typeof fetch;
  const conversion = vi.fn((accept: string | null) =>
    accept === "application/ld+json"
      ? new Response(jsonld, {
          headers: {
            "content-type": "application/ld+json",
            "content-length": String(Buffer.byteLength(jsonld)),
          },
        })
      : new Response(null, { status: 406 }),
  );
  const profileFetch: typeof fetch = async (input, init) => {
    expect(input).toBe(url);
    expect(init).toMatchObject({ credentials: "omit", redirect: "manual" });
    const accept = new Headers(init?.headers).get("accept");
    return accept === "text/turtle, application/ld+json;q=0.9"
      ? new Response(turtle, { headers: { "content-type": "text/turtle" } })
      : conversion(accept);
  };
  auth.publicFetch.mockImplementation(
    privateProfile ? async () => new Response(null, { status: 403 }) : profileFetch,
  );
  auth.authenticatedFetch.mockImplementation((input, init) =>
    input === url ? profileFetch(input, init) : authenticatedFetch(input, init),
  );
  const connection = new PodConnection("source", auth);
  await connection.readProfile();
  expect(connection.snapshot()).toMatchObject({ status: "connected", root: sourceRoot });
  expect(auth.reArmAllowedOrigins).toHaveBeenCalledOnce();
  expect(conversion).toHaveBeenCalledExactlyOnceWith("application/ld+json");
  expect(auth.publicFetch.mock.calls.filter(([input]) => input === url)).toHaveLength(
    privateProfile ? 1 : 2,
  );
  expect(auth.authenticatedFetch.mock.calls.filter(([input]) => input === url)).toHaveLength(
    privateProfile ? 2 : 0,
  );
});
