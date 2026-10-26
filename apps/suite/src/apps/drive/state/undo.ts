// AUTHORED-BY Codex
import { createSolidDriveClient, DriveError } from "../lib/client/client";

/**
 * Bind a reverse move to the version captured after the original move. The
 * current client has no conditional move API, so apply the validators at its
 * authenticated fetch seam. Copy/delete and MIME handling stay in the client.
 */
export async function moveWithValidator(
  options: Parameters<typeof createSolidDriveClient>[0],
  from: string,
  to: string,
  etag: string,
): Promise<void> {
  // A container validator does not identify every descendant, so folders rely on
  // the client's own recursive safety: it copies before deleting, deletes each
  // source child with If-Match on the version it copied, and keeps anything new.
  if (from.endsWith("/")) {
    await createSolidDriveClient(options).move(from, to);
    return;
  }
  if (!etag || etag.startsWith("W/")) throw new Error("This move cannot be safely undone");
  let createdEtag: string | null = null;
  const client = createSolidDriveClient({
    ...options,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const url = request?.url ?? String(input);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? request?.headers);
      if (url === from) headers.set("if-match", etag);
      if (url === to && method === "DELETE") {
        // The client rolls back its copy on a failed source delete. A later
        // replacement at the destination must survive that cleanup too.
        if (!createdEtag || createdEtag.startsWith("W/"))
          throw new Error("No validator for rollback");
        headers.set("if-match", createdEtag);
      }
      const response = await options.fetch(input, { ...init, headers });
      // Also verify the read response: some adapters ignore GET preconditions.
      // Never hand replacement bytes to the client's copy implementation.
      if (url === from && method === "GET" && response.ok && response.headers.get("etag") !== etag)
        throw new DriveError("conflict", 412, from);
      if (url === to && method === "PUT" && response.ok) createdEtag = response.headers.get("etag");
      return response;
    },
  });
  await client.move(from, to);
}
