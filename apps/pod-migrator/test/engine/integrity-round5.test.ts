// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store, Writer } from "n3";
import { expect, it, vi } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { RDF, RdfNode, serialize } from "../../src/engine/rdf.js";
import { acl, grant, pods, policy, resolve, stranger } from "./helpers.js";

function rdf(body: string, type = "text/turtle"): Response {
  return new Response(body, { headers: { "content-type": type } });
}
async function nquads(body: string, url: string): Promise<string> {
  const writer = new Writer({ format: "N-Quads" });
  writer.addQuads([...(await parseRdf(body, "text/turtle", { baseIRI: url }))]);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}
async function listing(root: string, child: string): Promise<{ prefix: string; full: string }> {
  const dataset = new Store();
  new RdfNode(root, dataset, DataFactory).add(
    `${RDF}type`,
    "http://www.w3.org/ns/ldp#BasicContainer",
  );
  const first = await serialize(dataset);
  const tailDataset = new Store();
  new RdfNode(root, tailDataset, DataFactory).add("http://www.w3.org/ns/ldp#contains", child);
  const tail = await serialize(tailDataset);
  const prefix = `#${"é".repeat(tail.length)}\n${first}`;
  // A character-counted response ends at a valid RDF boundary, hiding the sibling.
  expect(Buffer.byteLength(prefix)).toBe((prefix + tail).length);
  return { prefix, full: prefix + tail };
}

it.each(
  (["planning", "execution"] as const).flatMap((stage) =>
    [
      { truncated: true, conversion: false, shared: true },
      { truncated: true, conversion: true, shared: true },
      { truncated: false, conversion: true, shared: true },
      { truncated: false, conversion: true, shared: false },
    ].map((scenario) => ({ stage, ...scenario })),
  ),
)("protects target inventory in $stage ($truncated, conversion=$conversion, shared=$shared)", async ({
  stage,
  truncated,
  conversion,
  shared,
}) => {
  const { source, target } = await pods("acp", "acp");
  const folder = `${source.root}folder/`;
  const destination = `${target.root}folder/`;
  const sibling = `${target.root}private-sibling`;
  source.store(folder, "", "text/turtle");
  source.setAcl(folder, await acl(source, folder, policy(grant(undefined, { appliesTo: "both" }))));
  // The future destination's orphan ACR is also used by an unmigrated sibling.
  target.setAcl(destination, await acl(target, destination));
  if (shared) target.aclOverrides.set(sibling, target.acl(destination));
  const body = await listing(target.root, sibling);
  const converted = await nquads(body.full, target.root);
  const side = target.side();
  const get = side.http.get;
  let inject = stage === "planning";
  const conversions = vi.fn(() =>
    conversion ? rdf(converted, "application/n-quads") : new Response(null, { status: 406 }),
  );
  side.http = {
    ...side.http,
    get: async (url, init) =>
      inject && url === target.root
        ? init?.accept === "application/n-quads"
          ? conversions()
          : rdf(truncated ? body.prefix : body.full)
        : get(url, init),
  };
  if (inject) target.store(sibling, "private");
  const options = { source: source.side(), target: side };
  const plan = await planMigration(options);
  if (stage === "execution") {
    target.store(sibling, "private");
    inject = true;
  }
  expect(await target.permissions(sibling, { agent: stranger })).not.toContain("read");
  if (stage === "planning" && truncated) {
    expect(plan.resources).toEqual([]);
    expect(plan.report).toEqual([
      expect.objectContaining({
        kind: "resource-unreadable",
        resourceUrl: target.root,
        explanation: expect.stringContaining("completeness cannot be established"),
        options: [expect.objectContaining({ id: "abort" })],
      }),
    ]);
  } else {
    if (stage === "planning" && shared)
      expect(plan.report).toContainEqual(
        expect.objectContaining({ kind: "acl-unreadable", resourceUrl: folder }),
      );
    const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
    expect(await target.permissions(sibling, { agent: stranger })).not.toContain("read");
    if (stage === "execution" && (truncated || shared)) {
      expect(result.verified).toBe(false);
      expect(result.failed).toEqual([
        {
          url: truncated ? target.root : destination,
          error: expect.stringContaining(
            truncated ? "completeness cannot be established" : "shared",
          ),
        },
      ]);
    } else {
      expect(result.failed).toEqual([]);
      expect(result.verified).toBe(true);
    }
    expect(result.aclWritten.length > 0).toBe(!truncated && !shared);
  }
  expect(conversions).toHaveBeenCalled();
  expect(target.requests.filter((request) => request.method === "PUT").length > 0).toBe(
    !truncated && !shared,
  );
  expect(await target.permissions(sibling, { agent: stranger })).not.toContain("read");
  if (!truncated && !shared)
    expect(await target.permissions(destination, { agent: stranger })).toContain("read");
});

it.each([
  "planning",
  "execution",
  "complete",
] as const)("requires completeness of anonymous group snapshots (%s)", async (stage) => {
  const { source, target } = await pods();
  const file = `${source.root}file`;
  const url = `${source.root}group`;
  const group = `${url}#team`;
  const dataset = new Store();
  new RdfNode(group, dataset, DataFactory).add(
    "http://www.w3.org/2006/vcard/ns#hasMember",
    stranger,
  );
  const body = `# café\n${await serialize(dataset)}`;
  source.store(url, body, "text/turtle");
  source.setAcl(url, await acl(source, url, policy(grant())));
  source.store(file, "secret");
  source.setAcl(file, await acl(source, file, policy(grant([[{ kind: "group", group }]]))));
  const side = source.side();
  const publicHttp = side.publicHttp as NonNullable<typeof side.publicHttp>;
  let available = stage !== "planning";
  const converted = await nquads(body, url);
  const conversions = vi.fn(() =>
    available ? rdf(converted, "application/n-quads") : new Response(null, { status: 406 }),
  );
  side.publicHttp = {
    ...publicHttp,
    get: async (resource, init) =>
      resource === url
        ? init?.accept === "application/n-quads"
          ? conversions()
          : rdf(body)
        : publicHttp.get(resource, init),
  };
  const options = { source: side, target: target.side() };
  const plan = await planMigration(options);
  const item = plan.report.find((item) => item.kind === "group-unsupported");
  expect(item?.options.some((option) => option.id === "expand")).toBe(stage !== "planning");
  expect(conversions).toHaveBeenCalledTimes(1);
  if (stage === "planning") return;
  available = stage === "complete";
  const result = await executeMigration(
    finalizePlan(plan, resolve(plan, { "group-unsupported": "expand" })),
    options,
  );
  expect(result.verified).toBe(available);
  if (!available) {
    expect(result.failed[0]?.error).toContain("completeness cannot be established");
    expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
  } else expect(result.failed).toEqual([]);
});

it("retains the data fallback for length-free Unicode source container listings", async () => {
  const { source, target } = await pods();
  const side = source.side();
  const get = side.http.get;
  const conversions = vi.fn(() => new Response(null, { status: 406 }));
  side.http = {
    ...side.http,
    get: async (url, init) => {
      if (url !== source.root) return get(url, init);
      if (init?.accept === "application/n-quads") return conversions();
      const response = await get(url, init);
      return rdf(`# café\n${await response.text()}`);
    },
  };
  const options = { source: side, target: target.side() };
  const plan = await planMigration(options);
  expect(plan.resources).toHaveLength(1);
  expect(conversions).toHaveBeenCalledTimes(1);
  expect((await executeMigration(finalizePlan(plan, resolve(plan)), options)).verified).toBe(true);
});
