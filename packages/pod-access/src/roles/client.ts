// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Conditional apply, inherited ACL copying and lockout guard adapted from Drive
// sharing/apply.ts (Codex), branch claude/project-thread-okz5l7.
import type { Term } from "@rdfjs/types";
import { Store } from "n3";
import { serialize } from "../rdf.js";
import type { Mode } from "../types.js";
import { roleError } from "./errors.js";
import { load, request, requireOk, type Snapshot } from "./http.js";
import { modesToRole, rolesToModes } from "./mapping.js";
import {
  agentKey,
  appendAcp,
  detachAcp,
  MATERIALIZED_FROM,
  materialize,
  properties,
  pruneAcp,
  readPolicy,
  removeAcpAgent,
  replaceWac,
  subjectAgent,
} from "./rdf.js";
import type {
  AgentRef,
  GrantMutationOptions,
  GrantSnapshot,
  Role,
  RoleGrant,
  RolesOptions,
  ScopedGrantSelection,
  ScopedGrantSnapshot,
  SetGrantsOptions,
  SetGrantsResult,
} from "./types.js";

interface Row {
  agent: AgentRef;
  modes: Set<Mode>;
}
function rows(
  snapshot: Snapshot,
  documents = snapshot.documents,
  members = false,
  excludeOwnAcrManagement = false,
): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const document of documents)
    for (const grant of document.policy.grants) {
      if (!grant.modes.size || (excludeOwnAcrManagement && grant.ownAcrManagement)) continue;
      const scope = !members && document.resource === snapshot.resource ? "resource" : "members";
      if (grant.appliesTo !== scope && grant.appliesTo !== "both") continue;
      if (grant.except.length || grant.who.some((clause) => clause.length !== 1))
        throw roleError(
          "unsupported",
          document.url,
          "Conditional grants need a richer policy model",
        );
      for (const clause of grant.who) {
        const agent = subjectAgent(clause[0] as NonNullable<(typeof clause)[0]>);
        const key = agentKey(agent);
        const row = result.get(key) ?? { agent, modes: new Set<Mode>() };
        for (const mode of grant.modes) row.modes.add(mode);
        result.set(key, row);
      }
    }
  return result;
}
function role(row: Row, model: Snapshot["model"], options: RolesOptions, comments?: Row) {
  const separateAcr = model === "acp" && options.implementation === "ess";
  return modesToRole(
    {
      resource: [...row.modes].filter((m) => !separateAcr || m !== "control"),
      comments: [...(comments?.modes ?? [])],
      acr: separateAcr && row.modes.has("control") ? ["read", "write"] : [],
    },
    options.kind ?? "resource",
    { ...options, model },
  );
}
function project(snapshot: Snapshot, options: RolesOptions, comments?: Snapshot): RoleGrant[] {
  requireFolderScope(snapshot, options);
  const commentRows = comments ? rows(comments) : new Map<string, Row>();
  const effective = rows(snapshot);
  return snapshot.documents.flatMap((document) =>
    [...rows(snapshot, [document])].flatMap(([key, row]) => {
      // ACP controls compose across documents before a role can be established.
      // Every contributing source remains visible, including Write-only sources.
      const projected = role(
        effective.get(key) as Row,
        snapshot.model,
        options,
        commentRows.get(key),
      );
      if (projected === undefined) return [];
      // A commenter depends on the comments permission as well as resource Read.
      // Keep the governing ancestor visible even when Read is explicit.
      const commentOrigins =
        projected === "commenter" && document.resource === snapshot.resource && comments
          ? comments.documents
              .filter(
                (doc) =>
                  doc.resource !== comments.resource &&
                  rows(comments, [doc]).get(key)?.modes.has("append"),
              )
              .map((doc) => doc.url)
          : [];
      return (commentOrigins.length ? commentOrigins : [document.url]).map((source) => ({
        agent: row.agent,
        role: projected,
        inherited: document.resource !== snapshot.resource || source !== document.url,
        source,
      }));
    }),
  );
}
/** Read explicit and governing inherited roles. Partial/odd grants are never promoted. */
export async function grantsWithRoles(url: string, options: RolesOptions): Promise<RoleGrant[]> {
  return (await readGrants(url, options)).grants;
}
/** Internal move snapshot: project own policy independently, refusing lossy role round trips. */
export async function moveGrants(url: string, options: RolesOptions) {
  const snapshot = await load(url, options);
  const own = { ...snapshot, documents: snapshot.own ? [snapshot.own] : [] };
  const grants = project(own, options);
  for (const row of rows(own).values()) {
    const projected = grants.find((g) => agentKey(g.agent) === agentKey(row.agent));
    const mapped =
      projected &&
      rolesToModes(projected.role, options.kind ?? "resource", {
        ...options,
        model: snapshot.model,
      });
    const modes = new Set(
      mapped ? [...mapped.resource, ...(mapped.acr.length ? ["control" as const] : [])] : [],
    );
    const original = new Set(row.modes);
    if (original.has("write")) original.add("append");
    if (!sameModes(original, modes))
      throw roleError("unsupported", url, "Own permissions cannot round-trip through roles");
  }
  return {
    grants,
    ownUrl: snapshot.ownUrl,
    ownEtag: snapshot.own ? snapshot.own.etag : undefined,
    resourceEtag: snapshot.resourceEtag,
  };
}
/** Internal move preflight: establish direct caller Control, including ESS ACR management. */
export async function moveDestination(url: string, options: SetGrantsOptions) {
  const snapshot = await load(url, options);
  const me = agentKey({ type: "webid", id: options.webId });
  if (!rows(snapshot).get(me)?.modes.has("control"))
    throw roleError("owner-lockout", url, "Destination requires caller manager/Control access");
  return snapshot;
}
/** Internal read-only full-set preflight for a not-yet-created child; no endpoint is guessed. */
export async function planMoveGrants(
  url: string,
  parent: string,
  grants: RoleGrant[],
  options: SetGrantsOptions,
  own = true,
): Promise<void> {
  for (const grant of grants) validateMetadata(grant);
  const destination = await load(parent, options);
  const me = agentKey({ type: "webid", id: options.webId });
  const inheritedControl = rows(destination, destination.documents, true)
    .get(me)
    ?.modes.has("control");
  const ownControl = grants.some(
    (grant) => agentKey(grant.agent) === me && grant.role === "manager",
  );
  if (!(ownControl || ((!own || destination.model === "acp") && inheritedControl)))
    throw roleError("owner-lockout", url, "Moved item must retain caller manager/Control access");
  if (!own) return;
  await prepare(url, grants, options, {
    ...destination,
    resource: url,
    own: undefined,
    // This advertised endpoint is used only to validate the generated policy, never persisted.
    ownUrl: destination.ownUrl,
  });
}
function validators(snapshot: Snapshot) {
  return [
    snapshot.resource,
    snapshot.model,
    snapshot.ownUrl,
    snapshot.own ? [snapshot.own.etag] : "absent",
    snapshot.documents.map((doc) => [doc.resource, doc.url, doc.etag]),
  ];
}
function version(snapshot: Snapshot, options: RolesOptions, comments?: Snapshot) {
  return JSON.stringify([
    options.kind ?? "resource",
    options.implementation ?? "css",
    validators(snapshot),
    comments ? validators(comments) : null,
  ]) as GrantSnapshot["version"];
}
/** Read roles and an opaque serialisable token covering discovery, absence and source ETags. */
export async function readGrants(url: string, options: RolesOptions): Promise<GrantSnapshot> {
  const snapshot = await load(url, options);
  const comments = options.commentsContainer
    ? await load(options.commentsContainer, options)
    : undefined;
  return {
    url,
    grants: project(snapshot, options, comments),
    version: version(snapshot, options, comments),
  };
}
function sameModes(a: Set<Mode>, b: Set<Mode>): boolean {
  return a.size === b.size && [...a].every((mode) => b.has(mode));
}
function folderScope(snapshot: Snapshot, options: RolesOptions): boolean {
  return options.kind === "folder" && snapshot.resource.endsWith("/");
}
/** A folder role must describe the same permissions on the folder and its members. */
function requireFolderScope(snapshot: Snapshot, options: RolesOptions): void {
  if (!folderScope(snapshot, options) || !snapshot.own) return;
  // Exempt only grants placed as own-ACR management, before merging modes.
  // ESS member-ACR management must remain visible as an unrepresentable scope difference.
  const direct = rows(snapshot, [snapshot.own], false, true);
  const members = rows(snapshot, [snapshot.own], true, true);
  for (const key of new Set([...direct.keys(), ...members.keys()]))
    if (!sameModes(direct.get(key)?.modes ?? new Set(), members.get(key)?.modes ?? new Set()))
      throw roleError(
        "partial-scope",
        snapshot.resource,
        "Folder permissions differ between the folder and its members; use a scope-aware access editor",
      );
}
interface Write {
  resource: string;
  url: string;
  etag: string | null;
  body: string;
  snapshot: Snapshot;
}
function editableRows(snapshot: Snapshot): Map<string, Row> {
  return rows(
    snapshot,
    snapshot.own ? [snapshot.own] : snapshot.model === "wac" ? snapshot.documents : [],
  );
}
async function plan(
  snapshot: Snapshot,
  desired: Map<string, Row>,
  options: GrantMutationOptions & Pick<SetGrantsOptions, "ownOnly">,
  agent?: AgentRef,
): Promise<Write | undefined> {
  const before = options.ownOnly && !snapshot.own ? new Map<string, Row>() : editableRows(snapshot);
  const keys = new Set([...before.keys(), ...desired.keys()]);
  const changes = [...keys].filter(
    (key) => !sameModes(before.get(key)?.modes ?? new Set(), desired.get(key)?.modes ?? new Set()),
  );
  // Moves must also preserve an existing empty own ACR. An empty ACP selection still
  // inherits controls; WAC's empty selection is refused by the lockout check below.
  if (!changes.length && !(options.ownOnly && !snapshot.own)) return undefined;
  const me = agentKey({ type: "webid", id: options.webId });
  // Require direct, independently established management; public/group/client access
  // must not be the only safeguard against the caller locking themselves out.
  const inherited =
    snapshot.model === "acp"
      ? rows(
          snapshot,
          snapshot.documents.filter((d) => d !== snapshot.own),
        )
      : new Map<string, Row>();
  if (!(desired.get(me)?.modes.has("control") || inherited.get(me)?.modes.has("control")))
    throw roleError(
      "owner-lockout",
      snapshot.resource,
      "Cannot remove your own manager/Control access",
    );
  const validEtag = (etag: string | null): boolean =>
    etag !== null && /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag);
  if (snapshot.own && !validEtag(snapshot.own.etag))
    throw roleError(
      "precondition-required",
      snapshot.ownUrl,
      "An ETag is required for replacement",
    );
  for (const document of snapshot.documents)
    if (!validEtag(document.etag))
      throw roleError(
        "precondition-required",
        document.url,
        "A source ETag is required to change sharing",
      );
  const source = snapshot.documents[0];
  const dataset = snapshot.own
    ? new Store([...snapshot.own.dataset])
    : snapshot.model === "wac" && source && !options.ownOnly
      ? materialize(source.dataset, source.resource, snapshot.resource, source.url)
      : new Store();
  if (snapshot.model === "wac") {
    for (const key of changes) {
      const row = desired.get(key) ?? (before.get(key) as Row);
      replaceWac(
        dataset,
        snapshot.resource,
        row.agent,
        [...(desired.get(key)?.modes ?? [])],
        folderScope(snapshot, options),
      );
    }
  } else {
    const selected = agent
      ? [agent]
      : folderScope(snapshot, options)
        ? changes.map((key) => (desired.get(key) ?? (before.get(key) as Row)).agent)
        : undefined;
    if (selected)
      for (const principal of selected)
        removeAcpAgent(
          dataset,
          snapshot.resource,
          snapshot.ownUrl,
          principal,
          options.implementation ?? "css",
          folderScope(snapshot, options),
        );
    else detachAcp(dataset, snapshot.resource, snapshot.ownUrl, options.implementation ?? "css");
    appendAcp(
      dataset,
      snapshot.resource,
      snapshot.ownUrl,
      selected
        ? [...desired.values()].filter((row) =>
            selected.some((principal) => agentKey(row.agent) === agentKey(principal)),
          )
        : desired.values(),
      options.implementation ?? "css",
      folderScope(snapshot, options),
    );
  }
  // Re-read generated RDF through the same strict role policy boundary before persistence.
  const emitted = readPolicy(
    dataset,
    snapshot.resource,
    snapshot.ownUrl,
    snapshot.model,
    options.implementation ?? "css",
  );
  const after = rows({
    ...snapshot,
    documents: [
      {
        url: snapshot.ownUrl,
        resource: snapshot.resource,
        model: snapshot.model,
        dataset,
        policy: emitted,
        etag: null,
      },
    ],
  });
  for (const key of new Set([...after.keys(), ...desired.keys()]))
    if (!sameModes(after.get(key)?.modes ?? new Set(), desired.get(key)?.modes ?? new Set()))
      throw roleError("invalid-response", snapshot.ownUrl, "Serialized roles differ from the plan");
  return {
    resource: snapshot.resource,
    url: snapshot.ownUrl,
    etag: snapshot.own?.etag ?? null,
    body: await serialize(dataset),
    snapshot,
  };
}
async function prepare(
  url: string,
  grants: RoleGrant[],
  options: SetGrantsOptions,
  baseline?: Snapshot,
): Promise<Write[]> {
  const snapshot = baseline ?? (await load(url, options));
  const comments = options.commentsContainer
    ? await load(options.commentsContainer, options)
    : undefined;
  if (options.expected !== undefined) {
    const expected = options.expected;
    const token =
      typeof expected.version === "string" && expected.url === url
        ? expected.version
        : Object.hasOwn(expected, url)
          ? expected[url as keyof typeof expected]
          : undefined;
    // Only plan from raw RDF when it is the very same state the caller read.
    // This preserves richer untouched RDF while diffing against that baseline.
    if (token !== version(snapshot, options, comments))
      throw roleError("conflict", url, "Grant snapshot is stale or does not cover this URL");
  }
  const current =
    options.ownOnly && !snapshot.own ? new Map<string, Row>() : editableRows(snapshot);
  const projected = project(snapshot, options, comments);
  const inherited = projected.filter((g) => g.inherited);
  const explicit = new Set(grants.filter((g) => !g.inherited).map((g) => agentKey(g.agent)));
  const desired = new Map<string, Row>();
  if (snapshot.model === "wac" && !options.ownOnly) {
    const own = snapshot.own;
    const retained = own
      ? {
          ...own,
          policy: {
            grants: own.policy.grants.filter((grant) => {
              const term = [...own.dataset].find(
                (q) => q.subject.value === grant.source.node,
              )?.subject;
              return (
                term !== undefined &&
                properties(term, own.dataset).iris(MATERIALIZED_FROM).length > 0
              );
            }),
            denials: [],
          },
        }
      : undefined;
    const copies = rows(snapshot, retained ? [retained] : snapshot.documents);
    for (const [key, row] of copies) desired.set(key, row);
    // A caller may reapply the exact selection captured before materialization.
    // Accept its inherited rows only while the copied policy and source still match.
    if (retained) {
      const origins = new Set<string>();
      for (const grant of retained.policy.grants) {
        const term = [...retained.dataset].find(
          (q) => q.subject.value === grant.source.node,
        )?.subject;
        for (const origin of properties(term as Term, retained.dataset).iris(MATERIALIZED_FROM))
          origins.add(origin);
      }
      for (const origin of origins)
        for (const g of project({ ...snapshot, documents: [retained] }, options, comments))
          inherited.push({ ...g, inherited: true, source: origin });
    }
  }
  for (const grant of grants) {
    if (grant.inherited) {
      if (
        !inherited.some(
          (g) =>
            agentKey(g.agent) === agentKey(grant.agent) &&
            g.role === grant.role &&
            g.source === grant.source,
        )
      )
        throw roleError(
          "inherited-grant",
          url,
          "Inherited grants must be changed at their governing document",
        );
      const retained = current.get(agentKey(grant.agent));
      // Inherited rows validate provenance; they never override an explicit edit.
      if (retained && !explicit.has(agentKey(grant.agent)))
        desired.set(agentKey(grant.agent), retained);
      continue;
    }
    const key = agentKey(grant.agent);
    const previous = current.get(key);
    // Role projection is many-to-one (e.g. chatroom Read+Write and Read+Append).
    // An unchanged selection retains its exact raw modes, including partial
    // contributions whose role depends on another ACP source.
    if (
      previous &&
      projected.some((g) => !g.inherited && agentKey(g.agent) === key && g.role === grant.role)
    ) {
      desired.set(key, previous);
      continue;
    }
    const modes = rolesToModes(grant.role, options.kind ?? "resource", {
      ...options,
      model: snapshot.model,
    });
    const values = new Set(modes.resource);
    if (modes.acr.length) values.add("control");
    if (snapshot.model === "wac" && grant.agent.type === "app")
      throw roleError("unsupported", url, "WAC cannot express app identities");
    if (snapshot.model === "acp" && grant.agent.type === "group")
      throw roleError("unsupported", url, "ACP groups require a membership snapshot");
    desired.set(agentKey(grant.agent), { agent: grant.agent, modes: values });
  }
  // A richer explicit policy cannot silently disappear through a lossy role projection.
  for (const row of current.values())
    if (
      role(
        row,
        snapshot.model,
        options,
        comments ? rows(comments).get(agentKey(row.agent)) : undefined,
      ) === undefined &&
      !sameModes(row.modes, desired.get(agentKey(row.agent))?.modes ?? new Set())
    )
      throw roleError("unsupported", url, "Partial permissions need a richer policy model");
  const writes: Write[] = [];
  const resourceWrite = await plan(snapshot, desired, options);
  if (resourceWrite) writes.push(resourceWrite);
  if (comments) {
    const next = editableRows(comments);
    for (const key of new Set([...current.keys(), ...desired.keys()])) {
      const selected = grants.filter((g) => agentKey(g.agent) === key && g.role === "commenter");
      const wanted = selected.some((g) => !g.inherited);
      if (!wanted && selected.some((g) => g.inherited)) continue;
      const before = current.get(key);
      const wasCommenter =
        before && role(before, snapshot.model, options, rows(comments).get(key)) === "commenter";
      if (!wanted && !wasCommenter) continue;
      const inheritedComment = rows(
        comments,
        comments.documents.filter((doc) => doc !== comments.own),
      ).get(key);
      if (!wanted && inheritedComment?.modes.has("append")) {
        if (desired.has(key))
          throw roleError(
            "inherited-grant",
            comments.resource,
            "Inherited comments must be changed at their source",
          );
        continue;
      }
      const row = next.get(key) ?? {
        agent: (desired.get(key) as Row).agent,
        modes: new Set<Mode>(),
      };
      if (!wanted && row.modes.has("write"))
        throw roleError(
          "unsupported",
          comments.resource,
          "Comments Write cannot be revoked as Append",
        );
      if (wanted) row.modes.add("append");
      else row.modes.delete("append");
      next.set(key, row);
    }
    const commentWrite = await plan(comments, next, options);
    if (commentWrite) writes.push(commentWrite);
  }
  return writes;
}
/**
 * Full-set explicit role diff. Preflight every URL before any write; lockout and
 * unsupported metadata reject the batch. Other failures are reported per URL.
 * notify/message are recorded only; SDK-APP-07 will deliver notifications.
 */
export async function setGrants(
  urls: string[],
  grants: RoleGrant[],
  options: SetGrantsOptions,
): Promise<SetGrantsResult> {
  const seen = new Set<string>();
  for (const grant of grants) {
    validateMetadata(grant);
    const key = `${agentKey(grant.agent)}:${grant.inherited}:${grant.inherited ? grant.source : ""}`;
    if (seen.has(key)) throw roleError("invalid-response", "", "Duplicate role grant");
    seen.add(key);
  }
  return applyBatch(urls, options, (url) => prepare(url, grants, options));
}
function validateMetadata(grant: RoleGrant): void {
  if (grant.expiresAt !== undefined || grant.purpose !== undefined)
    throw roleError("unsupported", "", "WAC/ACP cannot express expiresAt or purpose");
}
async function prepareAgent(
  url: string,
  agent: AgentRef,
  options: GrantMutationOptions,
  grant?: RoleGrant,
): Promise<Write[]> {
  const snapshot = await load(url, options);
  requireFolderScope(snapshot, options);
  const comments = options.commentsContainer
    ? await load(options.commentsContainer, options)
    : undefined;
  const key = agentKey(agent);
  const current = editableRows(snapshot);
  const desired = new Map(current);
  const effective = rows(snapshot).get(key);
  const beforeRole =
    effective &&
    role(effective, snapshot.model, options, comments ? rows(comments).get(key) : undefined);
  if (grant) {
    if (grant.inherited)
      throw roleError("inherited-grant", url, "Add grants at their own resource");
    if (
      (snapshot.model === "wac" && agent.type === "app") ||
      (snapshot.model === "acp" && agent.type === "group")
    )
      throw roleError("unsupported", url, "Identity is unsupported by this access model");
    const order: Role[] = ["viewer", "commenter", "editor", "manager"];
    if (beforeRole && order.indexOf(beforeRole) >= order.indexOf(grant.role)) return [];
    const mapped = rolesToModes(grant.role, options.kind ?? "resource", {
      ...options,
      model: snapshot.model,
    });
    const modes = new Set(current.get(key)?.modes);
    for (const mode of mapped.resource) modes.add(mode);
    if (mapped.acr.length) modes.add("control");
    desired.set(key, { agent, modes });
  } else {
    if (
      rows(
        snapshot,
        snapshot.documents.filter((doc) => doc !== snapshot.own),
      ).has(key)
    )
      throw roleError(
        "inherited-grant",
        url,
        "Remove inherited grants at their governing document",
      );
    desired.delete(key);
  }
  const writes: Write[] = [];
  const write = await plan(snapshot, desired, options, agent);
  if (write) writes.push(write);
  if (
    comments &&
    (grant?.role === "commenter" ||
      (!grant &&
        (beforeRole === "commenter" || editableRows(comments).get(key)?.modes.has("append"))))
  ) {
    const next = editableRows(comments);
    const previous = next.get(key);
    const modes = new Set(previous?.modes);
    if (grant) modes.add("append");
    else {
      if (
        rows(
          comments,
          comments.documents.filter((doc) => doc !== comments.own),
        )
          .get(key)
          ?.modes.has("append")
      )
        return writes;
      if (modes.has("write"))
        throw roleError(
          "unsupported",
          comments.resource,
          "Comments Write cannot be revoked as Append",
        );
      modes.delete("append");
    }
    next.set(key, { agent, modes });
    const commentWrite = await plan(comments, next, options, agent);
    if (commentWrite) writes.push(commentWrite);
  }
  return writes;
}
/** Add/raise one principal only. Replays at an equal or higher role perform no write. */
export async function addGrant(
  urls: string[],
  grant: RoleGrant,
  options: GrantMutationOptions,
): Promise<SetGrantsResult> {
  validateMetadata(grant);
  return applyBatch(urls, options, (url) => prepareAgent(url, grant.agent, options, grant));
}
/**
 * Plan `addGrant` for each URL without writing: throws the first refusal (`owner-lockout`,
 * `unsupported`, an unknown construct, …) that `addGrant` would report. Internal; used to refuse
 * a decision before anything is committed.
 */
export async function planAddGrant(
  urls: string[],
  grant: RoleGrant,
  options: GrantMutationOptions,
): Promise<void> {
  validateMetadata(grant);
  for (const url of new Set(urls)) await prepareAgent(url, grant.agent, options, grant);
}
/** Remove one principal's direct role; inherited access must be edited at its source. */
export async function removeGrant(
  urls: string[],
  agent: AgentRef,
  options: GrantMutationOptions,
): Promise<SetGrantsResult> {
  return applyBatch(urls, options, (url) => prepareAgent(url, agent, options));
}
type Scope = "folder" | "contents";
const SCOPES: readonly Scope[] = ["folder", "contents"];
/** Scoped roles exist only for a folder's own policy in the CSS dialect, without comments. */
function requireScopedFolder(url: string, options: RolesOptions): void {
  if (options.kind !== "folder" || !url.endsWith("/"))
    throw roleError("unsupported", url, "Folder and contents roles apply only to folders");
  if ((options.implementation ?? "css") !== "css" || options.commentsContainer !== undefined)
    throw roleError(
      "unsupported",
      url,
      "Folder and contents roles support only the CSS dialect without a comments container",
    );
}
/** Project one scope: the folder's own rules for that scope plus governing ancestor rules. */
function projectScope(snapshot: Snapshot, options: RolesOptions, scope: Scope): RoleGrant[] {
  const members = scope === "contents";
  const effective = rows(snapshot, snapshot.documents, members);
  return snapshot.documents.flatMap((document) =>
    [...rows(snapshot, [document], members)].flatMap(([key, row]) => {
      const projected = role(effective.get(key) as Row, snapshot.model, options);
      if (projected === undefined) return [];
      return [
        {
          agent: row.agent,
          role: projected,
          inherited: document.resource !== snapshot.resource,
          source: document.url,
        },
      ];
    }),
  );
}
/**
 * Read a folder's roles separately for the folder and for its contents. Unlike `readGrants`,
 * a folder whose two scopes differ is shown rather than refused (`partial-scope`).
 */
export async function readScopedGrants(
  url: string,
  options: RolesOptions,
): Promise<ScopedGrantSnapshot> {
  requireScopedFolder(url, options);
  const snapshot = await load(url, options);
  return {
    url,
    folder: projectScope(snapshot, options, "folder"),
    contents: projectScope(snapshot, options, "contents"),
    version: version(snapshot, options),
  };
}
function desiredScope(
  snapshot: Snapshot,
  options: GrantMutationOptions,
  scope: Scope,
  grants: readonly RoleGrant[],
): { current: Map<string, Row>; desired: Map<string, Row> } {
  const members = scope === "contents";
  const own = snapshot.own as NonNullable<Snapshot["own"]>;
  const current = rows(snapshot, [own], members);
  const projected = projectScope(snapshot, options, scope);
  const explicit = new Set(grants.filter((g) => !g.inherited).map((g) => agentKey(g.agent)));
  const seen = new Set<string>();
  const desired = new Map<string, Row>();
  for (const grant of grants) {
    validateMetadata(grant);
    const key = agentKey(grant.agent);
    const id = `${key}:${grant.inherited}:${grant.inherited ? grant.source : ""}`;
    if (seen.has(id)) throw roleError("invalid-response", "", "Duplicate role grant");
    seen.add(id);
    if (grant.inherited) {
      if (
        !projected.some(
          (g) =>
            g.inherited &&
            agentKey(g.agent) === key &&
            g.role === grant.role &&
            g.source === grant.source,
        )
      )
        throw roleError(
          "inherited-grant",
          snapshot.resource,
          "Inherited grants must be changed at their governing document",
        );
      const retained = current.get(key);
      if (retained && !explicit.has(key)) desired.set(key, retained);
      continue;
    }
    const previous = current.get(key);
    // An unchanged selection keeps its exact raw modes.
    if (
      previous &&
      projected.some((g) => !g.inherited && agentKey(g.agent) === key && g.role === grant.role)
    ) {
      desired.set(key, previous);
      continue;
    }
    if (snapshot.model === "wac" && grant.agent.type === "app")
      throw roleError("unsupported", snapshot.resource, "WAC cannot express app identities");
    if (snapshot.model === "acp" && grant.agent.type === "group")
      throw roleError("unsupported", snapshot.resource, "ACP groups require a membership snapshot");
    // CSS dialect: a manager's Control is a resource mode, never a separate ACR grant.
    const modes = rolesToModes(grant.role, "folder", { ...options, model: snapshot.model });
    desired.set(key, { agent: grant.agent, modes: new Set(modes.resource) });
  }
  // A richer explicit policy cannot silently disappear through a lossy role projection.
  for (const [key, row] of current)
    if (
      role(row, snapshot.model, options) === undefined &&
      !sameModes(row.modes, desired.get(key)?.modes ?? new Set())
    )
      throw roleError(
        "unsupported",
        snapshot.resource,
        "Partial permissions need a richer policy model",
      );
  return { current, desired };
}
async function prepareScoped(
  url: string,
  selection: ScopedGrantSelection,
  options: GrantMutationOptions & { expected?: ScopedGrantSnapshot },
): Promise<Write[]> {
  requireScopedFolder(url, options);
  const snapshot = await load(url, options);
  if (
    options.expected !== undefined &&
    (options.expected.url !== url || options.expected.version !== version(snapshot, options))
  )
    throw roleError("conflict", url, "Grant snapshot is stale or does not cover this URL");
  const own = snapshot.own;
  // Without its own policy a folder's two scopes are the same inherited rules.
  if (!own)
    throw roleError(
      "unsupported",
      url,
      "This folder inherits its access; give it its own sharing before setting separate contents access",
    );
  const plans = {
    folder: desiredScope(snapshot, options, "folder", selection.folder),
    contents: desiredScope(snapshot, options, "contents", selection.contents),
  };
  const empty = new Set<Mode>();
  const changed = [
    ...new Set(SCOPES.flatMap((s) => [...plans[s].current.keys(), ...plans[s].desired.keys()])),
  ].filter((key) =>
    SCOPES.some(
      (s) =>
        !sameModes(
          plans[s].current.get(key)?.modes ?? empty,
          plans[s].desired.get(key)?.modes ?? empty,
        ),
    ),
  );
  if (!changed.length) return [];
  // The caller must keep direct Control on both the folder and its contents (or inherit it).
  const me = agentKey({ type: "webid", id: options.webId });
  const inherited =
    snapshot.model === "acp"
      ? rows(
          snapshot,
          snapshot.documents.filter((d) => d !== own),
        )
      : new Map<string, Row>();
  if (
    !inherited.get(me)?.modes.has("control") &&
    SCOPES.some((s) => !plans[s].desired.get(me)?.modes.has("control"))
  )
    throw roleError(
      "owner-lockout",
      url,
      "Cannot remove your own manager/Control access from the folder or its contents",
    );
  const validEtag = (etag: string | null): boolean =>
    etag !== null && /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag);
  for (const document of [own, ...snapshot.documents])
    if (!validEtag(document.etag))
      throw roleError(
        "precondition-required",
        document.url,
        "A source ETag is required to change sharing",
      );
  const dataset = new Store([...own.dataset]);
  const agentOf = (key: string): AgentRef =>
    (
      plans.folder.desired.get(key) ??
      plans.contents.desired.get(key) ??
      plans.folder.current.get(key) ??
      (plans.contents.current.get(key) as Row)
    ).agent;
  const modesOf = (scope: Scope, key: string) => plans[scope].desired.get(key)?.modes ?? empty;
  if (snapshot.model === "wac") {
    for (const key of changed)
      replaceWac(dataset, url, agentOf(key), [...modesOf("folder", key)], true, [
        ...modesOf("contents", key),
      ]);
  } else {
    for (const key of changed)
      removeAcpAgent(dataset, url, snapshot.ownUrl, agentOf(key), "css", true);
    const both: Row[] = [];
    const folderOnly: Row[] = [];
    const contentsOnly: Row[] = [];
    for (const key of changed) {
      const folder = modesOf("folder", key);
      const contents = modesOf("contents", key);
      if (folder.size && sameModes(folder, contents))
        both.push({ agent: agentOf(key), modes: folder });
      else {
        if (folder.size) folderOnly.push({ agent: agentOf(key), modes: folder });
        if (contents.size) contentsOnly.push({ agent: agentOf(key), modes: contents });
      }
    }
    for (const [selected, members] of [
      [both, true],
      [folderOnly, false],
      [contentsOnly, "only"],
    ] as const)
      if (selected.length) appendAcp(dataset, url, snapshot.ownUrl, selected, "css", members);
    // A change that only removes access appends nothing, so prune its detached policies here.
    pruneAcp(dataset);
  }
  // Re-read generated RDF through the same strict role policy boundary before persistence.
  const emitted = {
    url: snapshot.ownUrl,
    resource: snapshot.resource,
    model: snapshot.model,
    dataset,
    policy: readPolicy(dataset, snapshot.resource, snapshot.ownUrl, snapshot.model, "css"),
    etag: null,
  };
  const reread = { ...snapshot, documents: [emitted] };
  for (const scope of SCOPES) {
    const after = rows(reread, [emitted], scope === "contents");
    const desired = plans[scope].desired;
    for (const key of new Set([...after.keys(), ...desired.keys()]))
      if (!sameModes(after.get(key)?.modes ?? empty, desired.get(key)?.modes ?? empty))
        throw roleError(
          "invalid-response",
          snapshot.ownUrl,
          "Serialized roles differ from the plan",
        );
  }
  return [
    {
      resource: snapshot.resource,
      url: snapshot.ownUrl,
      etag: own.etag,
      body: await serialize(dataset),
      snapshot,
    },
  ];
}
/**
 * Set a folder's full role sets for the folder and for its contents separately. The folder must
 * have its own policy; the caller keeps Control on both scopes. With `expected` (from
 * `readScopedGrants`), any change since that read is a `conflict`. Unrelated rules are kept.
 */
export async function setScopedGrants(
  url: string,
  selection: ScopedGrantSelection,
  options: GrantMutationOptions & { expected?: ScopedGrantSnapshot },
): Promise<SetGrantsResult> {
  return applyBatch([url], options, (target) => prepareScoped(target, selection, options));
}
async function applyBatch(
  urls: string[],
  options: GrantMutationOptions,
  prepareUrl: (url: string) => Promise<Write[]>,
): Promise<SetGrantsResult> {
  const result: SetGrantsResult = {
    applied: [],
    failed: [],
    notification: {
      requested: options.notify ?? false,
      delivered: false,
      ...(options.message !== undefined ? { message: options.message } : {}),
    },
  };
  const plans: { url: string; writes: Write[] }[] = [];
  for (const url of new Set(urls)) {
    try {
      plans.push({ url, writes: await prepareUrl(url) });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "owner-lockout"
      )
        throw error;
      result.failed.push({ url, error });
    }
  }
  for (const { url, writes } of plans) {
    try {
      for (const write of writes) {
        const latest = await load(write.resource, options);
        if (JSON.stringify(validators(latest)) !== JSON.stringify(validators(write.snapshot)))
          throw roleError("conflict", url, "Governing access changed before apply");
      }
      for (const write of writes) {
        const response = await request(write.url, options, {
          method: "PUT",
          headers: {
            "content-type": "text/turtle",
            ...(write.etag ? { "if-match": write.etag } : { "if-none-match": "*" }),
          },
          body: write.body,
        });
        requireOk(response, write.resource);
      }
      result.applied.push(url);
    } catch (error) {
      result.failed.push({ url, error });
    }
  }
  return result;
}
