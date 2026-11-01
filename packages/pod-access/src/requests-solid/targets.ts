// AUTHORED-BY Codex GPT-6
import { termsEqual } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";
import { MAX_MEMBERS, read, readProfile, scoped } from "./http.js";
import { members } from "./inbox.js";
import { values } from "./rdf.js";
import { RDF, SOLID } from "./vocab.js";

/** Resolve only owner-advertised registrations. Every credentialed link stays in storage. */
export async function resolveTargets(
  dataTypes: readonly string[],
  options: { webId: string; storage: string; typeIndex?: string | DatasetCore },
  fetchFn: typeof fetch,
  /** Already credential-free transport for an off-storage owner profile. */
  publicFetch?: typeof fetch,
): Promise<string[]> {
  const indexes: DatasetCore[] = [];
  if (typeof options.typeIndex === "object") indexes.push(options.typeIndex);
  else if (options.typeIndex !== undefined) {
    const index = await read(scoped(options.storage, options.typeIndex), fetchFn);
    if (index) indexes.push(index.dataset);
  } else {
    const profile = await readProfile(options.webId, options.storage, fetchFn, publicFetch);
    if (profile) {
      const pointers = new Set([
        ...values(profile.dataset, options.webId, SOLID.publicTypeIndex),
        ...values(profile.dataset, options.webId, SOLID.privateTypeIndex),
      ]);
      const preferences = values(
        profile.dataset,
        options.webId,
        "http://www.w3.org/ns/pim/space#preferencesFile",
      )[0];
      if (preferences !== undefined) {
        const prefs = await read(scoped(options.storage, preferences), fetchFn);
        if (prefs)
          for (const url of values(prefs.dataset, options.webId, SOLID.privateTypeIndex))
            pointers.add(url);
      }
      if (pointers.size > 10) throw new RangeError("Too many Type Index documents");
      for (const pointer of pointers) {
        const index = await read(scoped(options.storage, pointer), fetchFn);
        if (index) indexes.push(index.dataset);
      }
    }
  }
  const targets = new Set<string>();
  const containers = new Set<string>();
  const matched = new Set<string>();
  for (const index of indexes) {
    for (const quad of index.match(
      null,
      DataFactory.namedNode(RDF.type),
      DataFactory.namedNode(SOLID.TypeRegistration),
    )) {
      const id = quad.subject;
      const registered = values(index, id, SOLID.forClass);
      const classes = dataTypes.filter((type) =>
        registered.some((value) => termsEqual(value, type)),
      );
      if (classes.length === 0) continue;
      for (const value of classes) matched.add(value);
      for (const value of values(index, id, SOLID.instance))
        targets.add(scoped(options.storage, value));
      for (const value of values(index, id, SOLID.instanceContainer))
        containers.add(scoped(options.storage, value));
    }
  }
  if (matched.size !== dataTypes.length)
    throw new Error("Every approved data type needs an owner registration");
  const queue = [...containers];
  const visited = new Set<string>();
  while (queue.length) {
    const container = queue.shift() as string;
    if (visited.has(container)) continue;
    visited.add(container);
    if (visited.size + targets.size > MAX_MEMBERS)
      throw new RangeError("Target resolution exceeds limit");
    const listing = await read(container, fetchFn);
    if (!listing) throw new Error("Registered container is missing");
    const children = members(listing.dataset, container);
    if (children.length >= MAX_MEMBERS) throw new RangeError("Target resolution exceeds limit");
    for (const child of children) {
      const target = scoped(options.storage, child);
      if (target.endsWith("/")) queue.push(target);
      else targets.add(target);
    }
  }
  if (targets.size === 0 || targets.size > MAX_MEMBERS)
    throw new RangeError("Invalid resolved target count");
  for (const target of targets) {
    if (/\.(acl|acr)(?:[?#]|$)/i.test(target))
      throw new Error("Access-control documents cannot be targets");
  }
  return [...targets].sort();
}
