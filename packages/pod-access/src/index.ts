// AUTHORED-BY Codex GPT-6.1-Sol
import { StorageError } from "@jeswr/storage-client";
import { Store } from "n3";
import type { Dataset } from "./rdf.js";
import {
  ACP,
  acpEntries,
  acr,
  addAcp,
  addWac,
  fail,
  MODES,
  revokeAcp,
  revokeWac,
  wacGrants,
} from "./rdf.js";
import type { AccessClient, AccessClientOptions, AccessMode, Grant } from "./types.js";

export type { AccessClient, AccessClientOptions, AccessMode, Grant } from "./types.js";

/** Solid sharing over advertised access documents, with conditional writes and no retries. */
export function createAccessClient({ storage }: AccessClientOptions): AccessClient {
  const model: AccessClient["model"] = () =>
    storage.features.accessControl.state === "available"
      ? storage.features.accessControl.detail.model
      : "none";
  const unsupported = () => fail("unsupported", storage.root);

  function parse<T>(url: string, read: () => T): T {
    try {
      return read();
    } catch (error) {
      if (error instanceof StorageError) throw error;
      return fail("invalid-response", url);
    }
  }

  async function document(url: string, mutate: boolean) {
    const selected = model();
    if (storage.protocol !== "solid" || (selected !== "wac" && selected !== "acp")) unsupported();
    const head = await storage.head(url);
    if (mutate && head.allow !== null && !head.allow.control) {
      throw new StorageError("forbidden", { url: head.url, method: "PUT", status: 403 });
    }
    const rels = selected === "wac" ? ["acl"] : ["acl", `${ACP}accessControl`];
    const links = rels.flatMap((rel) => head.links.get(rel) ?? []);
    if (links.length === 0) return unsupported();
    if (links.length !== 1) fail("invalid-response", head.url);
    const accessUrl = (links[0] as { target: string }).target;
    // StorageClient enforces scope before transport. Do not echo an untrusted link in errors.
    if (!storage.isWithinStorage(accessUrl))
      throw new StorageError("scope", { url: head.url, method: "GET" });
    const read = await storage.readRdf(accessUrl);
    if (read.notModified || [...read.dataset].some((q) => q.graph.termType !== "DefaultGraph"))
      fail("invalid-response", head.url);
    const dataset: Dataset = new Store([...read.dataset]);
    return {
      model: selected,
      target: head.url,
      url: accessUrl,
      dataset,
      etag: read.etag,
      kind: head.kind,
    };
  }

  function validate(grant: Grant): Grant {
    if (grant.purpose !== undefined || grant.expires !== undefined) unsupported();
    if (
      !Array.isArray(grant.modes) ||
      grant.modes.length === 0 ||
      grant.modes.some((mode) => !Object.hasOwn(MODES, mode))
    ) {
      throw new TypeError("A grant requires valid access modes");
    }
    let agent = grant.agent;
    if (typeof agent === "string") validIri(agent);
    else {
      if (agent === null || typeof agent !== "object" || Object.keys(agent).length !== 1)
        throw new TypeError("Invalid grant agent");
      if ("public" in agent && agent.public === true) agent = { public: true };
      else if ("authenticated" in agent && agent.authenticated === true)
        agent = { authenticated: true };
      else if ("group" in agent && typeof agent.group === "string") {
        validIri(agent.group);
        agent = { group: agent.group };
      } else throw new TypeError("Invalid grant agent");
    }
    // Caller ids never overwrite existing rules. Each share creates an independent grant.
    return { agent, modes: [...new Set(grant.modes)] };
  }

  function validIri(value: string) {
    try {
      const parsed = new URL(value);
      if (parsed.username || parsed.password || /[\s\p{Cc}<>"{}|^`\\]/u.test(value))
        throw new Error();
    } catch {
      throw new TypeError("Grant agents must be absolute IRIs without credentials");
    }
  }

  async function write(doc: Awaited<ReturnType<typeof document>>) {
    if (doc.etag === null || doc.etag.trim() === "" || doc.etag === "*") {
      throw new StorageError("precondition-required", { url: doc.url, method: "PUT", status: 428 });
    }
    await storage.writeRdf(doc.url, doc.dataset, { ifMatch: doc.etag });
  }

  return {
    model,
    async effective(url) {
      if (storage.protocol !== "solid") unsupported();
      const { allow } = await storage.head(url);
      return allow === null
        ? null
        : { me: (Object.keys(MODES) as AccessMode[]).filter((mode) => allow[mode]), public: [] };
    },
    async grants(url) {
      const doc = await document(url, false);
      return parse(doc.url, () =>
        doc.model === "wac"
          ? wacGrants(doc.dataset, doc.target, doc.url)
          : acpEntries(acr(doc.dataset, doc.target, doc.url), doc.url).map(({ grant }) => grant),
      );
    },
    async share(url, grant, opts) {
      const value = validate(grant);
      const inherit = opts.inherit === true;
      if (model() === "acp" && typeof value.agent !== "string" && "group" in value.agent)
        unsupported();
      if (
        model() === "acp" &&
        typeof value.agent === "string" &&
        ["PublicAgent", "AuthenticatedAgent", "OwnerAgent", "CreatorAgent"].some(
          (name) => value.agent === `${ACP}${name}`,
        )
      )
        unsupported();
      const doc = await document(url, true);
      if (inherit && doc.kind !== "container")
        throw new TypeError("Inheritance requires a container");
      const id = `${doc.url}#grant-${crypto.randomUUID()}`;
      parse(doc.url, () => {
        if (doc.model === "wac") addWac(doc.dataset, doc.target, value, inherit, id);
        else addAcp(acr(doc.dataset, doc.target, doc.url), doc.target, value, inherit, id);
      });
      await write(doc);
      return { ...value, id };
    },
    async revoke(url, key) {
      const doc = await document(url, true);
      const changed = parse(doc.url, () =>
        doc.model === "wac"
          ? revokeWac(doc.dataset, doc.target, key, doc.url)
          : revokeAcp(acr(doc.dataset, doc.target, doc.url), key, doc.url),
      );
      if (changed) await write(doc);
    },
  };
}
