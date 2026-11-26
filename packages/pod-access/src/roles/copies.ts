// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { parseContainerMembers } from "@jeswr/ldp-container";
import { DataFactory, Store } from "n3";
import { serialize } from "../rdf.js";
import { rows, validators } from "./client.js";
import { roleError } from "./errors.js";
import { type Document, load, request, requireOk, type Snapshot, scoped } from "./http.js";
import { agentKey, readPolicy, removeCopiedPrincipal } from "./rdf.js";
import type { AgentRef, GrantMutationOptions } from "./types.js";

const LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";
const MAX_LISTING_BYTES = 4 * 1024 * 1024;

export interface RemoveCopiedGrantsOptions extends GrantMutationOptions {
  /** Most resources looked at below the folder. Default 1000. */
  maxResources?: number;
  /** Deepest folder level below the folder that is listed. Default 16. */
  maxDepth?: number;
  signal?: AbortSignal;
}

export interface RemoveCopiedGrantsResult {
  /** The folder's access model. ACP never copies rules, so an ACP folder is not walked. */
  model: "wac" | "acp";
  /** Places whose own access document had the agent's copied rules taken off. */
  removed: string[];
  /**
   * Places (the folder itself included) whose own access document still gives the agent some
   * access afterwards: rules they hold there directly, copies from outside the folder, or copies
   * whose source still grants them.
   */
  remaining: string[];
  /** Places that could not be read, or whose change could not be saved. */
  failed: { url: string; error: unknown }[];
  /**
   * The walk did not reach everything: a limit was hit, or a folder listing could not be read in
   * full. Places beyond that point were not checked.
   */
  incomplete: boolean;
}

/** Whether a document's rules give `key` any mode on the resource (`members`: on its members). */
function holds(snapshot: Snapshot, document: Document, key: string, members: boolean) {
  return (rows(snapshot, [document], members).get(key)?.modes.size ?? 0) > 0;
}

/** List a container's direct members, saying whether every listed member was usable. */
async function members(url: string, options: RemoveCopiedGrantsOptions, root: string) {
  const response = await request(url, options, {
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
  });
  requireOk(response, url);
  const dataset = await parseRdf(response.body ?? "", response.headers.get("content-type"), {
    baseIRI: url,
    maxBytes: MAX_LISTING_BYTES,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const listed = new Set(
    [...dataset.match(DataFactory.namedNode(url), DataFactory.namedNode(LDP_CONTAINS))].map(
      (quad) => `${quad.object.termType} ${quad.object.value}`,
    ),
  );
  const found = parseContainerMembers(dataset, url, { scope: root });
  return { found, complete: found.length === listed.size };
}

/**
 * Remove the rules the roles layer copied into descendants' own WAC documents for `agent`, once
 * the folder no longer grants them. When a child of a shared folder first gets its own access
 * document, every inherited rule is copied into it (marked `materializedFrom`), so taking the
 * agent off the folder alone leaves them their access to that child. Call this after removing the
 * agent's role on the folder itself.
 *
 * The walk lists the folder breadth first, within `maxResources` and `maxDepth`. In each
 * descendant's own document it takes the agent off only rules copied from the folder's document
 * or from a document of a folder inside it, and only while that source document gives the agent
 * nothing on its members: a copy of access that is still granted at its source is consistent and
 * stays. Rules the agent holds directly, and copies from outside the folder, are never touched;
 * places where any access remains are listed in `remaining`. Each change is planned from the
 * document read, re-read before writing, and saved with `If-Match`; a lost race or an unreadable
 * place is listed in `failed` and the walk goes on. Refuses the caller's own WebID; any other
 * agent's removal leaves the caller's own rules, so it cannot lock them out.
 */
export async function removeCopiedGrants(
  folder: string,
  agent: AgentRef,
  options: RemoveCopiedGrantsOptions,
): Promise<RemoveCopiedGrantsResult> {
  const root = options.root ?? `${new URL(folder).origin}/`;
  scoped(folder, root);
  if (!folder.endsWith("/"))
    throw roleError("unsupported", folder, "Copied rules are removed below a folder");
  const key = agentKey(agent);
  const me = agentKey({ type: "webid", id: options.webId });
  if (key === me) throw roleError("owner-lockout", folder, "Cannot remove your own access");
  const maxResources = options.maxResources ?? 1000;
  const maxDepth = options.maxDepth ?? 16;
  const result: RemoveCopiedGrantsResult = {
    model: "wac",
    removed: [],
    remaining: [],
    failed: [],
    incomplete: false,
  };
  const top = await load(folder, { ...options, root, kind: "folder" });
  if (top.model === "acp") return { ...result, model: "acp" };
  // Source document → whether it still gives the agent access to its members.
  const sources = new Map<string, boolean>();
  if (top.own) {
    sources.set(top.own.url, holds(top, top.own, key, true));
    if (holds(top, top.own, key, false) || holds(top, top.own, key, true))
      result.remaining.push(folder);
  }
  // Each place is read on its own, without the model pin, so a place with no own document
  // reads as inheriting rather than as a model mismatch.
  const { model: _pinned, ...unpinned } = options;
  const queue = [{ url: folder, depth: 0 }];
  let visited = 0;
  for (const container of queue) {
    options.signal?.throwIfAborted();
    let listing: Awaited<ReturnType<typeof members>>;
    try {
      listing = await members(container.url, options, root);
    } catch (error) {
      result.failed.push({ url: container.url, error });
      result.incomplete = true;
      continue;
    }
    if (!listing.complete) result.incomplete = true;
    for (const member of listing.found) {
      options.signal?.throwIfAborted();
      if (/\.(?:acl|acr)$/i.test(new URL(member.url).pathname)) continue;
      if (++visited > maxResources) {
        result.incomplete = true;
        return result;
      }
      const placeRoot = member.container ? member.url : container.url;
      const placeOptions = {
        ...unpinned,
        root: placeRoot,
        kind: member.container ? ("folder" as const) : ("resource" as const),
      };
      try {
        const snapshot = await load(member.url, placeOptions);
        const own = snapshot.own;
        if (own) {
          if (own.model !== "wac")
            throw roleError("unsupported", own.url, "A folder's places mix access models");
          const dataset = new Store([...own.dataset]);
          const stale = new Set([...sources].filter(([, held]) => !held).map(([url]) => url));
          let document = own;
          if (removeCopiedPrincipal(dataset, agent, stale)) {
            const policy = readPolicy(dataset, member.url, own.url, "wac", "css");
            document = { ...own, dataset, policy, etag: null };
            if (own.etag === null || !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(own.etag))
              throw roleError(
                "precondition-required",
                own.url,
                "An ETag is required for replacement",
              );
            const latest = await load(member.url, placeOptions);
            if (JSON.stringify(validators(latest)) !== JSON.stringify(validators(snapshot)))
              throw roleError("conflict", member.url, "Access changed before it could be removed");
            const response = await request(own.url, options, {
              method: "PUT",
              headers: { "content-type": "text/turtle", "if-match": own.etag },
              body: await serialize(dataset),
            });
            requireOk(response, own.url);
            result.removed.push(member.url);
          }
          if (member.container) sources.set(own.url, holds(snapshot, document, key, true));
          if (holds(snapshot, document, key, false) || holds(snapshot, document, key, true))
            result.remaining.push(member.url);
        }
      } catch (error) {
        result.failed.push({ url: member.url, error });
        // A folder whose own access is unknown is still walked: its places may hold copies
        // from the folder above it.
      }
      if (member.container) {
        if (container.depth + 1 > maxDepth) result.incomplete = true;
        else queue.push({ url: member.url, depth: container.depth + 1 });
      }
    }
  }
  return result;
}
