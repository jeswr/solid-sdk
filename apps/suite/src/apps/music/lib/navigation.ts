// AUTHORED-BY Codex GPT-6
import { encodeRef } from "../../../lib/refs";

const routes = {
  album: ["a", "albums"],
  artist: ["ar", "artists"],
  playlist: ["p", "playlists"],
} as const;

/** Foreign RDF identities can be URNs; only HTTP(S) identities fit suite route refs. */
export function musicHref(kind: keyof typeof routes, id: string): string {
  const [detail, collection] = routes[kind];
  try {
    const url = new URL(id);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password)
      return `/music/${detail}/${encodeRef(id)}`;
  } catch {
    // Keep the library navigable when an imported identity cannot be encoded.
  }
  return `/music/${collection}`;
}

export const albumHref = (id: string) => musicHref("album", id);
export const artistHref = (id: string) => musicHref("artist", id);
export const playlistHref = (id: string) => musicHref("playlist", id);
