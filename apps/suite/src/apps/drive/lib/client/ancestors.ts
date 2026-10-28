// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { Store } from "n3";
import { trashEntries, trashIndexFrom } from "../operations/trash-index";
import { type accessControl, DriveAccessError, type OwnAccess, privateAcl } from "./access";

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
    while (url.startsWith(storageUrl)) {
      const response = await http(url, { method: "HEAD" });
      if (response.ok) break;
      if (response.status !== 404 || url === storageUrl)
        throw new DriveAccessError("Ancestor could not be checked");
      if (response.headers.get("x-solid-demo-access-control") === "none") return;
      missing.unshift(url);
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
    for (const plan of plans) {
      // Conditional creation refuses races; never replace a concurrently created folder's ACL.
      const response = await options.putFolder(plan.url);
      try {
        await access.install(plan.policy, plan.url, plan.url);
      } catch (error) {
        const etag = response.headers.get("etag");
        if (etag)
          await http(plan.url, { method: "DELETE", headers: { "if-match": etag } }).catch(
            () => undefined,
          );
        throw error;
      }
      if (plan.private && !plan.url.includes("/.trash/")) options.onPrivateFolder?.(plan.url);
    }
  };
}
