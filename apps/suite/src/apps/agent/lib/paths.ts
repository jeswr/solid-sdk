// AUTHORED-BY Codex GPT-6.1-Sol
import { type DatasetCore, parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, createPodScopedFetch, normalizePodBase } from "@jeswr/guarded-fetch";
import {
  DatasetWrapper,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";

import type { PodSession } from "../../../lib/session/pod-session";
import { readRdfDocument } from "./rdf";

export const AGENT = "https://jeswr.org/ns/agent#";
export const SOLID = "http://www.w3.org/ns/solid/terms#";
export const PROV = "http://www.w3.org/ns/prov#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** Typed accessors for the daemon's small metadata documents. */
export class AgentNode extends TermWrapper {
  iris(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  iri(predicate: string) {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
  text(predicate: string) {
    return OptionalFrom.subjectPredicate(this, predicate, LiteralAs.string);
  }
  setIri(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  setText(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
}
class TypeIndex extends DatasetWrapper {
  get registrations() {
    return this.instancesOf(`${SOLID}TypeRegistration`, AgentNode);
  }
}
export const metadataNode = (dataset: DatasetCore, id: string) =>
  new AgentNode(id, dataset, DataFactory);

export function guardSlug(slug: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(slug) || slug.includes("..") || slug === ".")
    throw new Error("Invalid resource identifier");
  return slug;
}
export function resourceSlug(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    const path = parsed.pathname.replace(/\/$/, "");
    return guardSlug(path.slice(path.lastIndexOf("/") + 1).replace(/\.(ttl|trig)$/, ""));
  } catch {
    return undefined;
  }
}
export function agentPaths(workspace: string) {
  const base = normalizePodBase(workspace);
  const at = (path: string) => assertWithinPodScope(base, new URL(path, base).href);
  const paths = {
    accounts: at("accounts/"),
    descriptors: at("descriptors/"),
    inbox: at("inbox/"),
    conversations: at("conversations/"),
    proposals: at("proposals/"),
    approvals: at("approvals/"),
    mandates: at("mandates/"),
    mandatesCurrent: at("mandates/current.ttl"),
    mandatesStatus: at("mandates/status.ttl"),
    control: at("control/"),
    heartbeat: at("control/heartbeat.ttl"),
    outbox: at("outbox/"),
    audit: at("audit/"),
    auditChain: at("audit/chain.ttl"),
    memory: at("memory/"),
  };
  return {
    ...paths,
    resolveSlug(kind: "conversations" | "proposals" | "approvals" | "accounts", slug: string) {
      return assertWithinPodScope(
        base,
        `${paths[kind]}${guardSlug(slug)}${kind === "conversations" ? "/" : ".ttl"}`,
      );
    },
  };
}

/** Discovery only reads the selected pod; a poisoned registration never releases fetch. */
export async function discoverWorkspace(
  io: PodSession["fetch"],
  webId: string,
  selectedStorage?: string,
): Promise<string> {
  const profileUrl = new URL(webId);
  profileUrl.hash = "";
  const initialScope = selectedStorage ?? new URL("/", profileUrl).href;
  const scoped = createPodScopedFetch(initialScope, { fetch: io, maxRedirects: 0 });
  const get = async (url: string) => {
    const response = await scoped(assertWithinPodScope(initialScope, url), {
      headers: { accept: "text/turtle" },
    });
    if (!response.ok) throw new Error(`Workspace discovery failed (${response.status})`);
    const doc = await readRdfDocument(response);
    return parseRdf(doc.text, doc.contentType, { baseIRI: url });
  };
  const profile = await get(profileUrl.href);
  const storages = [...new Agent(webId, profile, DataFactory).storageUrls];
  const storage = selectedStorage ?? (storages.length === 1 ? storages[0] : undefined);
  if (!storage || !storages.includes(storage)) throw new Error("Choose a storage for your agent");
  assertWithinPodScope(storage, profileUrl.href);
  const owner = metadataNode(profile, webId);
  let index = owner.iri(`${SOLID}privateTypeIndex`);
  if (!index) {
    const preferences = owner.iri("http://www.w3.org/ns/pim/space#preferencesFile");
    if (preferences)
      index = metadataNode(await get(assertWithinPodScope(storage, preferences)), webId).iri(
        `${SOLID}privateTypeIndex`,
      );
  }
  if (index) {
    const indexUrl = assertWithinPodScope(storage, index);
    const entries = new TypeIndex(await get(indexUrl), DataFactory);
    for (const registration of entries.registrations) {
      if (!registration.iris(`${SOLID}forClass`).has(`${AGENT}AgentWorkspace`)) continue;
      const instance = registration.iri(`${SOLID}instance`);
      if (instance) return normalizePodBase(assertWithinPodScope(storage, instance));
    }
  }
  return assertWithinPodScope(storage, new URL("agent/", normalizePodBase(storage)).href);
}
