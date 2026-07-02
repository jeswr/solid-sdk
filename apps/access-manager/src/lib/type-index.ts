// AUTHORED-BY Claude Fable 5
//
// Data-class view: read the profile's solid:publicTypeIndex /
// solid:privateTypeIndex, project their solid:TypeRegistration entries, and
// group walked storage nodes under them — so the user sees "Contacts / Tasks /
// Bookmarks" instead of raw paths (proposal §2.3 resolution rung 2; the
// solid-type-index skill's read pattern). All foreign RDF reads are guarded:
// a malformed registration drops, never aborts the view.

import type { DatasetCore } from "@rdfjs/types";
import { readRdf, type SolidFetch } from "./http.js";
import { objectIri, objectIris, objectLiteral, subjectsOfType, tryRead } from "./rdf.js";
import type { WalkedNode } from "./storage-walk.js";
import { RDFS, SOLID } from "./vocab.js";

export interface TypeRegistration {
  /** The registration node IRI. */
  id: string;
  /** The RDF class registered (solid:forClass). */
  forClass: string;
  /** Containers whose members are instances. */
  instanceContainers: string[];
  /** Directly-registered instance documents. */
  instances: string[];
  /** Which index it came from. */
  visibility: "public" | "private";
  /** rdfs:label when present, else a name derived from the class IRI. */
  label: string;
}

/** Derive a human label from a class IRI tail ("...#Bookmark" → "Bookmark"). */
export function classLabel(classIri: string): string {
  const tail = classIri.split(/[#/]/).filter(Boolean).pop() ?? classIri;
  return tail.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Read both type indexes advertised by the profile (either may be absent). */
export async function readTypeRegistrations(
  webId: string,
  fetchFn: SolidFetch,
): Promise<TypeRegistration[]> {
  const profile = await readRdf(webId, fetchFn);
  if (!profile) return [];
  const out: TypeRegistration[] = [];
  const indexes: { url: string; visibility: "public" | "private" }[] = [];
  const pub = objectIri(profile.dataset, webId, SOLID.publicTypeIndex);
  const priv = objectIri(profile.dataset, webId, SOLID.privateTypeIndex);
  if (pub !== undefined) indexes.push({ url: pub, visibility: "public" });
  if (priv !== undefined) indexes.push({ url: priv, visibility: "private" });

  for (const index of indexes) {
    let read: Awaited<ReturnType<typeof readRdf>>;
    try {
      read = await readRdf(index.url, fetchFn);
    } catch {
      continue; // an unreadable index degrades to "no registrations from it"
    }
    if (!read) continue;
    for (const id of subjectsOfType(read.dataset, SOLID.TypeRegistration)) {
      const forClass = tryRead(() => objectIri(read.dataset, id, SOLID.forClass));
      if (forClass === undefined) continue;
      out.push({
        id,
        forClass,
        instanceContainers: objectIris(read.dataset, id, SOLID.instanceContainer),
        instances: objectIris(read.dataset, id, SOLID.instance),
        visibility: index.visibility,
        label: objectLiteralLabel(read.dataset, id) ?? classLabel(forClass),
      });
    }
  }
  return out;
}

function objectLiteralLabel(dataset: DatasetCore, id: string): string | undefined {
  return tryRead(() => objectLiteral(dataset, id, RDFS.label));
}

export interface DataClassGroup {
  registration: TypeRegistration;
  /** Walked nodes that fall under this class. */
  nodes: WalkedNode[];
}

/** Whether a resource URL falls under a registration. */
export function nodeInRegistration(url: string, reg: TypeRegistration): boolean {
  if (reg.instances.includes(url)) return true;
  return reg.instanceContainers.some((c) => url === c || url.startsWith(c));
}

/**
 * Group walked nodes under their data classes; nodes matching no registration
 * are returned separately as `unclassified`.
 */
export function groupByDataClass(
  nodes: readonly WalkedNode[],
  registrations: readonly TypeRegistration[],
): { groups: DataClassGroup[]; unclassified: WalkedNode[] } {
  const groups: DataClassGroup[] = registrations.map((registration) => ({
    registration,
    nodes: [],
  }));
  const unclassified: WalkedNode[] = [];
  for (const node of nodes) {
    let matched = false;
    for (const group of groups) {
      if (nodeInRegistration(node.url, group.registration)) {
        group.nodes.push(node);
        matched = true;
      }
    }
    if (!matched) unclassified.push(node);
  }
  return { groups: groups.filter((g) => g.nodes.length > 0), unclassified };
}

/**
 * The per-class aggregate access summary ("3 agents can read your Contacts"):
 * the set of non-owner agents (incl. the public/authenticated sentinels)
 * holding each mode anywhere in the class.
 */
export function classAccessSummary(
  group: DataClassGroup,
  ownerWebId: string,
): { agent: string; modes: string[] }[] {
  const agents = new Map<string, Set<string>>();
  for (const node of group.nodes) {
    for (const entry of node.entries) {
      const subjects = [
        ...entry.agents.filter((a) => a !== ownerWebId),
        ...(entry.isPublic ? ["public"] : []),
        ...(entry.isAuthenticated ? ["authenticated"] : []),
      ];
      for (const s of subjects) {
        let modes = agents.get(s);
        if (!modes) {
          modes = new Set();
          agents.set(s, modes);
        }
        for (const m of entry.modes) modes.add(m);
      }
    }
  }
  return [...agents.entries()]
    .map(([agent, modes]) => ({ agent, modes: [...modes].sort() }))
    .sort((a, b) => a.agent.localeCompare(b.agent));
}
