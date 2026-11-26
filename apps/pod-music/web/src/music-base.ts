// AUTHORED-BY GPT-6.1 Sol
import type { DerivedSession } from "@jeswr/app-session";
import type { MusicStore } from "@jeswr/pod-music";

/** The resolved music library container `base` + how it was discovered. */
export interface MusicBase {
  /** The music library container URL (always ends in "/"). Passed to <MusicLibrary base>. */
  base: string;
  /**
   * True when `base` is the conventional `${podRoot}music/` fallback rather than
   * a Type-Index registration for `mo:Track`. Drives the host's discovery banner.
   */
  isFallback: boolean;
}

/** Ensure a container URL ends in a single trailing slash. */
function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Given a Type-Index-registered `tracks/` container, return its PARENT — the
 * music library `base` that `MusicStore` expects (it derives `tracks/` back under
 * it). Returns undefined when the registered container does not end in a
 * recognisable `tracks/` segment, so the caller falls back to the conventional
 * path rather than guessing a wrong base. Exported for unit testing.
 */
export function musicBaseFromTracksContainer(tracksContainer: string): string | undefined {
  const slashed = asContainer(tracksContainer);
  // Strip a single trailing `tracks/` segment: `.../music/tracks/` → `.../music/`.
  const match = slashed.match(/^(.*\/)tracks\/$/);
  return match ? match[1] : undefined;
}

/**
 * Resolve the music library `base` for the session. Tries the user's Type Index
 * first (via the data layer's `findTrackContainers`), deriving the music base as
 * the PARENT of a registered `tracks/` container; falls back to the conventional
 * `${podRoot}music/` when there is no usable registration (and flags it so the
 * host can show a banner). A discovery read that throws (no profile link, a
 * 401/403/404, a parse error) is treated as "no registration" — the conventional
 * fallback always yields a usable base, never an error to the user.
 *
 * `store` is a `MusicStore` whose `fetch` is the authenticated session fetch (passed
 * explicitly by the host as pod-auth's `auth.fetch`). The store's own `base` is irrelevant
 * here — `findTrackContainers` reads the type index off the WebID, not the base.
 */
export async function discoverMusicBase(
  store: Pick<MusicStore, "findTrackContainers">,
  session: DerivedSession,
): Promise<MusicBase> {
  const conventional: MusicBase = {
    base: asContainer(`${session.podRoot}music/`),
    isFallback: true,
  };
  try {
    const containers = await store.findTrackContainers(session.webId);
    for (const container of containers) {
      const base = musicBaseFromTracksContainer(container);
      if (base) {
        return { base, isFallback: false };
      }
    }
  } catch {
    // No type index / no profile link / read failure → conventional fallback.
    return conventional;
  }
  return conventional;
}
