// AUTHORED-BY Codex GPT-6

import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { createSessionPrivateDestinationChecks, runImport } from "@jeswr/pod-connectors";
import { spotifyAdapter } from "@jeswr/pod-connectors/adapters/spotify";
import type { PodSession } from "../../../lib/session/pod-session";
import { createDocument, provision } from "../lib/data/library";
import { Store } from "../lib/model";

/** The connector's recorded JSON is the only source transport: this never contacts Spotify. */
export async function importSpotifyFixture(
  session: Pick<PodSession, "fetch" | "storageUrl" | "webId">,
): Promise<void> {
  const { fetch, storageUrl: storage } = session;
  await provision(fetch, storage);
  const scoped = createPodScopedFetch(storage, { fetch });
  const resolve = (slug: string) => new URL(`integrations/spotify/${slug}`, storage).href;
  await runImport({
    adapter: spotifyAdapter,
    mode: "demo",
    podWriter: {
      // Spotify history is private: the import is refused unless the pod verifies (or seals) the
      // destination as owner-only, exactly as the Connect path checks every other connector.
      ...createSessionPrivateDestinationChecks(session),
      resolve,
      read: async () => undefined,
      write: async (doc) => {
        const url = resolve(doc.slug);
        const response = await scoped(url, { method: "HEAD" });
        if (response.status === 404)
          await createDocument(fetch, storage, url, new Store([...doc.dataset]));
        else if (!response.ok) throw new Error("Could not read a previous Spotify import");
        return { url, category: doc.category, forClass: doc.forClass };
      },
      writeBinary: async () => {
        throw new Error("Unexpected binary in Spotify fixture");
      },
      remove: async () => {
        throw new Error("Unexpected deletion in Spotify fixture");
      },
      registerType: async () => ({ indexUrl: "" }),
    },
  });
}
