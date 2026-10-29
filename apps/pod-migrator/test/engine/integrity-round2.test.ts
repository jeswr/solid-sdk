// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { LiteralFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { expect, it, vi } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { RdfNode, serialize } from "../../src/engine/rdf.js";
import { writeAcp } from "../../src/engine/systems/acp.js";
import { acl, grant, pods, resolve, stranger } from "./helpers.js";

async function turtle(value = "é"): Promise<string> {
  const store = new Store();
  const node = new TermWrapper("urn:note", store, DataFactory);
  SetFrom.subjectPredicate(node, "urn:text", (term) => term.value, LiteralFrom.string).add(value);
  return serialize(store);
}
async function alternate(body: string, url: string): Promise<string> {
  const writer = new Writer({ format: "N-Quads" });
  writer.addQuads([...(await parseRdf(body, "text/turtle", { baseIRI: url }))]);
  return new Promise((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
}
function response(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/turtle",
      "content-length": String(new TextEncoder().encode(body).length),
    },
  });
}

it.each([
  false,
  true,
])("rejects a complete-triple prefix with a lying length (rewrite=%s)", async (rewriteIris) => {
  const { source, target } = await pods();
  const url = `${source.root}prefix.ttl`;
  const tail = await turtle("missing tail");
  const prefix = await turtle("é".repeat(tail.length));
  const full = prefix + tail;
  expect(new TextEncoder().encode(prefix).length).toBe(full.length);
  expect((await parseRdf(prefix, "text/turtle")).size).toBe(1);
  expect((await parseRdf(full, "text/turtle")).size).toBe(2);
  source.store(url, full, "text/turtle");
  const sourceSide = source.side();
  const get = sourceSide.http.get;
  const independent = await alternate(full, url);
  sourceSide.http = {
    ...sourceSide.http,
    get: async (resource, init) =>
      resource === url
        ? init?.accept === "application/n-quads"
          ? new Response(independent, { headers: { "content-type": "application/n-quads" } })
          : response(prefix)
        : get(resource, init),
  };
  const options = { source: sourceSide, target: target.side(), rewriteIris };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([
    expect.objectContaining({
      url: `${target.root}prefix.ttl`,
      error: expect.stringMatching(/independent|completeness/i),
    }),
  ]);
  expect(result.copied).toEqual([]);
  expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
});

it.each([
  "wac",
  "acp",
] as const)("blocks a truncated %s access document and its subtree", async (system) => {
  const { source, target } = await pods(system);
  const folder = `${source.root}nested/`;
  source.store(folder, "", "text/turtle");
  source.store(`${folder}secret`, "private");
  const url = source.acl(folder);
  const grants = await acl(source, folder, {
    grants: [grant(undefined, { appliesTo: "both" })],
    denials: [],
  });
  const tail =
    system === "acp"
      ? await writeAcp(
          {
            grants: [],
            denials: [grant([[{ kind: "agent", webId: stranger }]], { appliesTo: "both" })],
          },
          folder,
          url,
          "css",
          "urn:trailing",
        )
      : await turtle("trailing metadata");
  const prefix = `#${"é".repeat(tail.length)}\n${grants}`;
  const complete = prefix + tail;
  expect(new TextEncoder().encode(prefix).length).toBe(complete.length);
  source.setAcl(folder, complete);
  if (system === "acp") {
    expect(await source.permissions(`${folder}secret`, { agent: stranger })).not.toContain("read");
    expect(await source.permissions(`${folder}secret`, { agent: "urn:allowed" })).toContain("read");
  }
  // The visible prefix retains a public grant but loses the complete trailing denial.
  source.responses.set(`GET ${url}`, () => response(prefix));
  const sourceSide = source.side();
  if (system === "acp") {
    const get = sourceSide.http.get;
    const independent = await alternate(complete, url);
    sourceSide.http = {
      ...sourceSide.http,
      get: (resource, init) =>
        resource === url && init?.accept === "application/n-quads"
          ? Promise.resolve(
              new Response(independent, { headers: { "content-type": "application/n-quads" } }),
            )
          : get(resource, init),
    };
  }
  const options = { source: sourceSide, target: target.side() };
  const plan = await planMigration(options);
  const item = plan.report.find(
    (item) => item.resourceUrl === folder && item.kind === "acl-unreadable",
  );
  expect(item).toBeDefined();
  expect(item?.options.map((option) => option.id)).toEqual(["skip", "abort"]);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([]);
  expect(target.data.has(`${target.root}nested/`)).toBe(false);
  expect(target.data.has(`${target.root}nested/secret`)).toBe(false);
});

it("copies intact remote-context JSON-LD verbatim without context requests", async () => {
  const { source, target } = await pods();
  const body = '{"@context":"https://schema.org/","@id":"urn:test","name":"Valid document"}';
  source.store(`${source.root}context.jsonld`, body, "application/ld+json");
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Remote network refused"));
  try {
    const options = { source: source.side(), target: target.side() };
    const plan = await planMigration(options);
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(new TextDecoder().decode(target.data.get(`${target.root}context.jsonld`)?.bytes)).toBe(
      body,
    );
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

it("validates all nested files before creating any containers or ACLs", async () => {
  const { source, target } = await pods();
  source.store(`${source.root}nested/`, "", "text/turtle");
  source.store(`${source.root}nested/deeper/`, "", "text/turtle");
  source.store(`${source.root}nested/good`, "good");
  source.store(`${source.root}nested/deeper/bad.ttl`, '<urn:s> <urn:p> "unfinished', "text/turtle");
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([
    expect.objectContaining({ url: `${target.root}nested/deeper/bad.ttl` }),
  ]);
  expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
});

it("returns a blocking, attributed planning report for corrupt container RDF", async () => {
  const { source, target } = await pods();
  const url = `${source.root}nested/`;
  source.store(url, "", "text/turtle");
  source.responses.set(`GET ${url}`, () => response('<urn:s> <urn:p> "unfinished'));
  const plan = await planMigration({ source: source.side(), target: target.side() });
  expect(plan.report).toContainEqual(
    expect.objectContaining({
      resourceUrl: url,
      options: [expect.objectContaining({ id: "abort" })],
    }),
  );
  expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
});

it("attributes an execution access recheck failure to the dependent file", async () => {
  const { source, target } = await pods();
  const url = `${source.root}file`;
  source.store(url, "file");
  source.setAcl(url, await acl(source, url));
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  source.responses.set(`GET ${source.acl(url)}`, () => response('<urn:s> <urn:p> "unfinished'));
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([expect.objectContaining({ url: `${target.root}file` })]);
  expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
});

it.each([
  "source",
  "target",
] as const)("attributes %s inventory HTTP failures during planning", async (side) => {
  const { source, target } = await pods();
  const pod = side === "source" ? source : target;
  const url = `${pod.root}nested/`;
  pod.store(url, "", "text/turtle");
  pod.responses.set(`HEAD ${url}`, () => new Response(null, { status: 503 }));
  const plan = await planMigration({ source: source.side(), target: target.side() });
  expect(plan.report).toContainEqual(
    expect.objectContaining({
      resourceUrl: url,
      explanation: "Pod request failed (503)",
      options: [expect.objectContaining({ id: "abort" })],
    }),
  );
});

it("attributes a transport rejection with no Error object during execution preflight", async () => {
  const { source, target } = await pods();
  const url = `${source.root}file`;
  source.store(url, "content");
  const sourceSide = source.side();
  const head = sourceSide.http.head;
  let reject = false;
  sourceSide.http = {
    ...sourceSide.http,
    head: async (resource, init) => {
      if (reject && resource === url) throw "read refused";
      return head(resource, init);
    },
  };
  const options = { source: sourceSide, target: target.side() };
  const plan = await planMigration(options);
  reject = true;
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([{ url: `${target.root}file`, error: "read refused" }]);
});

it("attributes a write transport rejection without an Error object", async () => {
  const { source, target } = await pods();
  source.store(`${source.root}file`, "content");
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  target.responses.set(`PUT ${target.root}file`, () => {
    throw "write refused";
  });
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([{ url: `${target.root}file`, error: "write refused" }]);
});

it.each([
  "discovery",
  "inventory",
])("blocks corrupt UTF-8 in %s reads with the affected URL", async (path) => {
  const { source, target } = await pods();
  const protectedUrl = path === "discovery" ? source.root : `${target.root}nested/`;
  target.store(`${target.root}nested/`, "", "text/turtle");
  const pod = path === "discovery" ? source : target;
  const url = path === "discovery" ? source.acl(source.root) : protectedUrl;
  pod.responses.set(
    `GET ${url}`,
    () =>
      new Response(new Uint8Array([35, 32, 0xc3]), {
        headers: { "content-type": "text/turtle", "content-length": "3" },
      }),
  );
  const plan = await planMigration({ source: source.side(), target: target.side() });
  expect(plan.report).toContainEqual(
    expect.objectContaining({
      kind: "resource-unreadable",
      resourceUrl: protectedUrl,
      options: [expect.objectContaining({ id: "abort" })],
    }),
  );
});

it.each([
  false,
  true,
])("validates anonymous group RDF at planning and execution (corrupt-after-plan=%s)", async (afterPlan) => {
  const { source, target } = await pods();
  const url = `${source.root}group`;
  const group = `${url}#team`;
  const dataset = new Store();
  new RdfNode(group, dataset, DataFactory).add(
    "http://www.w3.org/2006/vcard/ns#hasMember",
    stranger,
  );
  source.store(url, await serialize(dataset), "text/turtle");
  source.setAcl(url, await acl(source, url, { grants: [grant()], denials: [] }));
  const file = `${source.root}file`;
  source.store(file, "private");
  source.setAcl(
    file,
    await acl(source, file, { grants: [grant([[{ kind: "group", group }]])], denials: [] }),
  );
  const corrupt = () =>
    new Response(new Uint8Array([35, 32, 0xc3]), {
      headers: { "content-type": "text/turtle", "content-length": "3" },
    });
  if (!afterPlan) source.responses.set(`GET ${url}`, corrupt);
  const options = { source: source.side(), target: target.side() };
  const plan = await planMigration(options);
  const item = plan.report.find(
    (item) => item.kind === "group-unsupported" && item.resourceUrl === file,
  );
  expect(item?.options.some((option) => option.id === "expand")).toBe(afterPlan);
  if (afterPlan) {
    source.responses.set(`GET ${url}`, corrupt);
    const result = await executeMigration(
      finalizePlan(plan, resolve(plan, { "group-unsupported": "expand" })),
      options,
    );
    expect(result.failed).toEqual([
      expect.objectContaining({ url: `${target.root}group`, error: expect.stringContaining(url) }),
    ]);
    expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
  }
});
