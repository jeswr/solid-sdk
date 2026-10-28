// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { Store } from "n3";
import { trashEntries, trashIndexFrom } from "../operations/trash-index";
import { type accessControl, DriveAccessError, type OwnAccess, privateAcl } from "./access";
import { relocate, sameGraph } from "./rdf";

// Shared by all clients in this tab, including the fresh client used by undo.
const provisioning = new Map<string, Promise<void>>();

function singleFlight(url: string, work: () => Promise<void>): Promise<void> {
  const current = provisioning.get(url);
  if (current) return current;
  // Publish before the first request, and retain failures through empty-folder cleanup.
  const pending = Promise.resolve()
    .then(async () => {
      const locks = globalThis.navigator?.locks;
      if (locks) await locks.request(`solid-drive:ancestor:${url}`, work);
      else await work();
    })
    .finally(() => provisioning.delete(url));
  provisioning.set(url, pending);
  return pending;
}

export interface ArchivedAcl {
  resource: string;
  acl: string;
  turtle: string;
}

/** Private sibling receipt; it stays outside the resource's recovery tree. */
export function policyArchiveOf(url: string): string | undefined {
  const match = /^(.*\/\.trash\/[0-9a-f-]{36}\/)/i.exec(url);
  return match ? `${match[1]}.access.json` : undefined;
}

function parent(url: string): string {
  return new URL(url.endsWith("/") ? ".." : ".", url).href;
}

/** Guard every implicit ancestor creation, including raw uploads and reverse moves. */
export function ancestorGuard(options: {
  storageUrl: string;
  http: typeof globalThis.fetch;
  access: ReturnType<typeof accessControl>;
  readRdf: (url: string) => Promise<{ dataset: Store } | undefined>;
  putFolder: (url: string) => Promise<Response>;
  owner: () => string | undefined;
  onPrivateFolder?: (url: string) => void;
}) {
  const { http, storageUrl, access } = options;
  const archived = async (url: string): Promise<OwnAccess | undefined> => {
    // Unreadable/malformed historical metadata is unknown access, never permission to inherit.
    try {
      let root = parent(url);
      while (root.startsWith(storageUrl)) {
        const saved = await options.readRdf(`${root}.trash/index.ttl`);
        if (saved) {
          const index = trashIndexFrom(saved.dataset);
          for (const entry of trashEntries(index)) {
            const archive = policyArchiveOf(entry.url);
            if (
              !entry.original.endsWith("/") ||
              !url.startsWith(entry.original) ||
              !archive?.startsWith(`${root}.trash/`)
            )
              continue;
            const own = index.record(entry.url).containerAcls;
            let policy: ArchivedAcl | undefined;
            if (own !== undefined) policy = JSON.parse(own)[url];
            else {
              // Compatibility with folders trashed before the index archived own ACLs.
              const response = await http(archive);
              if (!response.ok) return undefined;
              policy = (await response.json())[`${entry.url}${url.slice(entry.original.length)}`];
            }
            if (!policy) return undefined;
            return {
              url: policy.acl,
              etag: "",
              dataset: await parseRdf(policy.turtle, "text/turtle", { baseIRI: policy.acl }),
            };
          }
        }
        if (root === storageUrl) break;
        root = parent(root);
      }
    } catch {
      // The owner-only fallback is also verified before any children are written.
    }
    return undefined;
  };
  return async (destination: string): Promise<void> => {
    assertWithinPodScope(storageUrl, destination);
    let url = parent(destination);
    const missing: string[] = [];
    const containers: string[] = [];
    let existing = false;
    while (url.startsWith(storageUrl)) {
      // HEAD 200 may describe an empty container whose ACL is still being installed.
      // Check every ancestor, even above an existing immediate parent.
      if (existing) await provisioning.get(url);
      else {
        const response = await http(url, { method: "HEAD" });
        await provisioning.get(url);
        if (response.ok) existing = true;
        else {
          if (response.status !== 404 || url === storageUrl)
            throw new DriveAccessError("Ancestor could not be checked");
          if (response.headers.get("x-solid-demo-access-control") === "none") return;
          missing.unshift(url);
        }
      }
      if (url === storageUrl) break;
      containers.unshift(url);
      url = parent(url);
    }
    // Decide ALL policies before creating even an empty ancestor.
    const plans: { url: string; policy: OwnAccess; private: boolean }[] = [];
    for (const container of missing) {
      const original = await archived(container);
      const owner = options.owner();
      if (!original && !owner) throw new DriveAccessError("Owner WebID unavailable");
      plans.push({
        url: container,
        policy: original ?? {
          url: `${container}.acl`,
          etag: "",
          dataset: privateAcl(container, owner as string),
        },
        private: !original,
      });
    }
    for (const container of containers) {
      const plan = plans.find((candidate) => candidate.url === container);
      // Recheck existing ancestors too: a delayed HEAD can outlive failed provisioning.
      await singleFlight(container, async () => {
        // A different tab may have created (or removed) this ancestor while we waited.
        const current = await http(container, { method: "HEAD" });
        if (current.ok) {
          if (plan) {
            const own = await access.snapshot(container, current.headers);
            if (
              own.status !== "known" ||
              !sameGraph(
                relocate(plan.policy.dataset, [[plan.policy.url, own.policy.url]]),
                own.policy.dataset,
              )
            )
              throw new DriveAccessError("Concurrent ancestor policy could not be verified");
          }
          return;
        }
        if (current.status !== 404 || !plan)
          throw new DriveAccessError("Ancestor changed before provisioning");
        // Conditional creation refuses uncoordinated races; never replace their ACLs.
        const response = await options.putFolder(container);
        try {
          await access.install(plan.policy, container, container);
        } catch (error) {
          const etag = response.headers.get("etag");
          if (etag)
            await http(container, { method: "DELETE", headers: { "if-match": etag } }).catch(
              () => undefined,
            );
          throw error;
        }
        if (plan.private && !container.includes("/.trash/")) options.onPrivateFolder?.(container);
      });
    }
  };
}
