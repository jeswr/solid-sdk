// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store, Writer } from "n3";
import { expect, it, vi } from "vitest";
import { PodConnection } from "../../src/auth/connections.js";
import { RdfNode, serialize } from "../../src/engine/rdf.js";
import { fakeAuth, profileTurtle, sourceRoot, sourceWebId } from "./fixtures.js";

it.each([
  false,
  true,
])("does not convert a late Unicode profile after logout (private=%s)", async (privateProfile) => {
  const auth = fakeAuth();
  let finish: (response: Response) => void = () => {};
  let started: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const delayed = vi.fn(async () => {
    started();
    return response;
  });
  auth.publicFetch.mockImplementation(
    privateProfile ? async () => new Response(null, { status: 403 }) : delayed,
  );
  auth.authenticatedFetch.mockImplementation(delayed);
  const connection = new PodConnection("source", auth);
  const reading = connection.readProfile();
  await requested;
  await connection.logout();
  finish(
    new Response(`# café\n${profileTurtle}`, {
      headers: { "content-type": "text/turtle" },
    }),
  );
  await reading;
  expect(delayed).toHaveBeenCalledTimes(1);
  expect(connection.snapshot()).toMatchObject({ status: "signed-out", root: null });
  expect(auth.reArmAllowedOrigins).not.toHaveBeenCalled();
});

it.each(
  [false, true].flatMap((privateProfile) =>
    ["406", "401", "mismatch", "agree"].map((evidence) => ({ privateProfile, evidence })),
  ),
)("requires a complete WebID storage graph (private=$privateProfile, $evidence)", async ({
  privateProfile,
  evidence,
}) => {
  const url = sourceWebId.split("#")[0] as string;
  const dataset = new Store();
  const agent = new RdfNode(sourceWebId, dataset, DataFactory);
  agent.add("http://www.w3.org/ns/pim/space#storage", sourceRoot);
  const prefix = `# café\n${await serialize(dataset)}`;
  if (evidence === "mismatch")
    agent.add("http://www.w3.org/ns/pim/space#storage", "https://other.example/pod/");
  const writer = new Writer({ format: "N-Quads" });
  writer.addQuads([...(await parseRdf(await serialize(dataset), "text/turtle", { baseIRI: url }))]);
  const converted = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  const auth = fakeAuth();
  const authenticatedFetch = auth.authenticatedFetch.getMockImplementation();
  const conversion = vi.fn(() =>
    evidence === "406" || evidence === "401"
      ? new Response(null, { status: Number(evidence) })
      : new Response(converted, { headers: { "content-type": "application/n-quads" } }),
  );
  const profileFetch: typeof fetch = async (input, init) => {
    expect(input).toBe(url);
    expect(init).toMatchObject({ credentials: "omit", redirect: "manual" });
    return new Headers(init?.headers).get("accept") === "application/n-quads"
      ? conversion()
      : new Response(prefix, { headers: { "content-type": "text/turtle" } });
  };
  auth.publicFetch.mockImplementation(
    privateProfile ? async () => new Response(null, { status: 403 }) : profileFetch,
  );
  auth.authenticatedFetch.mockImplementation((input, init) =>
    input === url ? profileFetch(input, init) : (authenticatedFetch as typeof fetch)(input, init),
  );
  const connection = new PodConnection("source", auth);
  await connection.readProfile();
  expect(conversion).toHaveBeenCalledTimes(1);
  expect(connection.snapshot()).toMatchObject({
    status: evidence === "agree" ? "connected" : "error",
    root: evidence === "agree" ? sourceRoot : null,
  });
  expect(auth.reArmAllowedOrigins).toHaveBeenCalledTimes(evidence === "agree" ? 1 : 0);
  const publicReads = auth.publicFetch.mock.calls.filter(([input]) => input === url);
  const privateReads = auth.authenticatedFetch.mock.calls.filter(([input]) => input === url);
  expect(publicReads).toHaveLength(privateProfile ? 1 : 3);
  expect(privateReads).toHaveLength(privateProfile ? 3 : 0);
});
