// AUTHORED-BY Codex
import { type DatasetCore, fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { DatasetWrapper, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { parentOf } from "./client";

const OWNER = "http://www.w3.org/ns/solid/terms#owner";
const STORAGE = "http://www.w3.org/ns/pim/space#storage";
const DESCRIPTION = "http://www.w3.org/ns/solid/terms#storageDescription";

export function isOwnStorage(url: string, storageUrl: string): boolean {
  try {
    assertWithinPodScope(storageUrl, new URL(url).href);
    return true;
  } catch {
    return false;
  }
}

export interface ItemOwner {
  readonly webId: string;
  readonly label: string;
}
class StorageProfile extends Agent {
  get storages(): string[] {
    return [...SetFrom.subjectPredicate(this, STORAGE, TermAs.term, TermFrom.itself)]
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value);
  }
  private literalName(predicate: string): string | undefined {
    for (const term of SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself))
      if (term.termType === "Literal") return term.value;
    return undefined;
  }
  override get vcardFn() {
    return this.literalName("http://www.w3.org/2006/vcard/ns#fn");
  }
  override get foafName() {
    return this.literalName("http://xmlns.com/foaf/0.1/name");
  }
}
class StorageRoot extends TermWrapper {
  get owners() {
    return [...SetFrom.subjectPredicate(this, OWNER, TermAs.term, TermFrom.itself)].filter(
      (term) => term.termType === "NamedNode",
    );
  }
}
function profileName(agent: StorageProfile): string | undefined {
  return agent.vcardFn ?? agent.foafName;
}
class StorageDescription extends DatasetWrapper {
  get roots() {
    return this.subjectsOf(OWNER, StorageRoot);
  }
  get profiles() {
    return this.subjectsOf(STORAGE, StorageProfile);
  }
}
function describedOwner(data: DatasetCore, url: string): ItemOwner | undefined {
  const doc = new StorageDescription(data, DataFactory);
  for (const root of doc.roots) {
    if (!root.value.endsWith("/") || !isOwnStorage(url, root.value)) continue;
    for (const owner of root.owners) {
      if (!/^https?:\/\//.test(owner.value)) continue;
      return {
        webId: owner.value,
        label: profileName(new StorageProfile(owner, data, DataFactory)) ?? owner.value,
      };
    }
  }
  for (const agent of doc.profiles) {
    // Read each named storage independently: a malformed sibling cannot hide a valid root.
    if (agent.storages.some((root) => isOwnStorage(url, root)))
      return { webId: agent.value, label: profileName(agent) ?? agent.value };
  }
  return undefined;
}
function descriptionLink(headers: Headers, url: string): string | undefined {
  for (const match of (headers.get("link") ?? "").matchAll(/<([^>]*)>\s*((?:;\s*[^,]*)*)/g)) {
    const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(match[2] as string);
    if (!(rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes(DESCRIPTION)) continue;
    try {
      const target = new URL(match[1] as string, url);
      if (target.protocol === "https:" || target.protocol === "http:") return target.href;
    } catch {
      /* malformed discovery is unavailable */
    }
  }
  return undefined;
}

/** Discover ownership from Solid storage descriptions or a storage root, never from login alone. */
export async function resolveItemOwner(
  url: string,
  session: { storageUrl: string; webId: string; fetch: typeof fetch },
): Promise<ItemOwner | undefined> {
  if (isOwnStorage(url, session.storageUrl)) return { webId: session.webId, label: "Me" };
  const visited = new Set<string>();
  const read = async (target: string): Promise<ItemOwner | undefined> => {
    if (visited.has(target)) return undefined;
    visited.add(target);
    try {
      const { dataset, response } = await fetchRdf(target, { fetch: session.fetch });
      const owner = describedOwner(dataset, url);
      if (owner) return owner;
      const linked = descriptionLink(response.headers, target);
      return linked ? await read(linked) : undefined;
    } catch {
      return undefined;
    }
  };
  let owner: ItemOwner | undefined;
  try {
    const response = await session.fetch(url, { method: "HEAD" });
    const linked = response.ok ? descriptionLink(response.headers, url) : undefined;
    if (linked) owner = await read(linked);
  } catch {
    /* ancestor discovery may still work */
  }
  // Servers without storageDescription may put solid:owner on the storage root.
  for (let root = url.endsWith("/") ? url : parentOf(url); root && !owner; root = parentOf(root))
    owner = await read(root);
  if (!owner || owner.label !== owner.webId) return owner;
  try {
    const { dataset } = await fetchRdf(owner.webId, { fetch: session.fetch });
    return {
      webId: owner.webId,
      label: profileName(new StorageProfile(owner.webId, dataset, DataFactory)) ?? owner.webId,
    };
  } catch {
    return owner;
  }
}
