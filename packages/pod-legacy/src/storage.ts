// AUTHORED-BY Codex GPT-6.1-Sol
import { readWac, scopePolicy } from "@jeswr/pod-access";
import { readGrants } from "@jeswr/pod-access/roles";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { parsePlan, serializePlan } from "./model.js";
import { isWebId, type LegacyPlan } from "./plan.js";

export class LegacyPrivacyError extends Error {
  constructor() {
    super(
      "Legacy plans must be readable and writable by you alone. Make settings private, then try again. Privacy could not be verified.",
    );
    this.name = "LegacyPrivacyError";
  }
}
export interface LegacySnapshot {
  /** null denotes a verified empty placeholder, which can be filled with this ETag. */
  plan: LegacyPlan | null;
  etag: string;
}
const missing = (error: unknown) => error instanceof StorageError && error.code === "not-found";
function strong(etag: string | null): string {
  if (!etag || !/^"[^"\r\n]+"$/.test(etag))
    throw new Error("A strong ETag is required to save a legacy plan");
  return etag;
}

/** WAC only in this slice: unknown, ACP, LWS and unrepresentable access all refuse. No ACL edits. */
export function createLegacyStore(options: {
  storage: StorageClient;
  owner: string;
  fetch: typeof globalThis.fetch;
}) {
  const { storage, owner, fetch } = options;
  const root = storage.root;
  if (!isWebId(owner) || !root.endsWith("/") || !isWebId(root))
    throw new TypeError("An owner WebID and HTTPS storage root are required");
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
  const load = async (): Promise<LegacySnapshot | null> => {
    let read: Awaited<ReturnType<StorageClient["read"]>>;
    try {
      read = await storage.read(url, { accept: "text/turtle, application/ld+json;q=0.9" });
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    // Probe at most the first nonempty chunk; do not buffer an unbounded raw body.
    const reader = read.body?.getReader();
    let empty = true;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.length) {
            empty = false;
            break;
          }
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
    }
    await privacy();
    const etag = strong(read.etag);
    if (empty) return { plan: null, etag };
    // Keep parsing on the public storage RDF path, and tie both observations to one version.
    const rdf = await storage.readRdf(url);
    if (rdf.etag !== etag) throw new Error("The legacy plan changed. Reload before saving.");
    const plan = parsePlan(url, rdf.dataset);
    if (!plan || plan.owner !== owner || plan.storage !== root)
      throw new Error("The saved legacy plan is invalid. Nothing will be shared.");
    return { plan, etag };
  };
  return {
    url,
    load,
    async delete(expectedEtag: string): Promise<void> {
      const etag = strong(expectedEtag);
      await privacy();
      await storage.delete(url, { ifMatch: etag });
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
        const created = await storage.create(settings, null, {
          contentType: "text/turtle",
          name: "legacy-plan.ttl",
        });
        if (created.url !== url) throw new LegacyPrivacyError();
        const empty = await storage.read(url);
        if ((await empty.bytes()).length !== 0)
          throw new Error("The legacy plan changed. Reload before saving.");
        etag = strong(empty.etag);
      } else etag = strong(expectedEtag);
      await privacy();
      const result = await storage.write(url, body, { contentType: "text/turtle", ifMatch: etag });
      if (result.etagSource === "response" && result.etag) {
        // A weak validator is no more usable than an absent one.
        if (/^"[^"\r\n]+"$/.test(result.etag)) return { plan: snapshot, etag: result.etag };
      }
      const reloaded = await load();
      if (!reloaded?.plan) throw new Error("The legacy plan changed. Reload before saving.");
      return { ...reloaded, plan: reloaded.plan };
    },
  };
}
