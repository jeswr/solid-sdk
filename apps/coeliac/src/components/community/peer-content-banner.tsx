// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The peer-content banner (design rail §1). EVERY community surface renders this
 * DISTINCT from the shared `<MedicalDisclaimer>`: it states that community links
 * lead to other people's *experience*, not verified medical advice, and points
 * back to the credible Research page. Peer content is thereby visually +
 * structurally separated from the Phase-3 credible-source knowledge — never
 * presented as equivalent. An acceptance test asserts {@link PEER_CONTENT_NOTE}
 * is present on the community view, so it can never be silently dropped.
 */
import Link from "next/link";

/** The canonical peer-content sentence — asserted present on every community surface. */
export const PEER_CONTENT_NOTE =
  "These are external communities of other people's experience — not medical advice, and not verified by this app.";

export function PeerContentBanner() {
  return (
    <aside className="peer-banner" role="note" aria-label="About community content">
      <p className="peer-banner__text">{PEER_CONTENT_NOTE}</p>
      <p className="peer-banner__extra">
        Treat posts as personal experience, and check anything important against the{" "}
        <Link href="/knowledge/research">Research page</Link> and your clinician.
      </p>
    </aside>
  );
}
