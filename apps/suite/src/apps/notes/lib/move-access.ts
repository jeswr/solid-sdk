// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { ShareError } from "../../../shell/share/types";
import { wacOnlyFetch } from "../../../shell/share/verified-wac-adapter";
import { readRdf, writeRdf } from "../../docs/lib/model/rdf-io";

const ACL = "http://www.w3.org/ns/auth/acl#";
class MoveAuthorization extends Authorization {
  targets(predicate: string) {
    return SetFrom.subjectPredicate(
      this,
      ACL + predicate,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/** Read only a discovered own WAC policy; absence means the note inherits access. */
export async function readNoteAccess(url: string, fetch: typeof globalThis.fetch) {
  const http = wacOnlyFetch(fetch);
  const head = await http(url, { method: "HEAD" });
  // Use the same conventional endpoint boundary as the Notes share flow.
  const links = [...(head.headers.get("link") ?? "").matchAll(/<([^>]+)>\s*;\s*rel="acl"/g)];
  if (!head.ok || links.length !== 1 || links[0]?.[1] !== `${url}.acl`)
    throw new ShareError("unsupported");
  try {
    return await readRdf(`${url}.acl`, http);
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return undefined;
    throw error;
  }
}

/** Preserve every grant and condition; only the resource and ACL targets change. */
export async function copyNoteAccess(
  access: NonNullable<Awaited<ReturnType<typeof readNoteAccess>>>,
  from: string,
  to: string,
  fetch: typeof globalThis.fetch,
) {
  const dataset = new Store([...access.dataset]);
  for (const rule of new AclResource(dataset, DataFactory).authorizations) {
    const writable = new MoveAuthorization(rule as Term, dataset, DataFactory);
    for (const predicate of ["accessTo", "default", "defaultForNew"]) {
      const targets = writable.targets(predicate);
      for (const [oldUrl, newUrl] of [
        [from, to],
        [`${from}.acl`, `${to}.acl`],
      ] as const) {
        if (targets.delete(oldUrl)) targets.add(newUrl);
      }
    }
  }
  // Verify destination discovery as well; never overwrite an existing ACL.
  if (await readNoteAccess(to, fetch)) throw new ShareError("conflict");
  await writeRdf(`${to}.acl`, dataset, { createOnly: true, fetchImpl: fetch });
}
