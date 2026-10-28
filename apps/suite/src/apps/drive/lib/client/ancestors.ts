// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import type { Store } from "n3";
import { trashEntries, trashIndexFrom } from "../operations/trash-index";
import { type accessControl, DriveAccessError, type OwnAccess, privateAcl } from "./access";
import { type ProtectionRequirement, protectionLedger } from "./protection-ledger";
import { relocate, sameGraph } from "./rdf";

// Shared by all clients in this tab, including the fresh client used by undo.
const provisioning = new Map<string, Promise<void>>();

function singleFlight(url: string, work: () => Promise<void>, join = true): Promise<void> {
  const current = provisioning.get(url);
  if (current) return join ? current : current.then(() => singleFlight(url, work, false));
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
  error: (status: number, url: string) => Error;
  owner: () => string | undefined;
  onPrivateFolder?: (url: string) => void;
}) {
  const { http, storageUrl, access } = options;
  const ledger = protectionLedger(http);
  const requirementFor = async (
    policy: OwnAccess,
    from: string,
  ): Promise<ProtectionRequirement> => ({
    acl: policy.url,
    from,
    turtle: await serialize([...policy.dataset]),
  });
  const policyFor = async (required: ProtectionRequirement): Promise<OwnAccess> => ({
    url: required.acl,
    etag: "",
    dataset: await parseRdf(required.turtle, "text/turtle", { baseIRI: required.acl }),
  });
  const verify = async (url: string, headers: Headers, required: ProtectionRequirement) => {
    const policy = await policyFor(required);
    const own = await access.snapshot(url, headers);
    if (own.status === "none" && !own.demo) {
      await access.install(policy, required.from, url);
    } else if (
      own.status !== "known" ||
      !sameGraph(
        relocate(policy.dataset, [
          [policy.url, own.policy.url],
          [required.from, url],
        ]),
        own.policy.dataset,
      )
    ) {
      throw new DriveAccessError(
        own,
        "This folder still requires protection. Check that pod CORS exposes Link and ETag, then retry.",
      );
    }
    await ledger.clear(url);
  };
  const install = async (url: string, policy: OwnAccess, from: string) => {
    const saved = await access.install(policy, from, url);
    await ledger.clear(url);
    return saved;
  };
  const cleanup = async (url: string, response: Response) => {
    const etag = response.headers.get("etag");
    // Unknown/foreign control documents are not ours to remove with the folder.
    if (etag && (await access.snapshot(url, response.headers)).status !== "unknown")
      await http(url, { method: "DELETE", headers: { "if-match": etag } }).catch(() => undefined);
  };
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
  const guard = async (destination: string, creating = false): Promise<void> => {
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
      containers.unshift(url);
      if (url === storageUrl) break;
      url = parent(url);
    }
    // Decide ALL policies before creating even an empty ancestor.
    const plans: { url: string; policy: OwnAccess; private: boolean }[] = [];
    for (const container of missing) {
      const required = await ledger.get(container);
      const original = required ? await policyFor(required) : await archived(container);
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
        const required = await ledger.get(container);
        if (container === storageUrl && !required) return;
        // A different tab may have created (or removed) this ancestor while we waited.
        const current = await http(container, { method: "HEAD" });
        if (current.ok) {
          if (required) await verify(container, current.headers, required);
          else if (plan) {
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
        if (current.status !== 404 || (!plan && !required))
          throw new DriveAccessError("Ancestor changed before provisioning");
        const policy = required
          ? await policyFor(required)
          : (plan as (typeof plans)[number]).policy;
        const from = required?.from ?? container;
        await ledger.set(container, required ?? (await requirementFor(policy, from)));
        // Conditional creation refuses uncoordinated races; never replace their ACLs.
        const response = await options.putFolder(container);
        try {
          await install(container, policy, from);
        } catch (error) {
          await cleanup(container, response);
          throw error;
        }
        if (plan?.private && !container.includes("/.trash/")) options.onPrivateFolder?.(container);
      });
    }
    // Container metadata writes also need their own protection, not just their parents'.
    // Only the provisioner holding this container's flight may skip its own unfinished ACL.
    if (!creating && destination.endsWith("/")) {
      await provisioning.get(destination);
      await singleFlight(destination, async () => {
        const required = await ledger.get(destination);
        if (required) {
          const response = await http(destination, { method: "HEAD" });
          if (!response.ok) throw new DriveAccessError("Required folder is unavailable");
          await verify(destination, response.headers, required);
        }
      });
    }
  };
  return {
    guard,
    async folder(
      url: string,
      policy?: OwnAccess,
      from = url,
      onCreated?: (response: Response) => void,
    ): Promise<{ response: Response; policy?: OwnAccess }> {
      await guard(url, true);
      let result: { response: Response; policy?: OwnAccess } | undefined;
      await singleFlight(
        url,
        async () => {
          const current = await http(url, { method: "HEAD" });
          const required = await ledger.get(url);
          if (required && current.ok) await verify(url, current.headers, required);
          // A conflict on an already-existing folder is not a failed provisioning
          // flight: concurrent writers may still use its verified protection.
          if (current.ok) return;
          if (current.status !== 404) throw options.error(current.status, url);
          const remembered = required
            ? { policy: await policyFor(required), from: required.from }
            : undefined;
          if (
            remembered &&
            policy &&
            !sameGraph(
              relocate(remembered.policy.dataset, [
                [remembered.policy.url, `${url}.acl`],
                [remembered.from, url],
              ]),
              relocate(policy.dataset, [
                [policy.url, `${url}.acl`],
                [from, url],
              ]),
            )
          )
            throw new DriveAccessError("Folder has a different unfinished protection requirement");
          const creationPolicy = remembered?.policy ?? policy;
          const creationFrom = remembered ? remembered.from : from;
          // Do not record a new policy for a pre-existing folder: the conditional PUT
          // must conflict without changing the protection requirement of another writer.
          if (creationPolicy)
            await ledger.set(url, required ?? (await requirementFor(creationPolicy, creationFrom)));
          const response = await options.putFolder(url);
          onCreated?.(response);
          try {
            const saved = creationPolicy
              ? await install(url, creationPolicy, creationFrom)
              : undefined;
            result = { response, ...(saved ? { policy: saved } : {}) };
          } catch (error) {
            await cleanup(url, response);
            throw error;
          }
        },
        false,
      );
      if (!result) throw options.error(412, url);
      return result;
    },
    async protect(url: string, policy: OwnAccess, from = url): Promise<void> {
      await guard(url, true);
      await singleFlight(
        url,
        async () => {
          await ledger.set(url, await requirementFor(policy, from));
          await install(url, policy, from);
        },
        false,
      );
    },
  };
}
