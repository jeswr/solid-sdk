// AUTHORED-BY Codex GPT-6
import { gzipSync } from "node:zlib";
import { parseRdf } from "@jeswr/fetch-rdf";
import { LiteralFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { expect, it, vi } from "vitest";
import { detectAccessSystem, readAccess } from "../../src/engine/access.js";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { serialize } from "../../src/engine/rdf.js";
import { readResourceBytes } from "../../src/engine/resource-body.js";
import { writeAcp } from "../../src/engine/systems/acp.js";
import { acl, grant, pods, resolve, stranger } from "./helpers.js";

async function turtle(value: string): Promise<string> {
  const dataset = new Store();
  const node = new TermWrapper("urn:note", dataset, DataFactory);
  SetFrom.subjectPredicate(node, "urn:text", (term) => term.value, LiteralFrom.string).add(value);
  return serialize(dataset);
}
async function nquads(body: string, url: string): Promise<string> {
  const writer = new Writer({ format: "N-Quads" });
  writer.addQuads([...(await parseRdf(body, "text/turtle", { baseIRI: url }))]);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}
function rdf(body: string, type = "text/turtle", length?: number): Response {
  const headers = new Headers({ "content-type": type });
  if (length !== undefined) headers.set("content-length", String(length));
  return new Response(body, { headers });
}

it.each([
  "wac",
  "acp",
] as const)("refuses a length-free truncated %s document unless an actual conversion agrees", async (system) => {
  const { source, target } = await pods(system);
  const folder = `${source.root}folder/`;
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
          "urn:trailing-denial",
        )
      : await turtle("trailing metadata");
  const prefix = `#${"é".repeat(tail.length)}\n${grants}`;
  const full = prefix + tail;
  expect(Buffer.byteLength(prefix)).toBe(full.length);
  source.setAcl(folder, full);
  if (system === "acp") {
    expect(await source.permissions(`${folder}secret`, { agent: stranger })).not.toContain("read");
    expect(await source.permissions(`${folder}secret`, { agent: "urn:allowed" })).toContain("read");
  }
  const sourceSide = source.side();
  const get = sourceSide.http.get;
  const converted = await nquads(full, url);
  const conversions = vi.fn(() => rdf(converted, "application/n-quads"));
  sourceSide.http = {
    ...sourceSide.http,
    get: async (resource, init) =>
      resource === url
        ? init?.accept === "application/n-quads"
          ? conversions()
          : rdf(prefix) // A buggy intermediary removed the original length header.
        : get(resource, init),
  };
  const options = { source: sourceSide, target: target.side() };
  const plan = await planMigration(options);
  const item = plan.report.find(
    (item) => item.kind === "acl-unreadable" && item.resourceUrl === folder,
  );
  expect(item?.options.map((option) => option.id)).toEqual(["skip", "abort"]);
  expect(item?.explanation).toContain(url);
  expect(item?.explanation).toContain("graph mismatch");
  expect(conversions).toHaveBeenCalledTimes(1);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([]);
  expect(target.data.has(`${target.root}folder/`)).toBe(false);
  expect(target.data.has(`${target.root}folder/secret`)).toBe(false);
});

it.each([
  "unavailable",
  "echoed",
  "length-framed",
  "conversion",
])("requires a different length-free conversion for an intact Unicode access document (%s)", async (evidence) => {
  const { source } = await pods();
  const body = `# café\n${await acl(source, source.root)}`;
  const url = source.acl(source.root);
  const side = source.side();
  const get = vi.fn(async (_resource, init) => {
    if (init?.accept !== "application/n-quads") return rdf(body);
    if (evidence === "unavailable") return new Response(null, { status: 406 });
    if (evidence === "echoed") return rdf(body);
    const converted = await nquads(body, url);
    return rdf(
      converted,
      "application/n-quads",
      evidence === "length-framed" ? Buffer.byteLength(converted) : undefined,
    );
  });
  side.http = { ...side.http, get };
  const reading = readAccess(side, source.root, "wac");
  if (evidence === "conversion") {
    expect((await reading)?.policy.grants.length).toBeGreaterThan(0);
  } else {
    await expect(reading).rejects.toMatchObject({
      resourceUrl: source.root,
      message: expect.stringContaining("completeness cannot be established"),
    });
  }
  expect(get).toHaveBeenCalledTimes(3);
  expect(get).toHaveBeenLastCalledWith(url, { accept: "application/n-quads", signal: undefined });
});

it("documents the out-of-scope adversarial source that omits a denial in both representations", async () => {
  const { source, target } = await pods("acp", "acp");
  const file = `${source.root}secret`;
  const url = source.acl(file);
  source.store(file, "private");
  const grants = await acl(source, file, { grants: [grant()], denials: [] });
  const denial = await writeAcp(
    { grants: [], denials: [grant([[{ kind: "agent", webId: stranger }]])] },
    file,
    url,
    "css",
    "urn:trailing-denial",
  );
  const prefix = `#${"é".repeat(denial.length)}\n${grants}`;
  source.setAcl(file, prefix + denial);
  expect(Buffer.byteLength(prefix)).toBe((prefix + denial).length);
  expect(await source.permissions(file, { agent: stranger })).not.toContain("read");
  const side = source.side();
  const get = side.http.get;
  const forgedConversion = await nquads(prefix, url);
  side.http = {
    ...side.http,
    get: async (resource, init) =>
      resource === url
        ? init?.accept === "application/n-quads"
          ? rdf(forgedConversion, "application/n-quads")
          : rdf(prefix, "text/turtle", Buffer.byteLength(prefix))
        : get(resource, init),
  };
  // The server defines/enforces its policy and can lie about its own data in both
  // paths. No graph comparison can recover the withheld denial (DESIGN threat model).
  const options = { source: side, target: target.side() };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([]);
  expect(result.verified).toBe(true);
  expect(await target.permissions(`${target.root}secret`, { agent: stranger })).toContain("read");
});

it.each([
  false,
  true,
])("copies a graph-complete prefix missing a duplicate triple only with a warning (rewrite=%s)", async (rewriteIris) => {
  const { source, target } = await pods();
  const url = `${source.root}duplicates.ttl`;
  const duplicate = await turtle("already present");
  const prefix = `#${"é".repeat(duplicate.length)}\n${duplicate}`;
  const complete = prefix + duplicate;
  expect(Buffer.byteLength(prefix)).toBe(complete.length);
  expect(
    (await parseRdf(prefix, "text/turtle")).equals(await parseRdf(complete, "text/turtle")),
  ).toBe(true);
  source.store(url, complete, "text/turtle");
  const side = source.side();
  const get = side.http.get;
  const converted = await nquads(complete, url);
  side.http = {
    ...side.http,
    get: async (resource, init) =>
      resource === url
        ? init?.accept === "application/n-quads"
          ? rdf(converted, "application/n-quads")
          : rdf(prefix, "text/turtle", Buffer.byteLength(prefix))
        : get(resource, init),
  };
  const options = { source: side, target: target.side(), rewriteIris };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  if (rewriteIris) {
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(target.data.get(`${target.root}duplicates.ttl`)?.type).toBe("application/trig");
    expect(
      (
        await parseRdf(
          new TextDecoder().decode(target.data.get(`${target.root}duplicates.ttl`)?.bytes),
          "application/trig",
        )
      ).equals(await parseRdf(complete, "text/turtle")),
    ).toBe(true);
  } else {
    // The duplicate triple carries no RDF meaning: copy the received bytes and warn.
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(result.copied).toContain(`${target.root}duplicates.ttl`);
    expect(new TextDecoder().decode(target.data.get(`${target.root}duplicates.ttl`)?.bytes)).toBe(
      prefix,
    );
    expect(result.log).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("duplicate triples"),
      }),
    );
  }
});

it("accepts intact decoded bodies through a CORS response that hides Content-Encoding", async () => {
  const body = "Intact café 漢字 🌱. ".repeat(100);
  const compressed = gzipSync(body);
  const networkHeaders = new Headers({
    "content-type": "text/plain",
    "content-length": String(compressed.length),
    "content-encoding": "gzip",
  });
  // CORS safelists Content-Length and Content-Type, but not Content-Encoding.
  const exposed = new Headers([...networkHeaders].filter(([key]) => key !== "content-encoding"));
  const filtered = new Response(body, { headers: exposed });
  Object.defineProperty(filtered, "type", { value: "cors" });
  expect(filtered.headers.get("content-encoding")).toBeNull();
  expect(Buffer.byteLength(body)).toBeGreaterThan(compressed.length);
  expect(await readResourceBytes(filtered, "https://source.example/pod/gzip")).toEqual(
    new TextEncoder().encode(body),
  );

  // The decoded bytes also cannot have been cut at the smaller encoded length.
  const turtleBody = await turtle(body);
  const get = vi.fn();
  expect(
    await readResourceBytes(
      rdf(turtleBody, "text/turtle", gzipSync(turtleBody).length),
      "urn:gzip",
      { http: { get } as never },
    ),
  ).toEqual(new TextEncoder().encode(turtleBody));
  expect(get).not.toHaveBeenCalled();
});

it.each([
  "lock",
  "grant",
  "verify",
] as const)("attributes a late access transport failure during %s to the protected resource", async (phase) => {
  const { source, target } = await pods();
  source.store(`${source.root}file`, "private");
  source.store(`${source.root}folder/`, "", "text/turtle");
  const file = `${target.root}file`;
  const document = target.acl(file);
  const options = {
    source: source.side(),
    target: target.side(),
    onProgress(event: { phase: string }) {
      if (event.phase === { lock: "lock", grant: "copy", verify: "grant" }[phase])
        target.responses.set(`GET ${document}`, () => {
          throw new Error("connection failed");
        });
    },
  };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.verified).toBe(false);
  expect(result.failed).toEqual([
    { url: file, error: `Cannot read access document ${document}: connection failed` },
  ]);
});

it.each([
  "head",
  "get",
] as const)("attributes access discovery %s transport failures to the root", async (method) => {
  const { source } = await pods();
  const side = source.side();
  side.http = {
    ...side.http,
    [method]: async () => {
      throw "connection refused";
    },
  };
  await expect(detectAccessSystem(side)).rejects.toMatchObject({
    resourceUrl: source.root,
    message: expect.stringContaining("connection refused"),
  });
});

it("refuses a graph-only verbatim read unless the caller accepts it", async () => {
  const url = "https://source.example/pod/note.ttl";
  const body = await turtle("café");
  const converted = await nquads(body, url);
  const http = { get: async () => rdf(converted, "application/n-quads") } as never;
  const read = (onGraphProofOnly?: (reason: string) => void) =>
    readResourceBytes(rdf(body, "text/turtle", Buffer.byteLength(body)), url, {
      http,
      onGraphProofOnly,
    });
  await expect(read()).rejects.toMatchObject({
    message: expect.stringContaining("Byte-verbatim completeness"),
  });
  const accept = vi.fn();
  expect(await read(accept)).toEqual(new TextEncoder().encode(body));
  expect(accept).toHaveBeenCalledWith(expect.stringContaining("duplicate triples"));
});
