// AUTHORED-BY Codex GPT-6.1-Sol
import { type Grant, MODES, PUBLIC, readGrants, SharingError } from "./rdf";
import type {
  AccessMode,
  AccessOrigin,
  AuthorizationChange,
  ResourceAccess,
  SharingInput,
  SharingRole,
  SharingSelection,
  SharingState,
} from "./types";

function forPrincipal(grants: Grant[], principal: string, resource: string): Grant[] {
  return grants.filter((grant) => grant.principal === principal && grant.resource === resource);
}
function allowed(grants: Grant[]): Set<AccessMode> {
  return new Set(grants.flatMap((grant) => [...grant.modes]));
}
function origin(grants: Grant[]): AccessOrigin {
  const contributing = grants.filter((grant) => grant.modes.size > 0);
  return {
    inherited: contributing.some((grant) => grant.document.inherited),
    explicit: contributing.some((grant) => !grant.document.inherited),
    sources: [...new Set(contributing.map((grant) => grant.document.source))].sort(),
  };
}
function project(input: SharingInput, grants: Grant[], comments: Grant[]): SharingState {
  const data = grants.filter((grant) => grant.resource === input.access.resource);
  const management = grants.filter(
    (grant) => grant.document.model === "acp" && grant.resource === grant.document.source,
  );
  for (const principal of new Set(management.map((grant) => grant.principal))) {
    const policyModes = allowed(management.filter((grant) => grant.principal === principal));
    if (policyModes.size === 0) continue;
    const access = allowed(forPrincipal(data, principal, input.access.resource));
    if (
      principal === PUBLIC ||
      !policyModes.has("Read") ||
      !policyModes.has("Write") ||
      !access.has("Read") ||
      !access.has("Write")
    ) {
      throw new SharingError("ACP management permissions cannot be expressed as a sharing role");
    }
  }
  const principals = [...new Set(data.map((grant) => grant.principal))]
    .filter((p) => p !== PUBLIC)
    .sort();
  const people = principals.flatMap((webId) => {
    const own = forPrincipal(data, webId, input.access.resource);
    const access = allowed(own);
    if (access.size === 0) return [];
    if (!access.has("Read") || (access.has("Control") && !access.has("Write"))) {
      throw new SharingError("Partial resource permissions cannot be expressed as a sharing role");
    }
    const policy = grants.filter(
      (grant) => grant.principal === webId && grant.resource === grant.document.source,
    );
    const policyModes = allowed(policy);
    const manages = access.has("Control") || (policyModes.has("Read") && policyModes.has("Write"));
    const commentGrants = input.comments
      ? forPrincipal(comments, webId, input.comments.resource)
      : [];
    const commentModes = allowed(commentGrants);
    const canComment = commentModes.has("Append") || commentModes.has("Write");
    const role: SharingRole =
      manages && access.has("Write")
        ? "owner"
        : access.has("Write")
          ? "editor"
          : canComment
            ? "commenter"
            : "viewer";
    // Append on the file is not the app's separate comments permission.
    if (access.has("Append") && !access.has("Write"))
      throw new SharingError("Append on the resource is not a commenter grant");
    return [
      {
        webId,
        role,
        ...origin([...own, ...(manages ? policy : []), ...(canComment ? commentGrants : [])]),
      },
    ];
  });
  const anonymous = forPrincipal(data, PUBLIC, input.access.resource);
  const publicModes = allowed(anonymous);
  if (
    publicModes.has("Control") ||
    (publicModes.size && !publicModes.has("Read")) ||
    (publicModes.has("Append") && !publicModes.has("Write"))
  ) {
    throw new SharingError("Anonymous permissions exceed the sharing model");
  }
  return {
    people,
    link: publicModes.has("Write") ? "editor" : publicModes.has("Read") ? "viewer" : "none",
    public: publicModes.has("Read") ? "viewer" : "none",
    general: origin(anonymous),
  };
}

/** Pure projection of caller-resolved, default-graph WAC/ACP datasets. No discovery or I/O. */
export function readSharing(input: SharingInput): SharingState {
  return project(input, readGrants(input.access), input.comments ? readGrants(input.comments) : []);
}

/** Smallest set of mode additions/removals for changed rows. Unchanged rows retain their
 * original authorizations (including redundant Append). Inherited rows and owner rows
 * are read-only. A separate adapter must apply these changes with precondition checks.
 */
export function diffSharing(input: SharingInput, desired: SharingSelection): AuthorizationChange[] {
  const grants = readGrants(input.access);
  const comments = input.comments ? readGrants(input.comments) : [];
  const current = project(input, grants, comments);
  const changes: AuthorizationChange[] = [];
  const selected = new Map<string, SharingRole>();
  for (const person of desired.people) {
    if (selected.has(person.webId) || person.webId === PUBLIC)
      throw new SharingError("Duplicate or reserved person identifier");
    selected.set(person.webId, person.role);
  }
  const existing = new Map(current.people.map((person) => [person.webId, person]));
  for (const webId of [...new Set([...selected.keys(), ...existing.keys()])].sort()) {
    const before = existing.get(webId);
    const role = selected.get(webId);
    if (before?.role === role) continue;
    if (before?.role === "owner") throw new SharingError("Owner rows are read-only");
    if (before?.inherited) throw new SharingError("Inherited access must be changed at its source");
    if (role === "commenter" && !input.comments)
      throw new SharingError("Commenter requires a comments container");
    const target: AccessMode[] = role ? ["Read"] : [];
    if (role === "editor" || role === "owner") target.push("Write");
    const explicit = input.access.documents.find((document) => !document.inherited);
    if (role === "owner" && explicit?.model === "wac") target.push("Control");
    plan(input.access, grants, webId, input.access.resource, target, changes);
    if (explicit?.model === "acp") {
      plan(
        input.access,
        grants,
        webId,
        explicit.source,
        role === "owner" ? ["Read", "Write"] : [],
        changes,
      );
    }
    if (input.comments) {
      const beforeComments = allowed(forPrincipal(comments, webId, input.comments.resource));
      const wantsComments = role !== undefined && role !== "viewer";
      if (!wantsComments && beforeComments.has("Write")) {
        throw new SharingError(
          "Comment access also comes from Write; changing it requires a richer model",
        );
      }
      const nextComments = MODES.filter((mode) => mode !== "Append" && beforeComments.has(mode));
      if (wantsComments && (beforeComments.has("Append") || !beforeComments.has("Write")))
        nextComments.push("Append");
      plan(input.comments, comments, webId, input.comments.resource, nextComments, changes);
    }
  }
  // Anonymous Read has two presentations. Clear both to restrict access.
  const nextGeneral: AccessMode[] =
    desired.link === "editor"
      ? ["Read", "Write"]
      : desired.link === "viewer" || desired.public === "viewer"
        ? ["Read"]
        : [];
  const oldGeneral = allowed(forPrincipal(grants, PUBLIC, input.access.resource));
  if (
    oldGeneral.has("Write") !== nextGeneral.includes("Write") ||
    oldGeneral.has("Read") !== nextGeneral.includes("Read")
  ) {
    if (current.general.inherited)
      throw new SharingError("Inherited access must be changed at its source");
    plan(input.access, grants, PUBLIC, input.access.resource, nextGeneral, changes);
  }
  return changes;
}

function plan(
  context: ResourceAccess,
  grants: Grant[],
  principal: string,
  resource: string,
  target: AccessMode[],
  changes: AuthorizationChange[],
): void {
  const matching = forPrincipal(grants, principal, resource);
  const before = allowed(matching);
  const after = new Set(target);
  // Write already permits Append; retain an explicit redundant Append to avoid churn.
  if (after.has("Write") && before.has("Append")) after.add("Append");
  const add = MODES.filter((mode) => after.has(mode) && !before.has(mode));
  const remove = MODES.filter((mode) => before.has(mode) && !after.has(mode));
  if (!add.length && !remove.length) return;
  if (matching.some((grant) => grant.document.inherited && grant.modes.size > 0))
    throw new SharingError("Inherited access must be changed at its source");
  const document = context.documents.find((candidate) => !candidate.inherited);
  if (!document) throw new SharingError("An explicit destination document is required for changes");
  changes.push({
    model: document.model,
    source: document.source,
    resource,
    principal: principal === PUBLIC ? { kind: "public" } : { kind: "webid", webId: principal },
    add,
    remove,
    inherited: false,
  });
}
