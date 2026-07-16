// AUTHORED-BY GPT-5.6 Sol via codex

import type { GeneratedInstance } from "@jeswr/synthetic-rdf";
import type { Quad } from "@rdfjs/types";
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

function resolveResource(baseUrl: string, path: string): string {
  const base = assertHttpIri(baseUrl, "SeedTarget.baseUrl", { requireOrigin: true });
  if (!path.startsWith("/") || path.endsWith(".acl")) {
    throw new Error(`resource path must start with "/" and must not target .acl: ${path}`);
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

async function responseDetail(response: Response): Promise<string> {
  return (await response.text().catch(() => "")).trim();
}

async function exists(target: SeedTarget, url: string): Promise<boolean> {
  let response = await target.authFetch(url, { method: "HEAD" });
  if (response.status === 405 || response.status === 501) {
    response = await target.authFetch(url, { method: "GET" });
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

async function put(
  target: SeedTarget,
  url: string,
  body: string,
  contentType: string,
  conditional: boolean,
): Promise<void> {
  const headers = new Headers({ "content-type": contentType });
  if (conditional) headers.set("if-none-match", "*");
  const response = await target.authFetch(url, { method: "PUT", headers, body });
  if (!response.ok)
    throw new HttpFailure("PUT", url, response.status, await responseDetail(response));
  await response.body?.cancel();
}

async function writeResource(
  pod: MaterializedPod,
  resource: MaterializedResource,
  mode: SeedMode,
): Promise<"created" | "skipped" | "replaced"> {
  if (resource.body === undefined)
    throw new Error(`resource ${resource.spec.path} has no materialized body`);
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
  if (resource.aclBody !== undefined) {
    try {
      await put(
        pod.target,
        `${resource.outcome.url}.acl`,
        resource.aclBody,
        DEFAULT_CONTENT_TYPE,
        conditional,
      );
    } catch (error) {
      if (!(mode === "ensure" && error instanceof HttpFailure && error.status === 412)) {
        throw error;
      }
    }
  }
  return outcome;
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
      for (const resource of action.resources) resource.outcome.status = "skipped";
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
