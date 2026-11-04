// AUTHORED-BY GPT-5.6 Sol via codex
// AUTHORED-BY Claude Opus 5.5

import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import type { GeneratedInstance } from "@jeswr/synthetic-rdf";
import type { Quad, Term } from "@rdfjs/types";
import { Parser } from "n3";
import { assertHttpIri } from "./iri.js";
import { rebaseQuads, serializeAcl, serializeRdf } from "./rdf.js";
import {
  type GroupOutcome,
  type PodContext,
  type PodManifest,
  type PodSpec,
  type ResourceOutcome,
  type ResourceSpec,
  SeedError,
  type SeedManifest,
  type SeedOptions,
  type SeedTarget,
} from "./types.js";

const DEFAULT_CONTENT_TYPE = "text/turtle";
const DEFAULT_PLACEHOLDER_BASE = "urn:synthetic:";

type SeedMode = "create" | "ensure" | "replace";

interface MaterializedResource {
  spec: ResourceSpec;
  outcome: ResourceOutcome;
  instance?: GeneratedInstance;
  body?: string;
  aclBody?: string;
  /** Owner-only ACL held while the data is written, before `aclBody`'s grants. */
  ownerAclBody?: string;
}

interface MaterializedAction {
  group?: GroupOutcome;
  resources: MaterializedResource[];
}

interface MaterializedPod {
  target: SeedTarget;
  manifest: PodManifest;
  actions: MaterializedAction[];
}

class HttpFailure extends Error {
  readonly status: number;

  constructor(method: string, url: string, status: number, detail: string) {
    super(`${method} ${url} failed: ${status}${detail === "" ? "" : ` ${detail}`}`);
    this.status = status;
  }
}

function instanceKey(shape: string, index = 0): string {
  return `${shape}\u0000${index}`;
}

/**
 * True when the path percent-encodes a character that needs no encoding (RFC 3986
 * unreserved), "/", "\\" or "%" (a double encoding whose meaning depends on how
 * many times the server decodes). Servers such as CSS decode and re-encode each segment
 * before lookup, so `/x.%61cl` would reach `/x.acl`; the only legitimate escapes
 * are for characters that must be escaped.
 */
function encodesPlainCharacter(path: string): boolean {
  for (const [, hex] of path.matchAll(/%([0-9a-f]{2})/gi)) {
    if (/[A-Za-z0-9._~/\\%-]/.test(String.fromCharCode(Number.parseInt(hex as string, 16))))
      return true;
  }
  return false;
}

function resolveResource(baseUrl: string, path: string): string {
  const base = assertHttpIri(baseUrl, "SeedTarget.baseUrl", { requireOrigin: true });
  // Auxiliary resources (.acl, .acr, .meta) are never seeded as data, including
  // through a percent-encoded dot a server may decode before mapping the path.
  if (!path.startsWith("/") || /\.(acl|acr|meta)$/i.test(path) || encodesPlainCharacter(path)) {
    throw new Error(
      `resource path must start with "/", must not target an auxiliary resource and must not percent-encode an unreserved character, "/" or "\\": ${path}`,
    );
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject every IRIREF control/space byte
  if (path.includes("?") || path.includes("#") || /[\u0000-\u0020<>"{}|^`\\]/u.test(path)) {
    throw new Error(`resource path is not a safe pod-root-relative IRI: ${path}`);
  }
  const resolved = new URL(path, base.origin);
  if (resolved.pathname !== path || resolved.origin !== base.origin) {
    throw new Error(`resource path must not contain traversal or change origin: ${path}`);
  }
  return resolved.href;
}

function groupId(entryIndex: number): string {
  return `group-${entryIndex}`;
}

function shapeInstances(data: SeedOptions["data"], shape: string): GeneratedInstance[] {
  return data?.instances.filter((instance) => instance.shape.value === shape) ?? [];
}

async function targetFor(
  pod: PodSpec,
  provisioner: SeedOptions["provisioner"],
): Promise<SeedTarget> {
  const target =
    "target" in pod.account
      ? pod.account.target
      : await (() => {
          if (provisioner === undefined) {
            throw new Error("SeedOptions.provisioner is required by a provisioned pod");
          }
          return provisioner.provisionAccount(pod.account.provision.webid);
        })();
  assertHttpIri(target.webid, "SeedTarget.webid", { allowFragment: true });
  assertHttpIri(target.baseUrl, "SeedTarget.baseUrl", { requireOrigin: true });
  if (typeof target.authFetch !== "function") {
    throw new Error("SeedTarget.authFetch must be Fetch-compatible");
  }
  return target;
}

function resolveInstance(options: SeedOptions, spec: ResourceSpec): GeneratedInstance | undefined {
  if (!("instance" in spec.source)) return undefined;
  if (options.data === undefined) {
    throw new Error(`resource ${spec.path} uses InstanceRef but SeedOptions.data is absent`);
  }
  const reference = spec.source.instance;
  const index = reference.index ?? 0;
  const matches = options.data.instances.filter(
    (value) => value.shape.value === reference.shape && value.index === index,
  );
  if (matches.length !== 1) {
    throw new Error(
      `resource ${spec.path} expected exactly one generated instance ${reference.shape}[${index}], found ${matches.length}`,
    );
  }
  return matches[0];
}

function focusDestination(
  instance: GeneratedInstance,
  resourceUrl: string,
  placeholderBase: string,
): string | undefined {
  if (instance.focus.termType !== "NamedNode") {
    throw new Error(
      `top-level generated instance ${instance.shape.value}[${instance.index}] must have a named focus`,
    );
  }
  if (!instance.focus.value.startsWith(placeholderBase)) return undefined;
  const hash = instance.focus.value.indexOf("#");
  const fragment = hash === -1 ? "it" : instance.focus.value.slice(hash + 1);
  if (fragment === "")
    throw new Error(`generated instance has an empty identity fragment: ${instance.focus.value}`);
  return `${resourceUrl}#${fragment}`;
}

async function materializePod(
  target: SeedTarget,
  pod: PodSpec,
  options: SeedOptions,
  completedPods: readonly PodManifest[],
): Promise<MaterializedPod> {
  const actions: MaterializedAction[] = [];
  const resources: MaterializedResource[] = [];
  const groups: GroupOutcome[] = [];
  const context: PodContext = {
    webid: target.webid,
    baseUrl: target.baseUrl,
    resolve: (path) => resolveResource(target.baseUrl, path),
    instances: (shape) => shapeInstances(options.data, shape),
  };

  for (const [entryIndex, entry] of pod.resources.entries()) {
    if (typeof entry !== "function") {
      const outcome: ResourceOutcome = {
        path: entry.path,
        url: context.resolve(entry.path),
        status: "unwritten",
      };
      const resource = { spec: entry, outcome, instance: resolveInstance(options, entry) };
      resources.push(resource);
      actions.push({ resources: [resource] });
      continue;
    }

    const id = groupId(entryIndex);
    let expanded: readonly ResourceSpec[];
    try {
      expanded = await entry(context);
    } catch (cause) {
      const group: GroupOutcome = { id, members: [], status: "partial" };
      const manifest: PodManifest = {
        webid: target.webid,
        baseUrl: target.baseUrl,
        resources: resources.map((value) => value.outcome),
        groups: [...groups, group],
      };
      throw new SeedError(
        `resource expander ${id} failed`,
        { pods: [...completedPods, manifest] },
        { cause },
      );
    }
    if (expanded.length === 0) throw new Error(`resource expander ${id} returned no resources`);
    const group: GroupOutcome = {
      id,
      members: expanded.map((spec) => spec.path),
      status: "partial",
    };
    groups.push(group);
    const members = expanded.map((spec) => {
      const outcome: ResourceOutcome = {
        path: spec.path,
        url: context.resolve(spec.path),
        status: "unwritten",
        group: id,
      };
      return { spec, outcome, instance: resolveInstance(options, spec) };
    });
    resources.push(...members);
    actions.push({ group, resources: members });
  }

  const paths = new Set<string>();
  for (const resource of resources) {
    if (paths.has(resource.spec.path))
      throw new Error(`duplicate resource path: ${resource.spec.path}`);
    paths.add(resource.spec.path);
  }

  const replacements = new Map<string, string>();
  const assignedInstances = new Map<string, string>();
  const placeholderBase = options.placeholderBase ?? DEFAULT_PLACEHOLDER_BASE;
  for (const resource of resources) {
    if (resource.instance === undefined) continue;
    const key = instanceKey(resource.instance.shape.value, resource.instance.index);
    const prior = assignedInstances.get(key);
    if (prior !== undefined) {
      throw new Error(
        `generated instance ${resource.instance.shape.value}[${resource.instance.index}] is assigned to both ${prior} and ${resource.spec.path}`,
      );
    }
    assignedInstances.set(key, resource.spec.path);
    const destination = focusDestination(resource.instance, resource.outcome.url, placeholderBase);
    if (destination !== undefined) replacements.set(resource.instance.focus.value, destination);
  }

  for (const resource of resources) {
    let quads: readonly Quad[] | undefined;
    if (resource.instance !== undefined) quads = resource.instance.quads;
    else if ("dataset" in resource.spec.source) quads = [...resource.spec.source.dataset];
    if (quads !== undefined) {
      resource.body = await serializeRdf(
        rebaseQuads(quads, replacements, placeholderBase),
        resource.outcome.url,
      );
    } else if ("body" in resource.spec.source) {
      resource.body = resource.spec.source.body;
    }
    if (resource.spec.access !== undefined) {
      resource.aclBody = await serializeAcl(
        `${resource.outcome.url}.acl`,
        resource.outcome.url,
        target.webid,
        resource.spec.access,
      );
      resource.ownerAclBody = await serializeAcl(
        `${resource.outcome.url}.acl`,
        resource.outcome.url,
        target.webid,
        {},
      );
    }
  }

  return {
    target,
    actions,
    manifest: {
      webid: target.webid,
      baseUrl: target.baseUrl,
      resources: resources.map((value) => value.outcome),
      groups,
    },
  };
}

/** Error detail from a failed response: the first few KiB only, never the whole body. */
const MAX_DETAIL_BYTES = 4096;

async function responseDetail(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_DETAIL_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // A detail is best effort.
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(size, MAX_DETAIL_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.length) break;
  }
  return new TextDecoder().decode(bytes).trim();
}

/**
 * Every pod request refuses redirects: a cross-origin 307/308 would re-send a PUT
 * body, and an auth fetch's DPoP proof, to another origin.
 */
function podFetch(target: SeedTarget, url: string, init: RequestInit): Promise<Response> {
  return target.authFetch(url, { ...init, redirect: "error" });
}

async function exists(target: SeedTarget, url: string): Promise<boolean> {
  let response = await podFetch(target, url, { method: "HEAD" });
  if (response.status === 405 || response.status === 501) {
    response = await podFetch(target, url, { method: "GET" });
  }
  if (response.ok) {
    await response.body?.cancel();
    return true;
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }
  throw new HttpFailure("preflight", url, response.status, await responseDetail(response));
}

/**
 * Statuses that report a write or delete as done. A 202 only accepts it for
 * later processing, so the ACL transition that depends on it cannot advance yet.
 */
function completed(status: number): boolean {
  return status >= 200 && status < 300 && status !== 202;
}

/**
 * PUT a body. Returns the status and the strong ETag of the stored
 * representation, when the server sends one.
 */
async function putTagged(
  target: SeedTarget,
  url: string,
  body: string,
  contentType: string,
  conditional: boolean | { ifMatch: string },
): Promise<{ status: number; etag?: string }> {
  const headers = new Headers({ "content-type": contentType });
  if (conditional === true) headers.set("if-none-match", "*");
  else if (conditional !== false) headers.set("if-match", conditional.ifMatch);
  const response = await podFetch(target, url, { method: "PUT", headers, body });
  if (!completed(response.status))
    throw new HttpFailure("PUT", url, response.status, await responseDetail(response));
  await response.body?.cancel();
  const etag = response.headers.get("etag") ?? undefined;
  return etag === undefined || etag.startsWith("W/")
    ? { status: response.status }
    : { status: response.status, etag };
}

async function put(
  target: SeedTarget,
  url: string,
  body: string,
  contentType: string,
  conditional: boolean | { ifMatch: string },
): Promise<number> {
  return (await putTagged(target, url, body, contentType, conditional)).status;
}

/**
 * Remove a resource this run created after a later step failed, then the ACL this
 * run wrote for it. A failed write does not prove nothing was stored, and an ACL
 * removed first would leave stored data under the inherited (possibly broader)
 * ACL, so the resource goes first while its ACL still protects it, and the ACL is
 * removed only once the resource is confirmed gone. After a write that was only
 * accepted (202), nothing is removed. Returns the error to throw:
 * the original one, or one that also reports a removal that could not be confirmed.
 */
async function removeCreated(
  target: SeedTarget,
  url: string,
  aclAttempted: boolean,
  original: unknown,
): Promise<unknown> {
  const gone = async (resource: string): Promise<string | undefined> => {
    try {
      const response = await podFetch(target, resource, { method: "DELETE" });
      await response.body?.cancel();
      return completed(response.status) || response.status === 404
        ? undefined
        : `status ${response.status}`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  // A write that was only accepted (202) may still land after any cleanup, and a
  // server that deletes a resource's ACL with it (as the Solid Protocol requires)
  // would leave that late write under the inherited ACL. Completion is unknown, so
  // delete nothing: keep the resource and its owner-only ACL.
  if (aclAttempted && original instanceof HttpFailure && original.status === 202) {
    return new Error(
      `${original.message}; the accepted write may still land, so ${url} and its ACL were left in place`,
      { cause: original },
    );
  }
  const failure = await gone(url);
  if (failure !== undefined) {
    return new Error(
      `${original instanceof Error ? original.message : String(original)}; could not remove ${url} (${failure}), so its ACL was left in place`,
      { cause: original },
    );
  }
  // Not every server deletes a resource's ACL with it; a 404 means it did (or the
  // ACL PUT never landed).
  if (aclAttempted) {
    const aclFailure = await gone(`${url}.acl`);
    if (aclFailure !== undefined) {
      return new Error(
        `${original instanceof Error ? original.message : String(original)}; removed ${url} but not its ACL (${aclFailure})`,
        { cause: original },
      );
    }
  }
  return original;
}

/** Upper bound on an existing ACL read back for comparison. */
const MAX_ACL_BYTES = 1024 * 1024;

const ACL_NS = "http://www.w3.org/ns/auth/acl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
/**
 * Predicates that only ever add to what an authorization grants. Any other
 * statement about an authorization may restrict it (`acl:origin` does on servers
 * that enforce it), and dropping it on a rewrite could widen access.
 */
const GRANT_PREDICATES = new Set([
  RDF_TYPE,
  ...["accessTo", "default", "agent", "agentClass", "agentGroup", "mode"].map((p) => ACL_NS + p),
]);

interface AclStatement {
  subject: string;
  predicate: string;
  key: string;
}

/** The statements of a Turtle ACL with comparable keys, or undefined when it does not parse. */
function aclStatements(turtle: string, aclUrl: string): AclStatement[] | undefined {
  try {
    const key = (t: Term) =>
      t.termType === "Literal"
        ? `L|${t.value}|${t.datatype.value}|${t.language}`
        : `${t.termType}|${t.value}`;
    return new Parser({ format: "text/turtle", baseIRI: aclUrl }).parse(turtle).map((q) => ({
      subject: key(q.subject),
      predicate: q.predicate.value,
      key: `${key(q.subject)} ${key(q.predicate)} ${key(q.object)} ${key(q.graph)}`,
    }));
  } catch {
    return undefined;
  }
}

/** Read at most `limit` bytes of a body as UTF-8, or undefined when it is longer. */
async function boundedText(response: Response, limit: number): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Whether writing `desired` over the resource's current ACL can only narrow
 * access, with the ETag to make that write conditional on (so an ACL narrowed in
 * between is not overwritten). It can when every statement of `desired` is
 * already in the ACL and the authorizations `desired` names carry only
 * grant-adding statements there: WAC grants are monotone in those statements,
 * while a restriction such as `acl:origin` would be dropped by the rewrite. A
 * missing, unreadable, oversized or non-Turtle ACL counts as granting nothing.
 */
async function narrowingAcl(
  target: SeedTarget,
  aclUrl: string,
  desired: string,
): Promise<{ narrowing: boolean; etag?: string }> {
  const response = await podFetch(target, aclUrl, {
    method: "GET",
    headers: { accept: "text/turtle" },
  });
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!response.ok || type !== "text/turtle") {
    await response.body?.cancel();
    return { narrowing: false };
  }
  const etag = response.headers.get("etag") ?? undefined;
  const text = await boundedText(response, MAX_ACL_BYTES);
  const existing = text === undefined ? undefined : aclStatements(text, aclUrl);
  const wanted = aclStatements(desired, aclUrl);
  if (existing === undefined || wanted === undefined) return { narrowing: false };
  const present = new Set(existing.map((statement) => statement.key));
  const subjects = new Set(wanted.map((statement) => statement.subject));
  const narrowing =
    wanted.every((statement) => present.has(statement.key)) &&
    existing.every(
      (statement) => !subjects.has(statement.subject) || GRANT_PREDICATES.has(statement.predicate),
    );
  return etag === undefined ? { narrowing } : { narrowing, etag };
}

/**
 * Before granting more than owner-only access over content this run did not
 * write (the existing data of `ensure`, or the children an existing container's
 * `acl:default` reaches), require that the grants only narrow the current ACL.
 * Returns the ETag to condition the ACL write on.
 */
async function assertNarrowing(
  target: SeedTarget,
  resource: MaterializedResource,
  why: string,
): Promise<string | undefined> {
  if (resource.aclBody === resource.ownerAclBody) return undefined;
  const url = resource.outcome.url;
  const { narrowing, etag } = await narrowingAcl(target, `${url}.acl`, resource.aclBody as string);
  if (!narrowing) throw new Error(`${why} will not broaden access at ${url}`);
  return etag;
}

const LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";

/**
 * Refuse unless the container lists no members, read as Turtle (bounded, as for
 * an ACL). Anything that cannot be read that way counts as non-empty.
 */
async function assertEmptyContainer(target: SeedTarget, url: string): Promise<void> {
  const response = await podFetch(target, url, {
    method: "GET",
    cache: "no-store",
    headers: {
      accept: "text/turtle",
      prefer: 'return=representation; include="http://www.w3.org/ns/ldp#PreferContainment"',
    },
  });
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  let members: number | undefined;
  if (response.status === 200 && type === "text/turtle") {
    const text = await boundedText(response, MAX_ACL_BYTES);
    try {
      members =
        text === undefined
          ? undefined
          : new Parser({ format: "text/turtle", baseIRI: url })
              .parse(text)
              // Any containment triple counts, however its subject is spelled.
              .filter((q) => q.predicate.value === LDP_CONTAINS).length;
    } catch {
      members = undefined;
    }
  } else {
    await response.body?.cancel();
  }
  if (members !== 0) {
    throw new Error(
      `${url} is not confirmed empty, so its acl:default grants would reach children this run did not write`,
    );
  }
}

/**
 * Confirm the server governs `url` with a WAC ACL at `${url}.acl` (`Link: rel="acl"`).
 * The ACL body names that document, and a server that uses another location (ACP's
 * `.acr`) or none would otherwise store it as an ordinary resource that grants nothing.
 */
async function assertAclLocation(target: SeedTarget, url: string): Promise<void> {
  let response = await podFetch(target, url, { method: "HEAD" });
  if (response.status === 405 || response.status === 501) {
    await response.body?.cancel();
    response = await podFetch(target, url, { method: "GET" });
  }
  await response.body?.cancel();
  if (!response.ok) throw new HttpFailure("HEAD", url, response.status, "");
  const acls = parseLinkHeaders(response.headers.get("link"), url)
    .filter((link) => link.rel.includes("acl") && link.context === url)
    .map((link) => link.target);
  if (acls.length !== 1 || acls[0] !== `${url}.acl`) {
    throw new Error(
      `${url} does not advertise a WAC ACL at ${url}.acl (Link rel="acl": ${acls.join(", ") || "none"}); the requested access cannot be applied`,
    );
  }
}

/** A minimal valid body for a placeholder of this content type. */
function placeholderBody(contentType: string): string {
  if (/json/i.test(contentType)) return "{}";
  if (/rdf\+xml/i.test(contentType))
    return '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>';
  return "";
}

async function writeAcl(
  pod: MaterializedPod,
  resource: MaterializedResource,
  conditional: boolean | { ifMatch: string },
): Promise<void> {
  if (resource.aclBody === undefined) return;
  await put(
    pod.target,
    `${resource.outcome.url}.acl`,
    resource.aclBody,
    DEFAULT_CONTENT_TYPE,
    conditional,
  );
}

async function writeResource(
  pod: MaterializedPod,
  resource: MaterializedResource,
  mode: SeedMode,
): Promise<"created" | "skipped" | "replaced"> {
  if (resource.body === undefined)
    throw new Error(`resource ${resource.spec.path} has no materialized body`);
  if (resource.aclBody !== undefined) return writeProtected(pod, resource, resource.body, mode);
  const conditional = mode !== "replace";
  let outcome: "created" | "skipped" | "replaced" = mode === "replace" ? "replaced" : "created";
  try {
    await put(
      pod.target,
      resource.outcome.url,
      resource.body,
      resource.spec.contentType ?? DEFAULT_CONTENT_TYPE,
      conditional,
    );
  } catch (error) {
    if (mode === "ensure" && error instanceof HttpFailure && error.status === 412) {
      outcome = "skipped";
    } else {
      throw error;
    }
  }
  return outcome;
}

/**
 * Write a resource that carries an access spec so neither its new data nor its
 * old data is ever governed by grants broader than intended:
 *  1. create an empty placeholder (or find the existing resource);
 *  2. confirm the server's ACL location;
 *  3. write an owner-only ACL;
 *  4. write the data;
 *  5. only then write the final ACL with its grants.
 * A replacement therefore never exposes the superseded content to the new grants,
 * and a failed replacement leaves the owner-only ACL. If a step fails after this
 * run created the placeholder, the resource is removed and then its ACL (see
 * {@link removeCreated}), so a re-run starts again. `ensure` on an existing
 * resource leaves the data alone and reconciles the final ACL only when that
 * narrows access (see {@link assertNarrowing}); broadening needs `replace`. A container's
 * description is skipped when the server answers 409 to a PUT on an existing
 * container (CSS refuses it and ignores container bodies on creation).
 * A process that dies mid-way leaves the placeholder under the owner-only ACL;
 * `ensure` cannot tell it from real data, so re-run with `replace` after a crash.
 */
async function writeProtected(
  pod: MaterializedPod,
  resource: MaterializedResource,
  body: string,
  mode: SeedMode,
): Promise<"created" | "skipped" | "replaced"> {
  const url = resource.outcome.url;
  const aclUrl = `${url}.acl`;
  const contentType = resource.spec.contentType ?? DEFAULT_CONTENT_TYPE;
  let outcome: "created" | "skipped" | "replaced" = mode === "replace" ? "replaced" : "created";
  let createdPlaceholder = false;
  try {
    // Only a 201 proves this run created the resource, and so may remove it again.
    createdPlaceholder =
      (await put(pod.target, url, placeholderBody(contentType), contentType, true)) === 201;
  } catch (error) {
    // The resource exists: 412, or 409 for a container on CSS, which refuses any PUT
    // to an existing container before evaluating If-None-Match.
    const exists =
      error instanceof HttpFailure &&
      (error.status === 412 || (error.status === 409 && url.endsWith("/")));
    if (!exists || mode === "create") throw error;
    // ensure leaves its data alone; replace keeps the old data under its old ACL
    // until the owner-only ACL is in place.
    if (mode === "ensure") outcome = "skipped";
  }
  let aclAttempted = false;
  try {
    await assertAclLocation(pod.target, url);
    if (outcome === "skipped") {
      // ensure reconciles the ACL of content it did not write, so it may narrow
      // access but never broaden it: the existing data (perhaps the superseded
      // content of a failed replace) was never vetted for the new grants.
      const etag = await assertNarrowing(
        pod.target,
        resource,
        "ensure (re-run with replace to rewrite the content under the new grants)",
      );
      await writeAcl(pod, resource, etag === undefined ? false : { ifMatch: etag });
      return outcome;
    }
    // An existing container's acl:default reaches children this run did not
    // write, so replace may not broaden it either. Checked before the owner-only
    // ACL overwrites the current one.
    let ownerCondition: boolean | { ifMatch: string } = mode === "create";
    if (!createdPlaceholder && url.endsWith("/")) {
      const etag = await assertNarrowing(
        pod.target,
        resource,
        "replace of an existing container (its acl:default would reach children this run did not write)",
      );
      // Narrowed elsewhere since the check? Then the owner-only write fails (412).
      if (etag !== undefined) ownerCondition = { ifMatch: etag };
    }
    // In create mode a stale ACL fails the seed (If-None-Match) rather than being
    // overwritten. A PUT that errors may still have landed, so cleanup tries it,
    // unless the server refused it as a stale ACL this run did not write.
    aclAttempted = true;
    let ownerAclEtag: string | undefined;
    try {
      ownerAclEtag = (
        await putTagged(
          pod.target,
          aclUrl,
          resource.ownerAclBody as string,
          DEFAULT_CONTENT_TYPE,
          ownerCondition,
        )
      ).etag;
    } catch (error) {
      if (error instanceof HttpFailure && error.status === 412) aclAttempted = false;
      throw error;
    }
    try {
      await put(pod.target, url, body, contentType, false);
    } catch (error) {
      // CSS refuses any PUT to an existing container and ignores a container's body
      // even on creation, so there is no description to write.
      if (!(url.endsWith("/") && error instanceof HttpFailure && error.status === 409)) throw error;
    }
    // The grants go on only now that the data is in place (none to add for owner-only access).
    if (resource.aclBody !== resource.ownerAclBody) {
      // A 201 does not prove a container is new (a server may ignore If-None-Match,
      // and another writer could add a child before the owner-only ACL landed), and
      // its acl:default would reach every child. Grant only over an empty container.
      if (createdPlaceholder && url.endsWith("/")) await assertEmptyContainer(pod.target, url);
      // Only over the owner-only ACL this run wrote: a change since fails (412).
      // A server that returned no strong ETag for it gets an unconditional write.
      await writeAcl(pod, resource, ownerAclEtag === undefined ? false : { ifMatch: ownerAclEtag });
    }
    return outcome;
  } catch (error) {
    // A replacement that fails keeps its owner-only ACL over whichever data is there.
    if (createdPlaceholder) throw await removeCreated(pod.target, url, aclAttempted, error);
    throw error;
  }
}

function currentManifest(completed: readonly PodManifest[], current: PodManifest): SeedManifest {
  return { pods: [...completed, current] };
}

function failResource(
  message: string,
  completed: readonly PodManifest[],
  pod: MaterializedPod,
  resource: MaterializedResource | undefined,
  cause: unknown,
): never {
  if (resource !== undefined) resource.outcome.status = "failed";
  throw new SeedError(message, currentManifest(completed, pod.manifest), { cause });
}

async function processGroup(
  completed: readonly PodManifest[],
  pod: MaterializedPod,
  action: MaterializedAction,
  mode: SeedMode,
): Promise<void> {
  const group = action.group as GroupOutcome;
  if (mode !== "replace") {
    const documents = action.resources.flatMap((resource) => [
      { resource, path: resource.spec.path, url: resource.outcome.url },
      ...(resource.aclBody === undefined
        ? []
        : [
            {
              resource,
              path: `${resource.spec.path}.acl`,
              url: `${resource.outcome.url}.acl`,
            },
          ]),
    ]);
    let present: boolean[];
    try {
      present = await Promise.all(documents.map((document) => exists(pod.target, document.url)));
    } catch (cause) {
      failResource(
        `preflight for expander group ${group.id} failed`,
        completed,
        pod,
        undefined,
        cause,
      );
    }
    const existing = documents
      .filter((_, index) => present[index])
      .map((document) => document.path);
    const missing = documents
      .filter((_, index) => present[index] !== true)
      .map((document) => document.path);
    if (mode === "ensure" && existing.length === documents.length) {
      // As for a single resource, ensure never broadens access to content it did
      // not write; every member is checked before any ACL is written, so a
      // broadening is refused before any change. (A write that then fails, such as
      // a 412 from a concurrent edit, can leave earlier members narrowed.)
      const etags = new Map<MaterializedResource, string | undefined>();
      for (const resource of action.resources) {
        try {
          if (resource.aclBody !== undefined) {
            await assertAclLocation(pod.target, resource.outcome.url);
            etags.set(
              resource,
              await assertNarrowing(
                pod.target,
                resource,
                "ensure (re-run with replace to rewrite the content under the new grants)",
              ),
            );
          }
        } catch (cause) {
          failResource(
            `ACL convergence failed in expander group ${group.id} at ${resource.spec.path}`,
            completed,
            pod,
            resource,
            cause,
          );
        }
      }
      for (const resource of action.resources) {
        try {
          const etag = etags.get(resource);
          await writeAcl(pod, resource, etag === undefined ? false : { ifMatch: etag });
          resource.outcome.status = "skipped";
        } catch (cause) {
          failResource(
            `ACL convergence failed in expander group ${group.id} at ${resource.spec.path}`,
            completed,
            pod,
            resource,
            cause,
          );
        }
      }
      group.status = "skipped";
      return;
    }
    if (existing.length > 0) {
      for (const resource of action.resources) {
        if (
          documents.some(
            (document, index) => document.resource === resource && present[index] === true,
          )
        ) {
          resource.outcome.status = "failed";
        }
      }
      failResource(
        `${mode} preflight found an inconsistent expander group ${group.id}; existing members: ${existing.join(", ")}; missing members: ${missing.join(", ")}`,
        completed,
        pod,
        undefined,
        new Error("expander group preflight rejected existing state"),
      );
    }
  }

  for (const resource of action.resources) {
    try {
      resource.outcome.status = await writeResource(pod, resource, mode);
    } catch (cause) {
      failResource(
        `write failed in expander group ${group.id} at ${resource.spec.path}; repair with a replace re-run`,
        completed,
        pod,
        resource,
        cause,
      );
    }
  }
  group.status = "written";
}

async function processPod(
  completed: readonly PodManifest[],
  pod: MaterializedPod,
  mode: SeedMode,
): Promise<void> {
  for (const action of pod.actions) {
    if (action.group !== undefined) {
      await processGroup(completed, pod, action, mode);
      continue;
    }
    const resource = action.resources[0];
    if (resource === undefined) continue;
    try {
      resource.outcome.status = await writeResource(pod, resource, mode);
    } catch (cause) {
      failResource(`write failed at ${resource.spec.path}`, completed, pod, resource, cause);
    }
  }
}

/** Provision targets and seed every pod in layout order. */
export async function seedPods(options: SeedOptions): Promise<SeedManifest> {
  const mode = options.mode ?? "create";
  const materialized: MaterializedPod[] = [];
  for (const podSpec of options.layout.pods) {
    const target = await targetFor(podSpec, options.provisioner);
    const pod = await materializePod(
      target,
      podSpec,
      options,
      materialized.map((value) => value.manifest),
    );
    materialized.push(pod);
  }

  const completed: PodManifest[] = [];
  for (const pod of materialized) {
    await processPod(completed, pod, mode);
    completed.push(pod.manifest);
  }
  return { pods: completed };
}
