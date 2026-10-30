// AUTHORED-BY Codex
import { fetchRdf, parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import { Store } from "n3";
import { trashEntries, trashIndexFrom } from "../operations/trash-index";
import {
  type AccessWriteGuard,
  type accessControl,
  accessGains,
  bindAccess,
  DriveAccessChangedError,
  DriveAccessError,
  type OwnAccess,
  ownAccessGuards,
  privateAcl,
  requireAccess,
} from "./access";
import { discardVersion, ownsEmptyContainer } from "./cleanup";
import {
  type CommitChecks,
  type CommitEffects,
  Compensation,
  checkIdentity,
  commitIrreversible,
} from "./commit";
import { rethrowPendingDeletion } from "./deletion";
import { type ProtectionRequirement, protectionLedger } from "./protection-ledger";
import { sameGraph } from "./rdf";

// Shared by all clients in this tab, including the fresh client used by undo.
const provisioning = new Map<string, Promise<void>>();

function singleFlight(url: string, work: () => Promise<void>, join = true): Promise<void> {
  const current = provisioning.get(url);
  if (current) return join ? current : current.then(() => singleFlight(url, work, false));
  // Publish before the first request, and retain failures through empty-resource cleanup.
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

/** Every container creation must make an explicit access decision. */
export type ContainerPolicy =
  | { readonly kind: "inherit-verified"; readonly original?: OwnAccess }
  | { readonly kind: "archived"; readonly acl: OwnAccess; readonly from: string }
  | { readonly kind: "owner-only"; readonly webId?: string | undefined };

export function requirePolicy(
  policy: { readonly kind: string } | undefined,
  kinds: readonly string[],
): void {
  if (!policy || !kinds.includes(policy.kind))
    throw new DriveAccessError(undefined, "Explicit container policy required");
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
  deleteVersion: (
    url: string,
    etag: string,
    checks: CommitChecks & { readonly verifyHeaders: NonNullable<CommitChecks["verifyHeaders"]> },
  ) => Promise<void>;
  onPrivateFolder?: (url: string) => void;
  onProtectionChange?: (url: string) => void;
}) {
  const { http, storageUrl, access } = options;
  const ledger = protectionLedger(http);
  const requirementFor = async (
    policy: OwnAccess,
    from: string,
  ): Promise<ProtectionRequirement> => ({
    acl: policy.url,
    from,
    turtle: await serialize([...access.materialize(policy, from).dataset]),
  });
  const policyFor = async (required: ProtectionRequirement): Promise<OwnAccess> => ({
    url: required.acl,
    etag: "",
    dataset: await parseRdf(required.turtle, "text/turtle", { baseIRI: required.acl }),
  });
  const checkProtection = async (
    url: string,
    policy: OwnAccess,
    etag: string,
    verifyResourceHeaders: NonNullable<CommitChecks["verifyHeaders"]>,
  ) => {
    await access.checkOwn({ url: policy.url, policy });
    const { verifyResourceTransition: _transition, ...original } = policy;
    let checked: OwnAccess = original;
    await checkIdentity(http, url, etag, options.error, false, (headers) => {
      access.verifyEndpoint(url, headers, {
        url: policy.url,
        verifyResourceHeaders,
      });
      checked = { ...original, verifyResourceHeaders: access.captureEndpoint(url, headers) };
    });
    return checked;
  };
  const retireProtection = async (
    url: string,
    policy: OwnAccess,
    etag: string,
    verifyResourceHeaders: NonNullable<CommitChecks["verifyHeaders"]>,
  ) => {
    // Retain the policy actually installed, including any safe intersection
    // with narrower current grants, rather than the broader requested policy.
    const required = {
      ...(await requirementFor(policy, url)),
      etag,
      ownAcl: { url: policy.url, etag: policy.etag },
    };
    await ledger.clear(url);
    try {
      return await checkProtection(url, policy, etag, verifyResourceHeaders);
    } catch (cause) {
      // A failed retirement check must still block later reads and writes.
      await ledger.set(url, required);
      throw cause;
    }
  };
  const verify = async (url: string, headers: Headers, required: ProtectionRequirement) => {
    if (required.etag && headers.get("etag") !== required.etag)
      throw new DriveAccessError("Required resource changed");
    const policy = await policyFor(required);
    const own = await access.snapshot(url, headers);
    if (
      required.ownAcl &&
      (own.own?.url !== required.ownAcl.url ||
        (own.own.policy?.etag ?? null) !== required.ownAcl.etag)
    )
      throw new DriveAccessChangedError(["The item's own ACL changed"]);
    if (own.status === "none" && !own.demo) {
      // A requirement written before a refused creation owns no representation.
      // Its later appearance must not authorize applying the intended ACL.
      if (!required.etag) throw new DriveAccessError("Protection receipt unavailable");
      if (!required.ownAcl) throw new DriveAccessError("Own ACL receipt unavailable");
      await install(url, policy, required.from, {
        identity: { url, etag: required.etag, verifyHeaders: access.captureEndpoint(url, headers) },
        restrict: true,
        knownAcl: required.ownAcl.url,
        expectedAcl: null,
      });
      return;
    }
    if (
      own.status !== "known" ||
      !sameGraph(
        access.retarget(policy, required.from, url, own.policy.url).dataset,
        own.policy.dataset,
      )
    ) {
      throw new DriveAccessError(
        own,
        `This ${url.endsWith("/") ? "folder" : "file"} still requires protection. Check that pod CORS exposes Link and ETag, then retry.`,
      );
    }
    await retireProtection(
      url,
      own.policy,
      headers.get("etag") ?? "",
      access.captureEndpoint(url, headers),
    );
  };
  const install = async (url: string, policy: OwnAccess, from: string, guard: AccessWriteGuard) => {
    const saved = await access.install(policy, from, url, guard, async (written) => {
      await ledger.set(url, {
        ...(await requirementFor(written, url)),
        etag: guard.identity.etag,
        ownAcl: { url: written.url, etag: written.etag },
      });
    });
    return retireProtection(url, saved, guard.identity.etag, saved.verifyResourceTransition);
  };
  const cleanup = async (url: string, response: Response, installed?: OwnAccess) => {
    const etag = response.headers.get("etag");
    // Unknown/foreign control documents are not ours to remove with the resource.
    if (etag && (await access.snapshot(url, response.headers)).status !== "unknown") {
      const endpoint = access.discover(url, response.headers);
      try {
        await access.checkOwn(endpoint ? { url: endpoint, policy: installed ?? null } : undefined);
      } catch {
        return;
      } // Deleting the resource would also delete another writer's ACL.
      const verifyCaptured =
        installed?.verifyResourceHeaders ?? access.captureEndpoint(url, response.headers);
      const empty = new Store();
      await discardVersion<Store | string>({
        url,
        captured: { content: url.endsWith("/") ? empty : "", etag },
        read: async () => {
          if (url.endsWith("/")) {
            const current = await fetchRdf(url, { fetch: http });
            return { content: current.dataset, etag: current.etag ?? undefined };
          }
          const current = await http(url);
          if (!current.ok) throw options.error(current.status, url);
          return { content: await current.text(), etag: current.headers.get("etag") ?? undefined };
        },
        owns: (content) =>
          typeof content === "string" ? content === "" : ownsEmptyContainer(url, empty, content),
        remove: (validator) =>
          options.deleteVersion(url, validator, {
            verifyHeaders: (headers) => {
              verifyCaptured(headers);
              return access.verifyEndpoint(url, headers, endpoint ? { url: endpoint } : undefined);
            },
            policyGuards: ownAccessGuards(
              endpoint ? { url: endpoint, policy: installed ?? null } : undefined,
            ),
          }),
      }).catch(rethrowPendingDeletion);
    }
  };
  // The sole raw creation seam, private to the provisioner. Callers hold this
  // resource's flight and must supply either verified inheritance or an ACL.
  const create = async (
    url: string,
    decision: Exclude<ContainerPolicy, { kind: "owner-only" }>,
    onCreated?: (response: Response) => void,
    put = () => options.putFolder(url),
    verifyAccess?: () => Promise<void>,
    effects: CommitEffects = {},
  ): Promise<{ response: Response; policy?: OwnAccess }> => {
    const binding = await bindAccess(access, url, url, true);
    // An orphan ACL is not inherited creation access, even when a 404 exposes
    // its Link. Never adopt it as permission to populate a newly minted item.
    if (binding.destinationOwn?.policy)
      throw new DriveAccessError(
        "Own ACL already exists",
        "An access policy already exists for this new item. Choose another name or review its sharing before retrying.",
      );
    let response: Response;
    let installed: OwnAccess | undefined;
    const compensation = new Compensation(() =>
      binding.rollback(() => cleanup(url, response, installed)),
    );
    try {
      if (decision.kind === "archived")
        await ledger.set(url, await requirementFor(decision.acl, decision.from));
      response = await commitIrreversible({
        ...effects,
        arm: [compensation, ...(effects.arm ?? [])],
        rechecks: [
          async () => {
            await verifyAccess?.();
            await binding.recheck();
          },
        ],
        step: put,
      });
      access.recordCreation(url, response.headers);
      onCreated?.(response);
      try {
        if (decision.kind === "archived") {
          const endpoint = access.discover(url, response.headers);
          await ledger.set(url, {
            ...(await requirementFor(decision.acl, decision.from)),
            etag: response.headers.get("etag") ?? "",
            ...(endpoint ? { ownAcl: { url: endpoint, etag: null } } : {}),
          });
        }
        await verifyAccess?.();
        await binding.recheck();
        const policy =
          decision.kind === "archived"
            ? await install(url, decision.acl, decision.from, {
                identity: {
                  url,
                  etag: response.headers.get("etag") ?? "",
                  verifyHeaders: (headers) => {
                    binding.verifyEndpoint(url, headers);
                    return undefined;
                  },
                },
                knownAcl: binding.destinationOwn?.url,
                expectedAcl: null,
                policyGuards: binding.identities,
              })
            : undefined;
        if (policy) {
          installed = policy;
          binding.installed(policy);
        }
        await binding.recheck();
        compensation.disarm();
        return { response, ...(policy ? { policy } : {}) };
      } catch (error) {
        await compensation.rollback();
        throw error;
      }
    } finally {
      // Failed cleanup can leave an item even when the operation reports failure.
      options.onProtectionChange?.(url);
    }
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
  const guard = async (
    destination: string,
    creating = false,
    allowAbsent = false,
  ): Promise<void> => {
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
                access.retarget(plan.policy, container, container, own.policy.url).dataset,
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
        // Conditional creation refuses uncoordinated races; never replace their ACLs.
        await create(container, { kind: "archived", acl: policy, from });
        if (plan?.private && !container.includes("/.trash/")) options.onPrivateFolder?.(container);
      });
    }
    // Only the provisioner holding this resource's flight may skip its own requirement.
    if (!creating) await check(destination, allowAbsent);
  };
  const check = async (url: string, allowAbsent = false): Promise<void> => {
    try {
      await provisioning.get(url);
      await singleFlight(url, async () => {
        const required = await ledger.get(url);
        if (required) {
          const response = await http(url, { method: "HEAD" });
          // Only a conditional create may start a fresh flight at a vacant URL.
          // Reads and replacements must still refuse unavailable protection.
          if (response.status === 404 && allowAbsent) {
            await ledger.clear(url);
            return;
          }
          if (!response.ok) throw new DriveAccessError("Required resource is unavailable");
          await verify(url, response.headers, required);
        }
      });
    } catch (cause) {
      if (url.endsWith("/")) throw cause;
      throw new DriveAccessError(
        cause,
        "This file's sharing could not be secured — Retry / Delete",
      );
    }
  };
  const resource = async (
    url: string,
    decision: ContainerPolicy,
    onCreated?: (response: Response) => void,
    put?: () => Promise<Response>,
    verifyAccess?: () => Promise<void>,
    effects?: CommitEffects,
  ): Promise<{ response: Response; policy?: OwnAccess }> => {
    requirePolicy(decision, ["inherit-verified", "archived", "owner-only"]);
    const from = decision.kind === "archived" ? decision.from : url;
    await guard(url, true);
    // Archive discovery may read this very URL (the Trash index). Hydrate it
    // before publishing our flight: guarded reads must never await their own
    // unfinished placeholder. Keep the captured policy through the flight.
    const original =
      decision.kind === "inherit-verified"
        ? (decision.original ?? (await archived(url)))
        : decision.kind === "archived" && url.endsWith("/")
          ? await archived(url)
          : undefined;
    let result: { response: Response; policy?: OwnAccess } | undefined;
    await singleFlight(
      url,
      async () => {
        const current = await http(url, { method: "HEAD" });
        const required = await ledger.get(url);
        if (required && current.ok) await verify(url, current.headers, required);
        // A conflict on an already-existing resource is not a failed provisioning
        // flight: concurrent writers may still use its verified protection.
        if (current.ok) return;
        if (current.status !== 404) throw options.error(current.status, url);
        // The old requirement belongs to a removed resource. This flight will
        // commit its own policy before its conditional placeholder PUT.
        if (required) await ledger.clear(url);
        let policy: OwnAccess | undefined;
        if (decision.kind === "archived") policy = decision.acl;
        else if (decision.kind === "owner-only") {
          const webId = decision.webId ?? options.owner();
          if (!webId) throw new DriveAccessError("Owner WebID unavailable");
          policy = { url: `${url}.acl`, etag: "", dataset: privateAcl(url, webId) };
        } else if (current.headers.get("x-solid-demo-access-control") !== "none") {
          // A reappearing historical folder has an original audience. Only omit
          // its ledger when current inheritance is verified to be no wider.
          const inherited = requireAccess(await access.effective(url, true), url);
          if (original && accessGains(access.forResource(original, url), inherited).length)
            policy = original;
        }
        if (decision.kind === "archived" && url.endsWith("/")) {
          // Clearing a completed flight does not discard the historical folder
          // audience recorded in Trash. A different copy may not widen it.
          if (
            original &&
            accessGains(access.forResource(original, url), access.forResource(decision.acl, from))
              .length
          )
            throw new DriveAccessError("Historical folder grants narrower access");
        }
        // Do not record a new policy for a pre-existing resource: the conditional PUT
        // must conflict without changing the protection requirement of another writer.
        result = await create(
          url,
          policy ? { kind: "archived", acl: policy, from } : { kind: "inherit-verified" },
          onCreated,
          put,
          verifyAccess,
          effects,
        );
      },
      false,
    );
    if (!result) throw options.error(412, url);
    return result;
  };
  return {
    guard,
    check,
    folder: resource,
    file: (
      url: string,
      policy: OwnAccess | undefined,
      from: string,
      put: () => Promise<Response>,
      onCreated: (response: Response) => void,
      verifyAccess?: () => Promise<void>,
      effects?: CommitEffects,
    ) =>
      resource(
        url,
        policy ? { kind: "archived", acl: policy, from } : { kind: "inherit-verified" },
        onCreated,
        put,
        verifyAccess,
        effects,
      ),
    async protect(
      url: string,
      policy: OwnAccess,
      from: string,
      protectionGuard: AccessWriteGuard & { readonly expectedAcl: OwnAccess | null },
    ): Promise<OwnAccess> {
      // Callers hydrate the complete receipt before entering this flight. A
      // missing receipt cannot authorize discovering a new compensation target.
      const endpoint = protectionGuard.knownAcl;
      if (!endpoint) throw new DriveAccessError("ACL endpoint unavailable");
      if (protectionGuard.expectedAcl === undefined)
        throw new DriveAccessError("Own ACL receipt unavailable");
      await guard(url, true);
      let saved = policy;
      await singleFlight(
        url,
        async () => {
          await ledger.set(url, {
            ...(await requirementFor(policy, from)),
            etag: protectionGuard.identity.etag,
            ownAcl: { url: endpoint, etag: protectionGuard.expectedAcl?.etag ?? null },
          });
          saved = await install(url, policy, from, {
            ...protectionGuard,
            knownAcl: endpoint,
            expectedAcl: protectionGuard.expectedAcl,
          });
        },
        false,
      );
      return saved;
    },
  };
}
