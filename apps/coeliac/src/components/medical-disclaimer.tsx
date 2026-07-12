// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The shared medical-disclaimer frame (rail §2.1). EVERY knowledge / trials /
 * therapies surface renders this — it is the persistent "information, not medical
 * advice — decision support, not diagnosis" statement. Acceptance tests assert the
 * `NOT_MEDICAL_ADVICE` string is present on each page, so it can never be dropped.
 */
import Link from "next/link";
import type { ReactNode } from "react";

/** The canonical not-medical-advice sentence — asserted present on every Phase-3 surface. */
export const NOT_MEDICAL_ADVICE =
  "This is information, not medical advice — decision support, not diagnosis. Always discuss anything here with your clinician.";

export function MedicalDisclaimer({ children }: { children?: ReactNode }) {
  return (
    <aside className="med-disclaimer" role="note" aria-label="Not medical advice">
      <p className="med-disclaimer__text">{NOT_MEDICAL_ADVICE}</p>
      {children ? <p className="med-disclaimer__extra">{children}</p> : null}
    </aside>
  );
}

/** A small sub-nav shared across the three knowledge surfaces. */
export function KnowledgeTabs() {
  return (
    <nav className="knowledge-tabs" aria-label="Research sections">
      <Link href="/knowledge/research">Latest research</Link>
      <Link href="/knowledge/trials">Clinical trials</Link>
      <Link href="/knowledge/therapies">Drug pipeline</Link>
    </nav>
  );
}
