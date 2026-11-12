// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import {
  type AccessModesSnapshot,
  type PrincipalModes,
  readAccessModes,
} from "@jeswr/pod-access/roles";
import { StorageError } from "@jeswr/storage-client";
import type { GroupSession } from "./index.js";

const MANAGES = ["control", "read", "write"] as const;
const isOwner = (row: PrincipalModes, webId: string) =>
  row.agent.type === "webid" && row.agent.id === webId;
const manages = (row: PrincipalModes, webId: string) =>
  isOwner(row, webId) && MANAGES.every((mode) => row.modes.includes(mode));
/** The resource's own scope and, for a container, the scope its members inherit. */
function scopes(snapshot: AccessModesSnapshot): PrincipalModes[][] {
  return snapshot.url.endsWith("/") ? [snapshot.resource, snapshot.members] : [snapshot.resource];
}
/** Every principal holding any mode is the owner, and the owner manages every scope. */
export function ownerOnlyModes(snapshot: AccessModesSnapshot, webId: string): boolean {
  return scopes(snapshot).every(
    (rows) => rows.every((row) => isOwner(row, webId)) && rows.some((row) => manages(row, webId)),
  );
}
/**
 * Public Read and owner management in every scope; every other principal, holding any mode,
 * holds exactly Read. Append-only, Write-without-Read and Control-without-edit principals,
 * which map to no role, are refused.
 */
export function publicReadModes(snapshot: AccessModesSnapshot, webId: string): boolean {
  return scopes(snapshot).every(
    (rows) =>
      rows.some((row) => manages(row, webId)) &&
      rows.some((row) => row.agent.type === "public") &&
      rows.every(
        (row) => isOwner(row, webId) || (row.modes.length === 1 && row.modes[0] === "read"),
      ),
  );
}

/** Verify private inheritance before an application creates a new Family space or index. */
export async function ownerOnlyAccess(session: GroupSession, target: string): Promise<boolean> {
  let url = target;
  for (;;) {
    try {
      await session.storage.head(url);
      break;
    } catch (error) {
      if (
        !(error instanceof StorageError && error.code === "not-found") ||
        url === session.storage.root
      )
        throw error;
      url = new URL(url.endsWith("/") ? ".." : ".", url).href;
    }
  }
  // Raw modes include principals that map to no role; a missing target inherits the
  // ancestor's member scope, which is checked with its own scope.
  const snapshot = await readAccessModes(url, {
    fetch: session.fetch,
    root: session.storage.root,
    model: "wac",
    kind: url.endsWith("/") ? "folder" : "resource",
  });
  return ownerOnlyModes(snapshot, session.webId);
}
