// AUTHORED-BY Codex
import type { Mode } from "../types.js";
import { roleError } from "./errors.js";
import type { ResourceKind, Role, RoleContext, RoleModes } from "./types.js";

/** Map roles using the trusted dialect's management target. Defaults to CSS/WAC. */
export function rolesToModes(role: Role, kind: ResourceKind, ctx: RoleContext): RoleModes {
  const result: { resource: Mode[]; comments: Mode[]; acr: Mode[] } = {
    resource: ["read"],
    comments: [],
    acr: [],
  };
  if (role === "commenter") {
    if (!ctx.commentsContainer && kind === "document")
      throw roleError(
        "comments-container-required",
        "",
        "commenter requires ctx.commentsContainer",
      );
    if (ctx.commentsContainer) result.comments.push("append");
  }
  if (role === "editor" || role === "manager") {
    if (kind !== "chatroom") result.resource.push("write");
    result.resource.push("append");
  }
  if (role === "manager") {
    if (ctx.model === "acp" && ctx.implementation === "ess") result.acr.push("read", "write");
    else result.resource.push("control");
  }
  return result;
}

/** Highest fully covered role; partial management and unrelated Append never round up. */
export function modesToRole(
  modes: Iterable<Mode> | RoleModes,
  kind: ResourceKind,
  ctx: RoleContext = {},
): Role | undefined {
  const split = "resource" in modes ? modes : { resource: [...modes], comments: [], acr: [] };
  const resource = new Set(split.resource);
  if (resource.has("write")) resource.add("append");
  const comments = new Set(split.comments);
  const acr = new Set(split.acr);
  if (!resource.has("read")) return undefined;
  const edits = kind === "chatroom" ? resource.has("append") : resource.has("write");
  const management =
    ctx.model === "acp" && ctx.implementation === "ess"
      ? acr.has("read") && acr.has("write")
      : resource.has("control");
  if ((resource.has("control") || acr.size > 0) && (!edits || !management)) return undefined;
  if (management && edits) return "manager";
  if (edits) return "editor";
  if (resource.has("append")) return undefined;
  if (ctx.commentsContainer && (comments.has("append") || comments.has("write")))
    return "commenter";
  return "viewer";
}
