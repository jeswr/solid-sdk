// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { ShareError } from "../../../shell/share/types";
import { WacSharingAdapter } from "../../../shell/share/wac-adapter";
import { serializeTurtle } from "../../docs/lib/model/rdf-io";
import { verifyPrivateIndexAccess } from "../../docs/lib/model/type-index-access";
import { privateAcl } from "../../drive/lib/client/access";
import type { SharingSession } from "../../drive/lib/sharing/adapter";
import { ensurePrivateTasksAccess } from "../../tasks/state/access";

/** Own container ACLs with matching accessTo/default grants, as for Tasks folders. */
export class WorkbookSharingAdapter extends WacSharingAdapter {
  constructor(private readonly session: SharingSession & { mode: string }) {
    super(session);
  }

  override async load(container: string, signal: AbortSignal) {
    assertWithinPodScope(this.session.storageUrl, container);
    if (!container.endsWith("/")) throw new ShareError("unsupported");
    const fetch = refuseRedirects(this.session.fetch);
    const head = await fetch(container, { method: "HEAD", signal });
    // Bootstrap only the conventional own ACL, never an arbitrary auxiliary URL.
    const links = [...(head.headers.get("link") ?? "").matchAll(/<([^>]+)>\s*;\s*rel="acl"/g)];
    if (!head.ok || links.length !== 1 || links[0]?.[1] !== `${container}.acl`)
      throw new ShareError("unsupported");
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
          throw new ShareError("unsupported");
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
    return super.load(container, signal);
  }
}
