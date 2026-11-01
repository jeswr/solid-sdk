// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  discoverWacAcl,
  MEMORY_PURPOSES,
  type MemoryPurpose,
  validateDedicatedWacAcl,
} from "@jeswr/pkg-memory";
import { DataFactory as df, Store } from "n3";
import { requirePodScopedWriteUrl } from "./auth.js";
import { parseBoundedRdf, serializeBoundedTurtle } from "./bounded-rdf.js";
import { MemoryNode, status } from "./memory-context.js";
import { PodOutput } from "./output.js";
import { specialCategories } from "./personal-policy.js";
import type { PodConditions, PodPort, PodReadResult } from "./pod-port.js";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const PROV = "http://www.w3.org/ns/prov#";
const DPV = "https://w3id.org/dpv#";
const ACL = "http://www.w3.org/ns/auth/acl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** @internal Commit the audit before disclosing special data, through the current port. */
export async function auditSpecialRead(
  pod: PodPort,
  readOnly: boolean,
  clientId: string,
  purpose: MemoryPurpose,
  categories: string[],
): Promise<void> {
  const sensitive = specialCategories(categories);
  if (!sensitive.length) return;
  if (readOnly) throw new Error("write disabled: audit requires a writable server");
  const output = new PodOutput(pod);
  const now = new Date().toISOString();
  const url = new URL(`private/pkg/audit/${now.slice(0, 7)}.ttl`, pod.root).href;
  const id = `${url}#${crypto.randomUUID()}`;
  const entry = new Store();
  const activity = new MemoryNode(id, entry, df);
  activity.terms(`${RDF}type`).add(df.namedNode(`${PROV}Activity`));
  activity.terms(`${PROV}wasAssociatedWith`).add(df.namedNode(clientId));
  activity.terms(`${PROV}startedAtTime`).add(df.literal(now, df.namedNode(`${XSD}dateTime`)));
  activity.terms(`${DPV}hasPurpose`).add(df.namedNode(MEMORY_PURPOSES[purpose]));
  for (const category of sensitive)
    activity.terms(`${DPV}hasPersonalData`).add(df.namedNode(category));

  async function optional(target: string) {
    try {
      return await output.read(target, { accept: "text/turtle" });
    } catch (error) {
      if (status(error) === 404) return undefined;
      throw error;
    }
  }
  function condition(existing?: PodReadResult): PodConditions {
    if (!existing) return { ifNoneMatch: "*" };
    if (!existing.etag || !/^"[^"\r\n]*"(?![\s\S])/.test(existing.etag))
      throw new Error("Strong ETag required for audit");
    return { ifMatch: existing.etag };
  }
  async function write(target: string, body: string, cond: PodConditions) {
    const scoped = requirePodScopedWriteUrl({ podRoot: pod.root }, target);
    // Every body comes from serializeBoundedTurtle, which caps UTF-8 output.
    await pod.write(scoped, encoder.encode(body), "text/turtle", cond);
  }
  async function protect(target: string, inherit: boolean) {
    let acl: string;
    try {
      acl = await discoverWacAcl({ root: pod.root, head: (url) => output.head(url) }, target);
    } catch {
      // Never expose server URLs or backend errors through an audit denial.
      throw new Error("Audit protection unavailable");
    }
    const existing = await optional(acl);
    const cond = condition(existing);
    if (existing) {
      try {
        if (existing.contentType.split(";")[0]?.trim().toLowerCase() !== "text/turtle")
          throw new Error();
        validateDedicatedWacAcl(
          await parseBoundedRdf(decoder.decode(existing.body), "text/turtle", acl),
          target,
        );
      } catch {
        throw new Error("Audit protection unavailable");
      }
    }
    const dataset = new Store();
    const node = new MemoryNode(`${acl}#owner`, dataset, df);
    const grants: [string, string][] = [
      [`${RDF}type`, `${ACL}Authorization`],
      [`${ACL}agent`, pod.webId],
      [`${ACL}accessTo`, target],
    ];
    for (const mode of ["Read", "Write", "Control"]) grants.push([`${ACL}mode`, ACL + mode]);
    if (inherit) grants.push([`${ACL}default`, target]);
    for (const [predicate, object] of grants) node.terms(predicate).add(df.namedNode(object));
    await write(acl, serializeBoundedTurtle(dataset), cond);
  }
  // Retry compare-and-swap conflicts with a fresh read; never overwrite another call's activity.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      for (const path of ["private/", "private/pkg/", "private/pkg/audit/"]) {
        const container = new URL(path, pod.root).href;
        const existing = await optional(container);
        if (existing && path !== "private/pkg/audit/") continue;
        await protect(container, true);
        if (!existing && !(await optional(container))) {
          const dataset = new Store();
          new MemoryNode(container, dataset, df)
            .terms(`${RDF}type`)
            .add(df.namedNode("http://www.w3.org/ns/ldp#BasicContainer"));
          await write(container, serializeBoundedTurtle(dataset), { ifNoneMatch: "*" });
        }
      }
      const previous = await optional(url);
      if (previous && previous.contentType.split(";")[0]?.trim().toLowerCase() !== "text/turtle")
        throw new Error("Unsupported audit media type");
      const dataset = previous
        ? await parseBoundedRdf(decoder.decode(previous.body), "text/turtle", url)
        : new Store();
      for (const quad of entry) dataset.addQuad(quad);
      const body = serializeBoundedTurtle(dataset);
      await protect(url, false);
      await write(url, body, condition(previous));
      const persisted = await output.read(url, { accept: "text/turtle" });
      const verified = await parseBoundedRdf(
        decoder.decode(persisted.body),
        persisted.contentType,
        url,
      );
      for (const quad of entry)
        if (!verified.has(quad)) throw new Error("Audit entry not persisted");
      return;
    } catch (error) {
      if (status(error) !== 412 || attempt === 2) throw error;
    }
  }
}
