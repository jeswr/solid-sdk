// AUTHORED-BY Codex
import { accessControl } from "../lib/client/access";
import { createSolidDriveClient, DriveError, type MoveResource } from "../lib/client/client";
import { discoveryOptions, requireResourceAssertion } from "../lib/client/commit";

/**
 * Bind a reverse move to the version captured after the original move. The
 * authenticated fetch seam checks the captured tree as well as the root validator.
 * Copy/delete and MIME handling stay in the client.
 */
export async function moveWithValidator(
  options: Parameters<typeof createSolidDriveClient>[0],
  from: string,
  to: string,
  etag: string,
  tree?: readonly MoveResource[],
  verifyHeaders?: MoveResource["verifyHeaders"],
): Promise<void> {
  const folder = from.endsWith("/");
  if (!etag || etag.startsWith("W/") || (folder && !tree))
    throw new Error("This move cannot be safely undone");
  const unavailable = (status: number, url: string) =>
    new DriveError("missing-validator", status, url);
  const root = requireResourceAssertion(
    { url: from, etag, ...discoveryOptions({ verifyHeaders }) },
    unavailable,
  );
  const identities = new Map(
    tree?.map((resource) => [resource.url, requireResourceAssertion(resource, unavailable)]),
  );
  const auxiliaries = new Set<string>();
  const policies = accessControl(options.fetch, options.storageUrl);
  let createdEtag: string | null = null;
  let folderCopied = false;
  const client = createSolidDriveClient({
    ...options,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const url = request?.url ?? String(input);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? request?.headers);
      const readingTree =
        folder &&
        !folderCopied &&
        url.startsWith(from) &&
        (!auxiliaries.has(url) || identities.has(url)) &&
        (method === "GET" || method === "HEAD");
      const identity = identities.get(url);
      if (readingTree) {
        if (!identity?.etag || identity.etag.startsWith("W/"))
          throw new Error("This move cannot be safely undone");
        headers.set("if-match", identity.etag);
      }
      if (url === from && (!folder || (method === "GET" && !folderCopied)))
        headers.set("if-match", etag);
      if (!folder && url === to && method === "DELETE") {
        // The client rolls back its copy on a failed source delete. A later
        // replacement at the destination must survive that cleanup too.
        if (!createdEtag || createdEtag.startsWith("W/"))
          throw new Error("No validator for rollback");
        headers.set("if-match", createdEtag);
      }
      const response = await options.fetch(input, { ...init, headers });
      // Also verify the read response: some adapters ignore GET preconditions.
      // Never hand replacement bytes to the client's copy implementation.
      if (
        folder &&
        !folderCopied &&
        readingTree &&
        (!response.ok || response.headers.get("etag") !== identity?.etag)
      )
        throw new Error("This move cannot be safely undone");
      if (
        !folder &&
        url === from &&
        method === "GET" &&
        response.ok &&
        response.headers.get("etag") !== etag
      )
        throw new DriveError("conflict", 412, from);
      if (response.ok && (method === "GET" || method === "HEAD")) {
        if (readingTree) identity?.verifyHeaders(response.headers);
        if (url === from) root.verifyHeaders(response.headers);
      }
      if (readingTree && response.ok) {
        try {
          const acl = policies.discover(url, response.headers);
          if (acl) auxiliaries.add(acl);
        } catch {
          // The transfer's access check asks about unsupported policy models.
        }
      }
      if (url === to && method === "PUT" && response.ok) {
        createdEtag = response.headers.get("etag");
        folderCopied = true;
      }
      return response;
    },
  });
  if (folder) {
    const seen = new Set<string>();
    const verify = async (url: string): Promise<void> => {
      const identity = identities.get(url);
      if (!identity || seen.has(url)) throw new Error("This move cannot be safely undone");
      seen.add(url);
      if (!url.endsWith("/")) {
        await client.stat(url);
        return;
      }
      if (!identity.children) throw new Error("This move cannot be safely undone");
      const current = await client.list(url);
      const expected = new Set(identity.children);
      if (current.length !== expected.size || current.some((item) => !expected.has(item.url)))
        throw new Error("This move cannot be safely undone");
      for (const child of current) await verify(child.url);
    };
    await verify(from);
    if (seen.size !== identities.size) throw new Error("This move cannot be safely undone");
  }
  await client.move(
    from,
    to,
    { kind: "confirm-move" },
    { ifMatch: etag, verifyHeaders: root.verifyHeaders },
  );
}
