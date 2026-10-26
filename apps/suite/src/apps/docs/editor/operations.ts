// AUTHORED-BY Codex
import { createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import type { PodSession } from "@/lib/session/pod-session";
import { createSolidDriveClient } from "../../drive/lib/client/client";
import { deleteRdf, docContainerUrls } from "../lib/model";
export async function deleteDocument(url: string, session: PodSession): Promise<void> {
  const layout = docContainerUrls(url);
  // Scope every recursive request, including pod-advertised children, to this tree.
  const client = createSolidDriveClient({
    storageUrl: layout.container,
    fetch: createPodScopedFetch(layout.container, { fetch: session.fetch }),
  });
  try {
    await client.remove(layout.container, { recursive: true });
  } catch (error) {
    if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
  }
  await deleteRdf(url, refuseRedirects(session.fetch));
}
