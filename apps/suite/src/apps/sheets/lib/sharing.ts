// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { ShareError } from "../../../shell/share/types";
import { WacSharingAdapter } from "../../../shell/share/wac-adapter";
import { serializeTurtle } from "../../docs/lib/model/rdf-io";
import { verifyPrivateIndexAccess } from "../../docs/lib/model/type-index-access";
import { privateAcl } from "../../drive/lib/client/access";
import type { SharingSession } from "../../drive/lib/sharing/adapter";
import { ensurePrivateTasksAccess } from "../../tasks/state/access";

const ACP = "http://www.w3.org/ns/solid/acp#";
class WorkbookSharingError extends ShareError {
  constructor() {
    super("unsupported");
    this.message =
      "Sharing can't be changed safely for these access rules. Manage access in your pod.";
  }
}

/** Check every discovery/read, including the superclass's fresh ACL read. */
function wacOnlyFetch(transport: typeof fetch): typeof fetch {
  const http = refuseRedirects(transport);
  return async (input, init) => {
    const response = await http(input, init);
    if ((response.headers.get("link") ?? "").includes(ACP)) throw new WorkbookSharingError();
    if (
      response.ok &&
      (init?.method ?? "GET") === "GET" &&
      new URL(String(input)).pathname.endsWith(".acl")
    ) {
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
          throw new WorkbookSharingError();
      }
    }
    return response;
  };
}

/** Own container ACLs with matching accessTo/default grants, as for Tasks folders. */
export class WorkbookSharingAdapter extends WacSharingAdapter {
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
    if (!container.endsWith("/")) throw new WorkbookSharingError();
    const fetch = this.http;
    const head = await fetch(container, { method: "HEAD", signal });
    // Bootstrap only the conventional own ACL, never an arbitrary auxiliary URL.
    const links = [...(head.headers.get("link") ?? "").matchAll(/<([^>]+)>\s*;\s*rel="acl"/g)];
    if (!head.ok || links.length !== 1 || links[0]?.[1] !== `${container}.acl`)
      throw new WorkbookSharingError();
    const existing = await fetch(`${container}.acl`, { signal });
    if (existing.status === 404) {
      // Creating an ACL must not silently revoke inherited collaborators. Only a
      // verified owner-only policy (or the isolated demo backend) can be narrowed here.
      if (!(await ensurePrivateTasksAccess(this.session, container, this.session.webId))) {
        try {
          await verifyPrivateIndexAccess(
            container,
            this.session.webId,
            this.session.storageUrl,
            fetch,
          );
        } catch {
          throw new WorkbookSharingError();
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
    if (!this.loaded.has(container)) throw new WorkbookSharingError();
  }

  override async setPerson(...args: Parameters<WacSharingAdapter["setPerson"]>) {
    this.assertLoaded(args[0]);
    return super.setPerson(...args);
  }

  override async setGeneral(...args: Parameters<WacSharingAdapter["setGeneral"]>) {
    this.assertLoaded(args[0]);
    return super.setGeneral(...args);
  }
}
