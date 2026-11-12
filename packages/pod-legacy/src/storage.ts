// AUTHORED-BY Codex GPT-6.1-Sol
import { readWac, scopePolicy } from "@jeswr/pod-access";
import { readGrants } from "@jeswr/pod-access/roles";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { parsePlan, serializePlan } from "./model.js";
import { clampStoredTimes, isWebId, type LegacyPlan, samePlan } from "./plan.js";

export class LegacyPrivacyError extends Error {
  /**
   * Set only by `load()` when the plan resource exists with a strong ETag. Deleting that exact
   * resource discloses nothing, so a caller may offer a conditional `delete(etag)`.
   */
  readonly etag: string | undefined;
  constructor(etag?: string) {
    super(
      "Legacy plans must be readable and writable by you alone. Make settings private, then try again. Privacy could not be verified.",
    );
    this.name = "LegacyPrivacyError";
    this.etag = etag;
  }
}
export interface LegacySnapshot {
  /**
   * null denotes either a verified empty placeholder or, with `invalid`, a private resource
   * whose content is not a valid plan. Either can be replaced or deleted with this ETag.
   */
  plan: LegacyPlan | null;
  etag: string;
  /** The resource is private but not a valid plan. Nothing is evaluated or shared. */
  invalid?: true;
}
const missing = (error: unknown) => error instanceof StorageError && error.code === "not-found";
const isStrong = (etag: string | null): etag is string => !!etag && /^"[^"\r\n]+"$/.test(etag);
function strong(etag: string | null): string {
  if (!isStrong(etag)) throw new Error("A strong ETag is required to save a legacy plan");
  return etag;
}
/**
 * Only a complete 200 response with a present body that yields no bytes is a placeholder. A null
 * body (304, HEAD-like shims) proves nothing about the content and is refused. Probes at most the
 * first nonempty chunk; never buffers an unbounded raw body.
 */
async function emptyBody(read: Awaited<ReturnType<StorageClient["read"]>>): Promise<boolean> {
  const reader = read.body?.getReader();
  try {
    if (read.status !== 200 || !reader)
      throw new Error("The legacy plan could not be read completely. Reload before saving.");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;
      if (value.length) return false;
    }
  } finally {
    void reader?.cancel().catch(() => {});
  }
}

export class LegacyStorageRootError extends Error {
  constructor() {
    super(
      "Your pod's storage root could not be confirmed, so your legacy plan was not read or changed.",
    );
    this.name = "LegacyStorageRootError";
  }
}

/**
 * WAC only in this slice: unknown, ACP, LWS and unrepresentable access all refuse. No ACL edits.
 *
 * `expectedRoot` is the account's own storage root (e.g. its WebID profile's pim:storage). A
 * resolved root that differs — such as an `assumed-origin-root` fallback when the pod root does
 * not advertise pim:Storage — may belong to someone else, so construction refuses before any
 * request: nothing is read, written or deleted. `now` supplies the caller's bounded clock for the
 * stored-time clamp when no Last-Modified is available.
 */
export function createLegacyStore(options: {
  storage: StorageClient;
  owner: string;
  fetch: typeof globalThis.fetch;
  expectedRoot: string;
  now?: () => Date;
}) {
  const { storage, owner, fetch, now = () => new Date() } = options;
  const root = storage.root;
  if (!isWebId(owner) || !root.endsWith("/") || !isWebId(root))
    throw new TypeError("An owner WebID and HTTPS storage root are required");
  if (!isWebId(options.expectedRoot) || new URL(options.expectedRoot).href !== root)
    throw new LegacyStorageRootError();
  const settings = new URL("settings/", root).href;
  const url = new URL("legacy-plan.ttl", settings).href;
  const privacy = async (target = url, members = false) => {
    try {
      if (storage.protocol !== "solid") throw new LegacyPrivacyError();
      // Pins the model and rejects mixed/conditional/unknown interpretations before a WAC proof.
      await readGrants(target, {
        fetch,
        root,
        model: "wac",
        ...(members ? { kind: "folder" as const } : {}),
      });
      let resource = target;
      for (let depth = 0; depth < 64; depth++) {
        const head = await storage.head(resource);
        const links = head.links.get("acl");
        if (links?.length !== 1) throw new LegacyPrivacyError();
        const acl = links[0] as NonNullable<(typeof links)[number]>;
        if (
          !storage.isWithinStorage(acl.target) ||
          new URL(acl.target).search ||
          new URL(acl.target).hash
        )
          throw new LegacyPrivacyError();
        try {
          const read = await storage.readRdf(acl.target);
          strong(read.etag);
          const policy = scopePolicy(
            readWac(read.dataset, resource, acl.target, "css", true),
            resource === target && !members ? "resource" : "members",
          );
          // Check every mode, including partial Write/Control grants hidden by role projection.
          if (
            !policy.grants.length ||
            policy.denials.length ||
            policy.grants.some(
              (grant) =>
                grant.except.length > 0 ||
                grant.who.length === 0 ||
                grant.who.some(
                  (clause) =>
                    clause.length !== 1 || clause[0]?.kind !== "agent" || clause[0].webId !== owner,
                ),
            )
          )
            throw new LegacyPrivacyError();
          const modes = new Set(policy.grants.flatMap((grant) => [...grant.modes]));
          if (
            !["read", "write", "control"].every((mode) =>
              modes.has(mode as "read" | "write" | "control"),
            )
          )
            throw new LegacyPrivacyError();
          return;
        } catch (error) {
          if (!missing(error)) throw error;
        }
        if (resource === root) throw new LegacyPrivacyError();
        const parent = new URL(resource.endsWith("/") ? "../" : "./", resource).href;
        if (!storage.isWithinStorage(parent) || parent === resource) throw new LegacyPrivacyError();
        resource = parent;
      }
      throw new LegacyPrivacyError();
    } catch {
      throw new LegacyPrivacyError();
    }
  };
  /** The plan resource and the settings folder itself (not only its members) must be private. */
  const verify = async () => {
    await privacy(settings);
    await privacy();
  };
  const load = async (): Promise<LegacySnapshot | null> => {
    let read: Awaited<ReturnType<StorageClient["read"]>>;
    try {
      read = await storage.read(url, { accept: "text/turtle, application/ld+json;q=0.9" });
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    const empty = await emptyBody(read);
    try {
      await verify();
    } catch {
      // Deletion discloses nothing, so expose the exact version for a conditional delete only.
      throw new LegacyPrivacyError(isStrong(read.etag) ? read.etag : undefined);
    }
    const etag = strong(read.etag);
    if (empty) return { plan: null, etag };
    // Keep parsing on the public storage RDF path, and tie both observations to one version.
    let rdf: Awaited<ReturnType<StorageClient["readRdf"]>>;
    try {
      rdf = await storage.readRdf(url);
    } catch (error) {
      if (error instanceof StorageError && error.code === "not-rdf")
        return { plan: null, etag, invalid: true };
      throw error;
    }
    if (rdf.etag !== etag) throw new Error("The legacy plan changed. Reload before saving.");
    const parsed = parsePlan(url, rdf.dataset);
    if (!parsed || parsed.owner !== owner || parsed.storage !== root)
      return { plan: null, etag, invalid: true };
    return { plan: clampStoredTimes(parsed, read.lastModified, now()), etag };
  };
  return {
    url,
    load,
    /**
     * Conditionally removes exactly the plan resource. No privacy proof is required: deleting
     * discloses nothing, and a plan on a pod that fails the proof must still be removable.
     */
    async delete(expectedEtag: string): Promise<void> {
      await storage.delete(url, { ifMatch: strong(expectedEtag) });
    },
    async save(
      plan: LegacyPlan,
      expectedEtag: string | null,
    ): Promise<LegacySnapshot & { plan: LegacyPlan }> {
      if (plan.owner !== owner || plan.storage !== root)
        throw new TypeError("The plan belongs to another owner or storage");
      // Snapshot and validate before awaiting anything. No mutable input survives into the write.
      const snapshot = structuredClone(plan);
      const body = await serializePlan(url, snapshot);
      let etag: string;
      if (expectedEtag === null) {
        if (storage.protocol !== "solid") throw new LegacyPrivacyError();
        try {
          await storage.head(settings);
        } catch (error) {
          if (!missing(error)) throw error;
          const created = await storage.create(root, null, { kind: "container", name: "settings" });
          if (created.url !== settings) throw new LegacyPrivacyError();
        }
        // Refuse unsafe inherited access before leaving a plan placeholder behind.
        await privacy(settings, true);
        await privacy(settings);
        const created = await storage.create(settings, null, {
          contentType: "text/turtle",
          name: "legacy-plan.ttl",
        });
        if (created.url !== url) throw new LegacyPrivacyError();
        const empty = await storage.read(url);
        if (!(await emptyBody(empty)))
          throw new Error("The legacy plan changed. Reload before saving.");
        etag = strong(empty.etag);
      } else etag = strong(expectedEtag);
      await verify();
      const result = await storage.write(url, body, { contentType: "text/turtle", ifMatch: etag });
      if (result.etagSource === "response" && result.etag) {
        // A weak validator is no more usable than an absent one.
        // Keep the same stored-time bound a later load would apply (no Last-Modified here).
        if (/^"[^"\r\n]+"$/.test(result.etag))
          return { plan: clampStoredTimes(snapshot, null, now()), etag: result.etag };
      }
      // Without a validator for our own write, the reload may observe another writer's version.
      // Timestamps may differ (a later heartbeat, or the load-time clamp); content must not.
      const reloaded = await load();
      if (!reloaded?.plan || !samePlan(reloaded.plan, snapshot, { ignoreTimes: true }))
        throw new Error(
          "The legacy plan was changed in another tab or device. Reload, review it, and save again.",
        );
      return { ...reloaded, plan: reloaded.plan };
    },
  };
}
