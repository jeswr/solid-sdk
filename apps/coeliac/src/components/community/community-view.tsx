// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The Community view (Phase 4A — link into existing communities; design §3).
 *
 * Honest shape (design §0): the coeliac community lives almost entirely on closed
 * platforms with no open read API, so 4A is **curated, safe, accessible
 * link-outs** — NOT a live aggregated feed we cannot honestly source. This view
 * fetches NO community content; it renders the static, reviewed catalog and,
 * where the user's own diary makes it useful, surfaces the venue-guide link-outs
 * in context.
 *
 * Rails inherited (design §2): the shared `<MedicalDisclaimer>` PLUS the distinct
 * `<PeerContentBanner>` ("experience, not verified advice"); every external link
 * goes through `<CommunityLink>` (native `<a>`, `rel="noopener noreferrer"` +
 * `referrerPolicy="no-referrer"`, external-community interstitial); no app-stored
 * health data is intentionally egressed.
 *
 * Eating-out surfacing (design §3.2): reads the durable diary cache (cache-only,
 * no network — UX invariant #3) and, when the user has logged a meal with
 * `diet:context = restaurant`, offers the Coeliac UK venue guide + Find Me Gluten
 * Free in context — the honest substitute for venue data we cannot ingest. The
 * only diary signal used is the *presence* of a restaurant-context meal; no meal
 * detail, symptom, or identity is read or sent.
 */
import { MedicalDisclaimer } from "@/components/medical-disclaimer";
import {
  CATEGORY_LABELS,
  type CommunityCategory,
  communitiesByCategory,
} from "@/lib/community/communities";
import { useHasEatenOut } from "@/lib/session/use-eating-out";
import { CommunityLink } from "./community-link";
import { PeerContentBanner } from "./peer-content-banner";

/** Order the category sections are shown in (credibility-forward). */
const SECTION_ORDER: CommunityCategory[] = ["charity", "venue-guide", "peer-forum", "patient-community"];

function CategorySection({ category }: { category: CommunityCategory }) {
  const entries = communitiesByCategory(category);
  if (entries.length === 0) return null;
  return (
    <section className="community-section" aria-label={CATEGORY_LABELS[category]}>
      <h2>{CATEGORY_LABELS[category]}</h2>
      <ul className="community-list">
        {entries.map((entry) => (
          <li key={entry.id} className="community-card">
            <h3 className="community-card__name">{entry.name}</h3>
            <p className="community-card__org">{entry.org}</p>
            <p className="community-card__desc">{entry.description}</p>
            <p className="community-card__moderated">Moderated by {entry.moderatedBy}.</p>
            {entry.audience ? (
              <p className="community-card__audience" role="note">
                {entry.audience}
              </p>
            ) : null}
            <CommunityLink entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The contextual "eating out" prompt — shown only when the diary already contains
 * a restaurant-context meal ANYWHERE in the cache (design §3.2). Uses a full-cache
 * boolean signal (not the capped/deduped recent list) so an eating-out meal is
 * never missed. Renders nothing until loaded and nothing if the user hasn't eaten
 * out.
 */
function EatingOutSurfacing() {
  const { ateOut, loaded } = useHasEatenOut();
  if (!loaded || !ateOut) return null;
  const venueGuides = communitiesByCategory("venue-guide");
  if (venueGuides.length === 0) return null;
  return (
    <section className="community-eating-out" aria-label="Eating out — suggested from your diary">
      <h2>You&apos;ve logged eating out</h2>
      <p className="community-eating-out__lead">
        Finding gluten-free-safe places is one of the hardest parts. These guides list
        gluten-free-accredited and reviewed venues — we point you to the authoritative guides rather
        than re-host their data.
      </p>
      <ul className="community-list community-list--inline">
        {venueGuides.map((entry) => (
          <li key={entry.id} className="community-card">
            <h3 className="community-card__name">{entry.name}</h3>
            <p className="community-card__desc">{entry.description}</p>
            <CommunityLink entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CommunityView() {
  return (
    <div className="knowledge community">
      <h1>Community</h1>
      <MedicalDisclaimer>
        We link you out to established coeliac communities and charities. We don&apos;t aggregate or
        host their content, and we never send anything about your diary or health when you follow a
        link.
      </MedicalDisclaimer>
      <PeerContentBanner />

      <EatingOutSurfacing />

      {SECTION_ORDER.map((category) => (
        <CategorySection key={category} category={category} />
      ))}
    </div>
  );
}
