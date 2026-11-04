// AUTHORED-BY Claude Opus 5.5
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { PodSession } from "../../../lib/session/pod-session";

/** The parts of a session that reading the owner's public WebID profile needs. */
export type ProfileSession = Pick<PodSession, "fetch" | "webId"> & {
  readonly storageUrl?: string;
  /** Credential-free fetch (extension sessions). */
  readonly publicFetch?: PodSession["fetch"];
};

/**
 * The reader for the owner's public profile and its approval keys. An extension session's
 * credentials are granted only for its storage, so a profile hosted elsewhere is read through the
 * credential-free fetch, exactly as workspace discovery does. Profile writes and private
 * resources always keep the credentialed fetch.
 */
export function profileReader(session: ProfileSession): PodSession["fetch"] {
  const { publicFetch, storageUrl } = session;
  if (!publicFetch || !storageUrl) return session.fetch;
  const profile = new URL(session.webId);
  profile.hash = "";
  try {
    assertWithinPodScope(storageUrl, profile.href);
    return session.fetch;
  } catch {
    return publicFetch;
  }
}
