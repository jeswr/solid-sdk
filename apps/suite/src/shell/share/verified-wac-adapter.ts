// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { serializeTurtle } from "../../apps/docs/lib/model/rdf-io";
import { verifyPrivateIndexAccess } from "../../apps/docs/lib/model/type-index-access";
import { privateAcl } from "../../apps/drive/lib/client/access";
import type { SharingSession } from "../../apps/drive/lib/sharing/adapter";
import { ensurePrivateTasksAccess } from "../../apps/tasks/state/access";
import { ShareError } from "./types";
import { WacSharingAdapter } from "./wac-adapter";

const ACP = "http://www.w3.org/ns/solid/acp#";
class VerifiedSharingError extends ShareError {
  constructor() {
    super("unsupported");
    this.message =
      "Sharing can't be changed safely for these access rules. Manage access in your pod.";
  }
}

/** Check every discovery/read, including the superclass's fresh ACL read. */
export function wacOnlyFetch(transport: typeof fetch): typeof fetch {
  const http = refuseRedirects(transport);
  const endpoints = new Map<string, string>();
  return async (input, init) => {
    const response = await http(input, init);
    if ((response.headers.get("link") ?? "").includes(ACP)) throw new VerifiedSharingError();
    if (response.ok && init?.method === "HEAD") {
      const links = [...(response.headers.get("link") ?? "").matchAll(/<([^>]+)>\s*([^,]*)/g)];
      const targets = links.filter((match) => {
        const rel = (match[2] as string).match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i);
        return (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("acl");
      });
      const resource = String(input);
      const target = targets[0]?.[1];
      if (targets.length !== 1 || !target) throw new VerifiedSharingError();
      const endpoint = new URL(target, resource).href;
      const previous = endpoints.get(resource);
      if (previous !== undefined && previous !== endpoint) throw new VerifiedSharingError();
      endpoints.set(resource, endpoint);
    }
    // This transport reads access-policy RDF, including inherited and freshly
    // discovered documents. ACL Link targets need not have an .acl suffix.
    if (response.ok && (init?.method ?? "GET") === "GET") {
      const dataset = await parseRdf(
        await response.clone().text(),
        response.headers.get("content-type"),
        { baseIRI: String(input) },
      );
      // Vocabulary evidence is checked before interpreting any WAC authorizations.
      for (const quad of dataset) {
        if (
          quad.predicate.value.startsWith(ACP) ||
          (quad.object.termType === "NamedNode" && quad.object.value.startsWith(ACP))
        )
          throw new VerifiedSharingError();
      }
    }
    return response;
  };
}

/** Verified own ACLs; container grants also cover inheriting members. */
export class VerifiedWacSharingAdapter extends WacSharingAdapter {
  private readonly http: typeof fetch;
  private readonly loaded = new Set<string>();
  constructor(private readonly session: SharingSession & { mode: string }) {
    const http = wacOnlyFetch(session.fetch);
    super({ ...session, fetch: http });
    this.http = http;
  }

  override async load(container: string, signal: AbortSignal) {
    // A failed safety check also revokes any previous snapshot's write permission.
    this.loaded.delete(container);
    assertWithinPodScope(this.session.storageUrl, container);
    const fetch = this.http;
    const head = await fetch(container, { method: "HEAD", signal });
    // Bootstrap only the conventional own ACL, never an arbitrary auxiliary URL.
    const links = [...(head.headers.get("link") ?? "").matchAll(/<([^>]+)>\s*;\s*rel="acl"/g)];
    if (!head.ok || links.length !== 1 || links[0]?.[1] !== `${container}.acl`)
      throw new VerifiedSharingError();
    const existing = await fetch(`${container}.acl`, { signal });
    if (existing.status === 404) {
      // Creating an ACL must not silently revoke inherited collaborators. Only a
      // verified owner-only policy (or the isolated demo backend) can be narrowed here.
      if (
        !(await ensurePrivateTasksAccess({ ...this.session, fetch }, container, this.session.webId))
      ) {
        try {
          await verifyPrivateIndexAccess(
            container,
            this.session.webId,
            this.session.storageUrl,
            fetch,
          );
        } catch {
          throw new VerifiedSharingError();
        }
      }
      signal.throwIfAborted();
      const response = await fetch(`${container}.acl`, {
        method: "PUT",
        signal,
        headers: { "content-type": "text/turtle", "if-none-match": "*" },
        body: await serializeTurtle(privateAcl(container, this.session.webId)),
      });
      if (!response.ok && response.status !== 412)
        throw new ShareError(response.status === 403 ? "forbidden" : "network");
    }
    const state = await super.load(container, signal);
    this.loaded.add(container);
    return state;
  }

  private assertLoaded(container: string) {
    if (!this.loaded.has(container)) throw new VerifiedSharingError();
  }

  override async setPerson(...args: Parameters<WacSharingAdapter["setPerson"]>) {
    this.assertLoaded(args[0]);
    await this.load(args[0], new AbortController().signal);
    return super.setPerson(...args);
  }

  override async setGeneral(...args: Parameters<WacSharingAdapter["setGeneral"]>) {
    this.assertLoaded(args[0]);
    await this.load(args[0], new AbortController().signal);
    return super.setGeneral(...args);
  }
}
