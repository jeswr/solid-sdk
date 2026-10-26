// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol

import { extractMediaType, fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  normalizePodBase,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { AclResource, Authorization, Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { gpxToWorkout } from "./gpx.js";
import {
  addMeasurement,
  Details,
  type Measurement,
  type MetricKind,
  measurements,
  monthKey,
  monthKeys,
  type Range,
  validateMeasurement,
} from "./metrics.js";
import { HealthDocument } from "./model.js";
import { addRecord, type RecordInput, type RecordKind, records } from "./records.js";
import { toTurtle } from "./serialise.js";
import { WorkoutFile, workouts } from "./workouts.js";

export type Precondition = { etag: string } | { create: true };
export class HealthIoError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super(`Health ${operation} failed (${status})`);
    this.name = "HealthIoError";
  }
}
export function emptyHealthDocument(): HealthDocument {
  return new HealthDocument(new Store(), DataFactory);
}
export async function parseHealth(source: string, url: string): Promise<HealthDocument> {
  return new HealthDocument(await parseRdf(source, "text/turtle", { baseIRI: url }), DataFactory);
}
function precondition(value: Precondition): Record<string, string> {
  if ("create" in value) return { "if-none-match": "*" };
  if (!/^"[^"\r\n]*"$/.test(value.etag)) throw new TypeError("A strong ETag is required");
  return { "if-match": value.etag };
}
function checked(response: Response, operation: string): Response {
  if (!response.ok) throw new HealthIoError(response.status, operation);
  return response;
}
function id(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    throw new TypeError("Invalid health resource ID");
  return value;
}
/** Inline contexts are safe; remote contexts and imports would use the parser's global fetch. */
function assertInlineContexts(value: unknown, context = false): void {
  if (context && typeof value === "string")
    throw new TypeError("External JSON-LD contexts are not allowed");
  if (Array.isArray(value)) {
    for (const entry of value) assertInlineContexts(entry, context);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value))
      assertInlineContexts(entry, key === "@context" || key === "@import");
  }
}
/** Explicit pod scope + injected authenticated fetch; never uses a global transport. */
export function createHealthStore(fetch: typeof globalThis.fetch, storage: string, owner: string) {
  if (safeHttpIri(owner) !== owner) throw new TypeError("Invalid owner IRI");
  const base = assertWithinPodScope(normalizePodBase(storage), "health/");
  const transport = createPodScopedFetch(base, { fetch: refuseRedirects(fetch) });
  const resolve = (path: string) => assertWithinPodScope(base, path);
  const rdfTransport: typeof globalThis.fetch = async (input, init) => {
    const response = await transport(input, init);
    if (
      !response.ok ||
      extractMediaType(response.headers.get("content-type")) !== "application/ld+json"
    )
      return response;
    const json: unknown = await response.json();
    assertInlineContexts(json);
    // Parse exactly the validated object, including when the input had duplicate JSON keys.
    return new Response(JSON.stringify(json), {
      status: response.status,
      headers: response.headers,
    });
  };
  const readRdf = (url: string) => fetchRdf(url, { fetch: rdfTransport });
  const readRaw = (path: string) => readRdf(resolve(path));
  async function read(path: string) {
    const result = await readRaw(path);
    return {
      document: new HealthDocument(result.dataset, DataFactory),
      etag: result.etag,
      url: result.url,
    };
  }
  async function put(path: string, body: string, contentType: string, condition: Precondition) {
    precondition(condition);
    await verifyPrivacy(resolve(path));
    return checked(
      await transport(resolve(path), {
        method: "PUT",
        headers: { "content-type": contentType, ...precondition(condition) },
        body,
      }),
      "write",
    );
  }
  async function write(path: string, document: DatasetCore, condition: Precondition) {
    // Validate concurrency before expensive serialization.
    precondition(condition);
    return put(path, await toTurtle(document), "text/turtle", condition);
  }
  async function createContainer(path: string) {
    const url = resolve(path);
    const response = await transport(url, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        "if-none-match": "*",
        link: `<${NS.LDP}BasicContainer>; rel="type"`,
      },
      body: "",
    });
    if (response.status !== 412) checked(response, "create container");
    const metadata =
      response.status === 412
        ? checked(await transport(url, { method: "HEAD" }), "inspect container")
        : response;
    // The Link header is authoritative. Never assume a .acl suffix or overwrite
    // an existing container's deliberately shared access rules.
    const aclUrl = aclLink(metadata, url);
    // Retry after a partial creation must never mistake inherited public access
    // for successful privacy setup. Verify existing ACLs, or create a missing one.
    try {
      const existing = await readRdf(aclUrl);
      verifyOwnerAcl(existing.dataset, url, true);
      return;
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
    }
    const document = new Store();
    const authorization = new Authorization(`${aclUrl}#owner`, document, DataFactory);
    authorization.type.add(`${NS.ACL}Authorization`);
    authorization.agent.add(owner);
    authorization.accessTo = url;
    authorization.default = url;
    authorization.canRead = true;
    authorization.canWrite = true;
    authorization.canReadWriteAcl = true;
    checked(
      await transport(aclUrl, {
        method: "PUT",
        headers: { "content-type": "text/turtle", "if-none-match": "*" },
        body: await toTurtle(document),
      }),
      "set owner access",
    );
  }
  function aclLink(metadata: Response, url: string): string {
    const link = metadata.headers.get("link") ?? "";
    const acl = link
      .split(",")
      .map((part) => part.match(/<([^>]+)>\s*;\s*rel="?acl"?(?:\s*;|\s*$)/i))
      .find((match) => match !== null)?.[1];
    if (acl === undefined) throw new TypeError("Owner-private access requires an ACL link");
    return assertWithinPodScope(base, new URL(acl, url).href);
  }
  function verifyOwnerAcl(dataset: DatasetCore, url: string, inherited: boolean) {
    const rules = [...new AclResource(dataset, DataFactory).authorizations];
    if (rules.length !== 1) throw new TypeError("Resource is not owner-private");
    const rule = rules[0] as Authorization;
    if (
      rule.accessTo !== url ||
      (inherited && rule.default !== url) ||
      rule.agent.size !== 1 ||
      !rule.agent.has(owner) ||
      rule.agentClass.size !== 0 ||
      rule.agentGroup !== undefined ||
      rule.origin.size !== 0 ||
      !rule.canRead ||
      !rule.canWrite ||
      !rule.canReadWriteAcl
    )
      throw new TypeError("Resource is not owner-private");
  }
  async function verifyParentPrivacy(url: string) {
    if (url === base) throw new TypeError("Cannot establish owner-private inheritance");
    await verifyPrivacy(
      assertWithinPodScope(base, new URL(url.endsWith("/") ? "../" : ".", url).href),
      true,
    );
  }
  async function verifyPrivacy(url: string, inherited = false): Promise<void> {
    const metadata = await transport(url, { method: "HEAD" });
    // A missing resource may still have an ACL. Only inherit after that ACL
    // itself returns 404; the advertised link remains authoritative.
    if (metadata.status !== 404 || inherited) checked(metadata, "inspect privacy");
    const aclUrl = aclLink(metadata, url);
    try {
      const acl = await readRdf(aclUrl);
      verifyOwnerAcl(acl.dataset, url, inherited);
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      await verifyParentPrivacy(url);
    }
  }
  async function initialize() {
    await createContainer(base);
    for (const path of [
      "observations/",
      "records/",
      "conditions/",
      "medications/",
      "immunisations/",
      "workouts/",
    ])
      await createContainer(path);
  }
  async function listing(path: string): Promise<string[]> {
    try {
      const result = await readRaw(path);
      const container = new Container(resolve(path), result.dataset, DataFactory);
      return [...container.contains].map((resource) => assertWithinPodScope(base, resource.value));
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return [];
      throw error;
    }
  }
  async function addObservation(key: string, input: Omit<Measurement, "iri">) {
    const path = `observations/${monthKey(input.at)}.ttl`;
    const iri = `${resolve(path)}#${id(key)}`;
    validateMeasurement({ ...input, iri });
    let document: HealthDocument;
    let condition: Precondition;
    try {
      const result = await read(path);
      document = result.document;
      if (result.etag === null) throw new TypeError("A strong ETag is required");
      condition = { etag: result.etag };
    } catch (error) {
      if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      document = emptyHealthDocument();
      condition = { create: true };
    }
    await initialize();
    addMeasurement(document, { ...input, iri });
    document.observation(iri).patient = owner;
    await write(path, document, condition);
    return iri;
  }
  async function metric(kind: MetricKind, range: Range) {
    const entries: Measurement[] = [];
    for (const key of monthKeys(range)) {
      try {
        entries.push(
          ...measurements((await read(`observations/${key}.ttl`)).document, kind, range),
        );
      } catch (error) {
        if (!(error instanceof RdfFetchError && error.status === 404)) throw error;
      }
    }
    return entries.sort((a, b) => a.at.getTime() - b.at.getTime() || a.iri.localeCompare(b.iri));
  }
  async function saveRecord(key: string, input: Omit<RecordInput, "iri">, condition: Precondition) {
    const path = `${input.kind}/${id(key)}.ttl`;
    precondition(condition);
    const document = "create" in condition ? emptyHealthDocument() : (await read(path)).document;
    const iri = `${resolve(path)}#it`;
    addRecord(document, { ...input, iri });
    await initialize();
    await write(path, document, condition);
    return iri;
  }
  async function loadRecords(kind: RecordKind) {
    const result = [];
    for (const url of await listing(`${kind}/`))
      result.push(...records((await read(url)).document, kind));
    return result;
  }
  async function importGpx(key: string, xml: string) {
    const path = `workouts/${id(key)}/`;
    const iri = `${resolve(path)}index.ttl#it`;
    const { document, workout } = gpxToWorkout(xml, { workoutIri: iri, patient: owner });
    const file = new WorkoutFile(iri, document, DataFactory);
    file.gpx = resolve(`${path}route.gpx`);
    file.format = "application/gpx+xml";
    new Details(iri, document, DataFactory).source = "GPX";
    await initialize();
    await createContainer(path);
    try {
      await put(`${path}route.gpx`, xml, "application/gpx+xml", { create: true });
    } catch (error) {
      if (!(error instanceof HealthIoError && error.operation === "write" && error.status === 412))
        throw error;
      // Resume only an identical upload; never replace a different route on retry.
      const route = checked(await transport(resolve(`${path}route.gpx`)), "read GPX");
      if ((await route.text()) !== xml) throw error;
    }
    await write(`${path}index.ttl`, document, { create: true });
    return workout;
  }
  async function loadWorkouts() {
    const result = [];
    for (const url of await listing("workouts/")) {
      const path = url.endsWith("/") ? `${url}index.ttl` : url;
      try {
        result.push(...workouts((await read(path)).document));
      } catch (error) {
        // A directory can remain after the route upload but before its index exists.
        if (!(url.endsWith("/") && error instanceof RdfFetchError && error.status === 404))
          throw error;
      }
    }
    return result;
  }
  /** Explicit one-shot persistence. Canonical documents cause no PUT on repeat. */
  async function migrate(path: string): Promise<boolean> {
    const result = await readRaw(path);
    const changed = [...result.dataset].some(
      (quad) =>
        canonicalize(quad.predicate.value) !== quad.predicate.value ||
        (quad.predicate.value === `${NS.RDF}type` &&
          quad.object.termType === "NamedNode" &&
          canonicalize(quad.object.value) !== quad.object.value),
    );
    if (!changed) return false;
    if (result.etag === null) throw new TypeError("A strong ETag is required");
    await write(path, new HealthDocument(result.dataset, DataFactory), { etag: result.etag });
    return true;
  }
  return {
    base,
    read,
    write,
    initialize,
    addObservation,
    metric,
    saveRecord,
    loadRecords,
    importGpx,
    loadWorkouts,
    migrate,
  };
}
