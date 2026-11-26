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

/**
 * List a container's direct members, saying whether the listing was usable in full: every
 * listed member accepted, each a direct child, and the container described at all (an empty
 * 200 body proves nothing about what the folder holds).
 */
async function members(url: string, options: RemoveCopiedGrantsOptions, root: string) {
  const response = await request(url, options, {
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  requireOk(response, url);
  const dataset = await parseRdf(response.body ?? "", response.headers.get("content-type"), {
    baseIRI: url,
    maxBytes: MAX_LISTING_BYTES,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const subject = DataFactory.namedNode(url);
  const listed = new Set(
    [...dataset.match(subject, DataFactory.namedNode(LDP_CONTAINS))].map(
      (quad) => `${quad.object.termType} ${quad.object.value}`,
    ),
  );
  const found = parseContainerMembers(dataset, url, { scope: root }).filter(
    (member) => parent(member.url) === url,
  );
  return {
    found,
    complete: found.length === listed.size && dataset.match(subject).size > 0,
  };
}
function parent(url: string): string {
  return new URL(url.endsWith("/") ? ".." : ".", url).href;
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
 * place is listed in `failed` and the walk goes on. A copy of a copy names every document it came
 * from, and is removed only when all of them are stale. A folder with no ACL of its own passes
 * its parent's answer down. Only WebID agents are accepted, and never the caller's own, so the
 * caller's rules are never touched.
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
  // Only a person's own rules are taken off: removing a group or class could take the caller's
  // own Control with it where that is how they hold it.
  if (agent.type !== "webid")
    throw roleError("unsupported", folder, "Copied rules are removed for one person at a time");
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
  const implementation = options.implementation ?? "css";
  const top = await load(folder, { ...options, root, kind: "folder" });
  if (top.model === "acp") return { ...result, model: "acp" };
  // A source ACL → whether it still gives the agent access to its members. A folder with no ACL
  // of its own takes its parent's answer: copies made from a deleted ACL are stale exactly when
  // the folder's inherited access no longer reaches the agent.
  const sources = new Map<string, boolean>();
  // Folder URL → whether its members' effective access (own or inherited) still reaches the agent.
  const reaches = new Map<string, boolean>();
  const topReaches =
    (top.own ? rows(top, [top.own], true) : rows(top, top.documents, true)).get(key) !== undefined;
  reaches.set(folder, topReaches);
  if (top.ownUrl) sources.set(top.ownUrl, topReaches);
  if (top.own && (holds(top, top.own, key, false) || holds(top, top.own, key, true)))
    result.remaining.push(folder);
  // Each place is read on its own, without the model pin, so a place with no own document
  // reads as inheriting rather than as a model mismatch.
  const { model: _pinned, ...unpinned } = options;
  const queue = [{ url: folder, depth: 0 }];
  const seen = new Set([folder]);
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
      if (seen.has(member.url) || /\.(?:acl|acr)$/i.test(new URL(member.url).pathname)) continue;
      seen.add(member.url);
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
        if (!own) {
          // Inherits: its members see what the folder above passes down.
          const inherited = reaches.get(container.url) as boolean;
          if (member.container) {
            reaches.set(member.url, inherited);
            sources.set(snapshot.ownUrl, inherited);
          }
        } else {
          if (own.model !== "wac")
            throw roleError("unsupported", own.url, "A folder's places mix access models");
          const dataset = new Store([...own.dataset]);
          const stale = new Set([...sources].filter(([, held]) => !held).map(([url]) => url));
          if (removeCopiedPrincipal(dataset, member.url, agent, stale)) {
            // The edited document must still read under the same strict role policy.
            readPolicy(dataset, member.url, own.url, "wac", implementation);
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
              ...(options.signal ? { signal: options.signal } : {}),
            });
            requireOk(response, own.url);
            result.removed.push(member.url);
          }
          // What is left there, read best effort: a rule this layer can't project as roles
          // (`acl:origin`, say) leaves the answer unknown, so the place is reported as possibly
          // still reachable and, for a folder, its copies' source is treated as still granting.
          let left = true;
          try {
            const after = readPolicy(dataset, member.url, own.url, "wac", implementation);
            const document = { ...own, dataset, policy: after, etag: null };
            const onMembers = holds(snapshot, document, key, true);
            left = holds(snapshot, document, key, false) || onMembers;
            if (member.container) {
              reaches.set(member.url, onMembers);
              sources.set(own.url, onMembers);
            }
          } catch {
            if (member.container) {
              reaches.set(member.url, true);
              sources.set(own.url, true);
            }
          }
          if (left) result.remaining.push(member.url);
        }
      } catch (error) {
        result.failed.push({ url: member.url, error });
        // A folder whose own access is unknown is still walked: its places may hold copies
        // from the folder above it. Its own copies' source stays unknown, so they are kept.
        if (member.container && !reaches.has(member.url)) reaches.set(member.url, true);
      }
      if (member.container) {
        if (container.depth + 1 > maxDepth) result.incomplete = true;
        else queue.push({ url: member.url, depth: container.depth + 1 });
      }
    }
  }
  return result;
}
