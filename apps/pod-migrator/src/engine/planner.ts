// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope, isWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import { Container, Group } from "@solid/object";
import { DataFactory } from "n3";
import { detectAccessSystem, readAccess } from "./access.js";
import {
  assertNotWider,
  effectiveMembers,
  effectivePolicy,
  emptyPolicy,
  ownerPolicy,
  scopePolicy,
  unionPolicies,
} from "./policy.js";
import { aclLink, links, parent, parse, requireOk } from "./rdf.js";
import { ResourceReadError } from "./resource-body.js";
import { type AcpDialect, PolicyTooComplex } from "./systems/acp.js";
import { assertSpecificAccess, targetAccessLinks } from "./target-access.js";
import { reportItem, type TranslationContext, translatePolicy } from "./translation.js";
import {
  type AccessDocument,
  type EffectivePolicy,
  type ExecutablePlan,
  MigrationAborted,
  type MigrationPlan,
  type OptionId,
  type PlannedResource,
  type PodSide,
  type Progress,
  type Resolutions,
} from "./types.js";
export interface ResourceState {
  resource: PlannedResource;
  sourceEffective: EffectivePolicy;
  sourceMembers: EffectivePolicy;
  sourceDocument?: AccessDocument;
  unreadable: boolean;
  exists: boolean;
  targetDocument?: AccessDocument;
  targetEffective: EffectivePolicy;
  targetEtag?: string;
  targetUnreadable: boolean;
}
export interface PlanState {
  sourceSystem: MigrationPlan["sourceSystem"];
  targetSystem: MigrationPlan["targetSystem"];
  source: PodSide;
  target: PodSide;
  resources: ResourceState[];
  groups: Map<string, string[]>;
  dialect: AcpDialect;
  rewriteIris: boolean;
  snapshot: string;
  targetDocuments: Map<string, AccessDocument | undefined>;
  materializeMembers: boolean;
}
export interface ExecutionState {
  state: PlanState;
  resources: {
    state: ResourceState;
    policy: EffectivePolicy;
    decision?: OptionId;
    skipped: boolean;
  }[];
}
const plans = new WeakMap<MigrationPlan, PlanState>();
export const executions = new WeakMap<ExecutablePlan, ExecutionState>();
function bound(side: PodSide): PodSide {
  const root = normalizePodBase(side.root);
  if (side.http.root !== root) throw new TypeError("Pod side and transport roots differ");
  if (side.publicHttp && side.publicHttp.root !== root)
    throw new TypeError("Pod side and public transport roots differ");
  return { ...side, root };
}
function isProfileDocument(webId: string, resource: string): boolean {
  const profile = new URL(webId);
  const target = new URL(resource);
  return (
    profile.origin === target.origin &&
    decodeURIComponent(profile.pathname) === decodeURIComponent(target.pathname)
  );
}
function decisionFor(
  plan: MigrationPlan,
  resolutions: Resolutions,
  url: string,
  kind: string,
): OptionId | undefined {
  const item = plan.report.find((item) => item.resourceUrl === url && item.kind === kind);
  return item && resolutions[item.id];
}
async function buildPlan(opts: {
  source: PodSide;
  target: PodSide;
  targetContainer?: string;
  rewriteIris?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}): Promise<MigrationPlan> {
  const source = bound(opts.source);
  const target = bound(opts.target);
  const destination = assertWithinPodScope(target.root, opts.targetContainer ?? target.root);
  if (!destination.endsWith("/")) throw new TypeError("Target container must end with a slash");
  if (isWithinPodScope(source.root, destination) || isWithinPodScope(target.root, source.root))
    throw new TypeError("Source and target pods must be disjoint");
  const report: MigrationPlan["report"] = [];
  const discovered: { resource: PlannedResource; acl?: string }[] = [];
  const auxiliaries = new Set<string>();
  const queue = [source.root];
  const seen = new Set<string>();
  while (queue.length) {
    opts.signal?.throwIfAborted();
    const url = queue.shift() as string;
    seen.add(url);
    if (seen.size > 10000) throw new PolicyTooComplex("Pod has more than 10000 resources");
    const head = requireOk(await source.http.head(url, { signal: opts.signal }), url);
    const acl = aclLink(head, url, source.root);
    for (const auxiliary of [...links(head, url, "acl"), ...links(head, url, "describedby")])
      auxiliaries.add(auxiliary);
    const resource: PlannedResource = {
      sourceUrl: url,
      targetUrl: assertWithinPodScope(target.root, destination + url.slice(source.root.length)),
      kind: url.endsWith("/") ? "container" : "resource",
    };
    const contentType = head.headers.get("content-type");
    if (contentType) resource.contentType = contentType;
    const length = head.headers.get("content-length");
    if (length !== null && Number.isSafeInteger(Number(length)) && Number(length) >= 0)
      resource.size = Number(length);
    discovered.push({ resource, acl });
    if (resource.kind === "container") {
      const dataset = await parse(
        requireOk(await source.http.get(url, { accept: "text/turtle", signal: opts.signal }), url),
        url,
        source.http,
        opts.signal,
      );
      for (const member of new Container(url, dataset, DataFactory).contains) {
        const child = assertWithinPodScope(source.root, member.id);
        if (parent(child, source.root) !== url)
          throw new TypeError("Container lists a non-child resource");
        if (
          /\.(acl|acr|meta)\/?$/i.test(decodeURIComponent(new URL(child).pathname)) ||
          auxiliaries.has(child)
        ) {
          report.push(
            reportItem(
              "metadata-skipped",
              child,
              "Auxiliary access or description metadata is translated separately and never copied as content.",
              ["acknowledge"],
            ),
          );
        } else queue.push(child);
      }
    }
    opts.onProgress?.({
      phase: "crawl",
      done: seen.size,
      total: seen.size + queue.length,
      current: url,
    });
  }
  const isAuxiliary = (url: string) =>
    [...auxiliaries].some(
      (auxiliary) => url === auxiliary || (auxiliary.endsWith("/") && url.startsWith(auxiliary)),
    );
  for (const item of discovered.filter((item) => isAuxiliary(item.resource.sourceUrl)))
    report.push(
      reportItem(
        "metadata-skipped",
        item.resource.sourceUrl,
        "Advertised auxiliary metadata is translated separately and never copied as content.",
        ["acknowledge"],
      ),
    );
  const resources = discovered.filter((item) => !isAuxiliary(item.resource.sourceUrl));
  const sourceSystem = await detectAccessSystem(source, opts.signal);
  const detectedTargetSystem = await detectAccessSystem(target, opts.signal);
  // ACP dialect changes Control enforcement; RDF vocabulary cannot identify the server.
  const targetSystem =
    detectedTargetSystem === "acp" &&
    target.implementation !== "css" &&
    target.implementation !== "ess"
      ? "unknown"
      : detectedTargetSystem;
  if (sourceSystem === "unknown" || targetSystem === "unknown")
    report.push(
      reportItem(
        "acl-system-unknown",
        source.root,
        targetSystem === "unknown"
          ? "The target access system or ACP implementation cannot be established independently of access RDF; execution must stop until it is identifiable."
          : "The source access system is unknown. All copied resources will remain owner-only.",
        targetSystem === "unknown" ? ["abort"] : ["owner-only", "abort"],
      ),
    );
  const sourceDocs = new Map<string, AccessDocument | undefined>();
  const materializeMembers =
    targetSystem === "acp" && (sourceSystem === "wac" || source.implementation === "ess");
  const sourceErrors = new Set<string>();
  const sourceIntegrityErrors = new Set<string>();
  for (const [index, item] of resources.entries()) {
    if (sourceSystem !== "unknown")
      try {
        const doc = await readAccess(
          source,
          item.resource.sourceUrl,
          sourceSystem,
          opts.signal,
          item.acl,
        );
        sourceDocs.set(item.resource.sourceUrl, doc);
        for (const inactive of doc?.inactiveGrants ?? [])
          report.push(
            reportItem(
              "condition-unsupported",
              item.resource.sourceUrl,
              inactive.reason,
              ["skip", "abort"],
              `inactive:${inactive.node}`,
              doc?.turtle,
            ),
          );
      } catch (error) {
        opts.signal?.throwIfAborted();
        sourceErrors.add(item.resource.sourceUrl);
        if (error instanceof ResourceReadError) sourceIntegrityErrors.add(item.resource.sourceUrl);
        report.push(
          reportItem(
            error instanceof PolicyTooComplex ? "too-complex" : "acl-unreadable",
            item.resource.sourceUrl,
            // readAccess normalizes non-Error transport rejections at its boundary.
            (error as Error).message,
            error instanceof ResourceReadError
              ? ["skip", "abort"]
              : ["owner-only", "skip", "abort"],
          ),
        );
      }
    opts.onProgress?.({
      phase: "read-access",
      done: index + 1,
      total: resources.length,
      current: item.resource.sourceUrl,
    });
  }
  const targetHeads = new Map<string, Response>();
  const targetDocs = new Map<string, AccessDocument | undefined>();
  const targetErrors = new Set<string>();
  for (const item of resources) {
    let url: string | undefined = item.resource.targetUrl;
    while (url !== undefined) {
      if (!targetHeads.has(url)) {
        const head = await target.http.head(url, { signal: opts.signal });
        if (head.status !== 404) requireOk(head, url);
        targetHeads.set(url, head);
        if (targetSystem !== "unknown")
          try {
            targetDocs.set(
              url,
              await readAccess(target, url, targetSystem, opts.signal, undefined, true),
            );
          } catch {
            opts.signal?.throwIfAborted();
            targetErrors.add(url);
          }
      }
      url = parent(url, target.root);
    }
  }
  if (
    destination !== target.root &&
    !(targetHeads.get(parent(destination, target.root) as string) as Response).ok
  )
    throw new TypeError("Target container parent must already exist");
  const groups = new Map<string, string[]>();
  for (const doc of sourceDocs.values())
    for (const subject of doc?.policy.grants.flatMap((rule) => rule.who.flat()) ?? [])
      if (subject.kind === "group" && !groups.has(subject.group)) {
        const documentUrl = subject.group.split("#")[0] as string;
        if (!isWithinPodScope(source.root, documentUrl) || !source.publicHttp) continue;
        try {
          const dataset = await parse(
            requireOk(
              await source.publicHttp.get(documentUrl, {
                accept: "text/turtle",
                signal: opts.signal,
              }),
            ),
            documentUrl,
            source.publicHttp,
            opts.signal,
            true,
          );
          groups.set(subject.group, [...new Group(subject.group, dataset, DataFactory).hasMember]);
        } catch {
          opts.signal?.throwIfAborted();
        }
      }
  const targetInventory = await targetAccessLinks(target, opts.signal);
  for (const [url, head] of targetHeads) {
    const acl = aclLink(head, url, target.root);
    if (acl) targetInventory.set(url, acl);
  }
  const protectedAuxiliaries = new Set([
    ...targetInventory.values(),
    ...[...targetHeads].flatMap(([url, response]) => [
      ...links(response, url, "acl"),
      ...links(response, url, "describedby"),
    ]),
  ]);
  const states: ResourceState[] = [];
  const hasError = (url: string, root: string, errors: Set<string>) => {
    let current: string | undefined = url;
    while (current !== undefined) {
      if (errors.has(current)) return true;
      current = parent(current, root);
    }
    return false;
  };
  for (const { resource } of resources) {
    const unreadable = hasError(resource.sourceUrl, source.root, sourceErrors);
    if (unreadable && !sourceErrors.has(resource.sourceUrl))
      report.push(
        reportItem(
          "acl-unreadable",
          resource.sourceUrl,
          "An ancestor's access controls could not be read; inheritance cannot be proven safe.",
          hasError(resource.sourceUrl, source.root, sourceIntegrityErrors)
            ? ["skip", "abort"]
            : ["owner-only", "skip", "abort"],
        ),
      );
    const sourceEffective = unreadable
      ? emptyPolicy()
      : effectivePolicy(
          sourceSystem,
          resource.sourceUrl,
          source.root,
          sourceDocs,
          source.implementation,
        );
    const sourceMembers =
      unreadable || resource.kind === "resource"
        ? emptyPolicy()
        : effectiveMembers(sourceSystem, resource.sourceUrl, source.root, sourceDocs);
    const targetEffective = effectivePolicy(
      targetSystem,
      resource.targetUrl,
      target.root,
      targetDocs,
    );
    const exists = (targetHeads.get(resource.targetUrl) as Response).ok;
    let targetUnreadable = hasError(resource.targetUrl, target.root, targetErrors);
    const targetAcl = targetInventory.get(resource.targetUrl);
    if (targetAcl) {
      try {
        await assertSpecificAccess(
          resource.targetUrl,
          targetAcl,
          targetInventory,
          targetDocs.get(resource.targetUrl),
        );
      } catch {
        targetUnreadable = true;
      }
    }
    if (
      resource.targetUrl === target.root ||
      protectedAuxiliaries.has(resource.targetUrl) ||
      isProfileDocument(target.ownerWebId, resource.targetUrl)
    )
      report.push(
        reportItem(
          "protected-target",
          resource.sourceUrl,
          "The target root and target WebID document are protected. Root merging preserves existing member controls and requires a safety proof.",
          resource.targetUrl === target.root && !targetUnreadable
            ? ["skip", "merge", "abort"]
            : ["skip", "abort"],
        ),
      );
    else if (exists)
      report.push(
        reportItem(
          "target-exists",
          resource.sourceUrl,
          "This target path already exists. Overwrite retains its current permissions and requires a safety proof and ETag.",
          resource.kind === "resource" && !targetUnreadable
            ? ["skip", "overwrite", "abort"]
            : ["skip", "abort"],
        ),
      );
    if (targetUnreadable)
      report.push(
        reportItem(
          "acl-unreadable",
          resource.sourceUrl,
          "Target access controls are unreadable or shared with another resource. This path cannot be written safely.",
          ["skip", "abort"],
          "target",
        ),
      );
    const sourceDocument = sourceDocs.get(resource.sourceUrl);
    const context: TranslationContext = {
      resourceUrl: resource.sourceUrl,
      sourceOwner: source.ownerWebId,
      targetOwner: target.ownerWebId,
      groups,
      targetImplementation: target.implementation,
      sourceRuleTurtle: sourceDocument?.turtle,
      sourceRules: new Map(
        [...sourceDocs.values()]
          .filter((doc): doc is AccessDocument => !!doc)
          .map((doc) => [doc.url, doc.turtle]),
      ),
    };
    if (!unreadable && sourceSystem !== "unknown" && targetSystem !== "unknown") {
      report.push(...translatePolicy(sourceEffective, targetSystem, context).report);
      if (resource.kind === "container" && !materializeMembers)
        report.push(
          ...translatePolicy(sourceMembers, targetSystem, { ...context, scopeId: "members:" })
            .report,
        );
    }
    if (materializeMembers && resource.kind === "container") {
      const memberPolicy = sourceDocument && scopePolicy(sourceDocument.policy, "members");
      if (memberPolicy?.grants.length)
        report.push(
          reportItem(
            "inheritance-narrowed",
            resource.sourceUrl,
            "Target ACP inheritance is additive. Use explicit per-resource controls for all existing descendants to preserve WAC replacement or the strictest ESS default-only grant reading; new descendants receive owner access only.",
            ["per-resource", "abort"],
            "",
            sourceDocument?.turtle,
          ),
        );
    }
    states.push({
      resource,
      sourceEffective,
      sourceMembers,
      sourceDocument,
      unreadable,
      exists,
      targetDocument: targetDocs.get(resource.targetUrl),
      targetEffective,
      targetEtag:
        (targetHeads.get(resource.targetUrl) as Response).headers.get("etag") ?? undefined,
      targetUnreadable,
    });
  }
  const dialect = target.implementation === "ess" ? "ess" : "css";
  const plan: MigrationPlan = {
    sourceSystem,
    targetSystem,
    resources: resources.map((item) => item.resource),
    report: [...new Map(report.map((item) => [item.id, item])).values()],
    stats: {
      containers: resources.filter((item) => item.resource.kind === "container").length,
      resources: resources.filter((item) => item.resource.kind === "resource").length,
      bytes: resources
        .filter((item) => item.resource.kind === "resource")
        .reduce((sum, item) => sum + (item.resource.size ?? 0), 0),
      aclDocuments: [...sourceDocs.values()].filter(Boolean).length,
    },
  };
  plans.set(plan, {
    sourceSystem,
    targetSystem,
    source,
    target,
    resources: states,
    groups,
    dialect,
    rewriteIris: opts.rewriteIris ?? false,
    snapshot: JSON.stringify(plan),
    targetDocuments: targetDocs,
    materializeMembers,
  });
  opts.onProgress?.({ phase: "plan", done: resources.length, total: resources.length });
  return plan;
}
export async function planMigration(opts: Parameters<typeof buildPlan>[0]): Promise<MigrationPlan> {
  try {
    return await buildPlan(opts);
  } catch (error) {
    opts.signal?.throwIfAborted();
    if (!(error instanceof ResourceReadError)) throw error;
    return {
      sourceSystem: "unknown",
      targetSystem: "unknown",
      resources: [],
      report: [reportItem("resource-unreadable", error.resourceUrl, error.message, ["abort"])],
      stats: { containers: 0, resources: 0, bytes: 0, aclDocuments: 0 },
    };
  }
}
export function finalizePlan(plan: MigrationPlan, resolutions: Resolutions): ExecutablePlan {
  if (Object.values(resolutions).includes("abort"))
    throw new MigrationAborted("Migration aborted during review");
  const state = plans.get(plan);
  if (!state || JSON.stringify(plan) !== state.snapshot)
    throw new TypeError("Plan is not an unmodified engine plan");
  for (const item of plan.report) {
    const resolution = resolutions[item.id];
    if (
      (item.severity === "needs-decision" && !resolution) ||
      (resolution && !item.options.some((option) => option.id === resolution))
    )
      throw new TypeError(`Resolve report item: ${item.id}`);
  }
  const unknown = plan.sourceSystem === "unknown";
  const selected = state.resources.map((resourceState) => {
    const { resource } = resourceState;
    const related = plan.report.filter((item) => item.resourceUrl === resource.sourceUrl);
    const protectedDecision = decisionFor(
      plan,
      resolutions,
      resource.sourceUrl,
      "protected-target",
    );
    const existingDecision = decisionFor(plan, resolutions, resource.sourceUrl, "target-exists");
    const skip =
      state.resources.some(
        (ancestor) =>
          ancestor.resource.kind === "container" &&
          ancestor.resource.targetUrl !== state.target.root &&
          ancestor !== resourceState &&
          resource.targetUrl.startsWith(ancestor.resource.targetUrl) &&
          plan.report.some(
            (item) =>
              item.resourceUrl === ancestor.resource.sourceUrl &&
              ["acl-unreadable", "too-complex", "protected-target", "target-exists"].includes(
                item.kind,
              ) &&
              resolutions[item.id] === "skip",
          ),
      ) ||
      related.some(
        (item) =>
          ["acl-unreadable", "too-complex", "protected-target", "target-exists"].includes(
            item.kind,
          ) && resolutions[item.id] === "skip",
      );
    const translationContext: TranslationContext = {
      resourceUrl: resource.sourceUrl,
      sourceOwner: state.source.ownerWebId,
      targetOwner: state.target.ownerWebId,
      groups: state.groups,
      targetImplementation: state.target.implementation,
    };
    const translated = translatePolicy(
      resourceState.sourceEffective,
      plan.targetSystem,
      translationContext,
      resolutions,
    ).policy;
    const members =
      resource.kind === "container" && !state.materializeMembers
        ? translatePolicy(
            resourceState.sourceMembers,
            plan.targetSystem,
            { ...translationContext, scopeId: "members:" },
            resolutions,
          ).policy
        : emptyPolicy();
    const asMembers: EffectivePolicy = {
      grants: members.grants.map((rule) => ({ ...rule, appliesTo: "members" })),
      denials: members.denials.map((rule) => ({ ...rule, appliesTo: "members" })),
    };
    const policy =
      unknown || resourceState.unreadable
        ? ownerPolicy(state.target.ownerWebId, resource.kind === "container")
        : unionPolicies(
            translated,
            asMembers,
            ownerPolicy(state.target.ownerWebId, resource.kind === "container"),
          );
    if (!skip) {
      if (protectedDecision === "merge" && !resourceState.targetDocument?.etag)
        throw new TypeError("Root merge requires an access-document ETag");
      if (existingDecision === "overwrite" && !resourceState.targetEtag)
        throw new TypeError("Overwrite requires a content ETag");
    }
    return {
      state: resourceState,
      policy,
      skipped: skip,
      decision: protectedDecision ?? existingDecision,
    };
  });
  proveExecutionPhases(state, selected, state.targetDocuments);
  const executable: ExecutablePlan = Object.freeze({
    plan: structuredClone(plan),
    resolutions: Object.freeze({ ...resolutions }),
  });
  executions.set(executable, { state, resources: structuredClone(selected) });
  return executable;
}

export function proveExecutionPhases(
  state: PlanState,
  selected: ExecutionState["resources"],
  targetDocuments: ReadonlyMap<string, AccessDocument | undefined>,
): void {
  // Replay the executor's access-document mutations. Replacing a document removes
  // ALL its old grants, denials and exclusions from every descendant's proof.
  const active = selected.filter((entry) => !entry.skipped);
  const documents = new Map<string, Pick<AccessDocument, "policy"> | undefined>(targetDocuments);
  const present = new Set(active.filter((entry) => entry.state.exists));
  const context = {
    sourceOwner: state.source.ownerWebId,
    targetOwner: state.target.ownerWebId,
    groups: state.groups,
  };
  const prove = () => {
    for (const entry of present) {
      const actual = effectivePolicy(
        state.targetSystem,
        entry.state.resource.targetUrl,
        state.target.root,
        documents,
      );
      assertNotWider(entry.state.sourceEffective, actual, context);
      assertNotWider(actual, ownerPolicy(state.target.ownerWebId));
    }
  };
  prove();
  const containers = active
    .filter((entry) => entry.state.resource.kind === "container")
    .sort((a, b) => a.state.resource.targetUrl.length - b.state.resource.targetUrl.length);
  const files = active.filter((entry) => entry.state.resource.kind === "resource");
  for (const entry of [...containers, ...files]) {
    if (entry.state.exists) continue;
    present.add(entry);
    prove(); // Empty creation, including any pre-existing orphan access document.
    documents.set(entry.state.resource.targetUrl, {
      policy: ownerPolicy(state.target.ownerWebId, entry.state.resource.kind === "container"),
    });
    prove(); // Lock, before any descendant creation or content copy.
  }
  for (const entry of active
    .filter((entry) => entry.decision !== "overwrite")
    .sort((a, b) => b.state.resource.targetUrl.length - a.state.resource.targetUrl.length)) {
    documents.set(entry.state.resource.targetUrl, {
      policy:
        entry.decision === "merge"
          ? unionPolicies(
              (entry.state.targetDocument as AccessDocument).policy,
              scopePolicy(entry.policy, "resource"),
            )
          : entry.policy,
    });
    prove(); // Grant bottom up; validate all resources, not only the changed node.
  }
}
