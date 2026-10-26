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
  children?: readonly string[],
): Promise<void> {
  const folder = from.endsWith("/");
  if (!etag || etag.startsWith("W/") || (folder && !children))
    throw new Error("This move cannot be safely undone");
  let createdEtag: string | null = null;
  let folderCopied = false;
  const client = createSolidDriveClient({
    ...options,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const url = request?.url ?? String(input);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? request?.headers);
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
        url === from &&
        method === "GET" &&
        (!response.ok || response.headers.get("etag") !== etag)
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
      if (url === to && method === "PUT" && response.ok) {
        createdEtag = response.headers.get("etag");
        folderCopied = true;
      }
      return response;
    },
  });
  if (folder) {
    // Bind Undo to the moved folder, not whatever later occupies its URL. The
    // recursive client still keeps children added after its own copy snapshot.
    const current = await client.list(from);
    const expected = new Set(children);
    if (current.length !== expected.size || current.some((item) => !expected.has(item.url)))
      throw new Error("This move cannot be safely undone");
  }
  await client.move(from, to);
}
