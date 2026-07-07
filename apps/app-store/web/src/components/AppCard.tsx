// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// AppCard — one app's card: icon, name, one-line description, a status chip, and the
// Launch control. The Launch is ALWAYS a native <a href> (accessible-html-links rule:
// WCAG 2.4.4 link-purpose — the visible label names the app, never "click here"), with
// rel="noopener noreferrer" on every external app link.
//
// Launch states (decided by the live status + whether a WebID is known):
//   - live + deep-link + logged in → "Launch <name>" → launchUrl(app, webId) (SSO / prefill).
//   - live + external (launch:"none") OR logged out → "Open <name>" → the app's own login.
//   - not live          → a disabled "Coming soon" pill + (if public) a repo link. NO
//     launch is ever produced for a non-deployed app (launchUrl returns null).
import { type AppEntry, isLive, launchVerb } from "../lib/catalog";
import { launchUrl } from "../lib/launch";

const STATUS_LABEL: Record<AppEntry["status"], string> = {
  live: "Live",
  wip: "Coming soon",
  "local-only": "Local only",
  gated: "Coming soon",
};

/** A short, stable emoji glyph per category — a lightweight icon with no asset fetch. */
const CATEGORY_ICON: Record<AppEntry["category"], string> = {
  Documents: "📄",
  Media: "🎬",
  Comms: "✉️",
  Health: "🩺",
  Productivity: "✅",
  Finance: "💷",
  Demo: "🧪",
};

export function AppCard({ app, webId }: { app: AppEntry; webId: string | null }) {
  const live = isLive(app);
  const href = live ? launchUrl(app, webId) : null;
  const launchLabel = `${launchVerb(app, webId)} ${app.name}`;

  return (
    <article className="app-card" data-status={app.status}>
      <div className="app-card-head">
        <span className="app-card-icon" aria-hidden="true">
          {CATEGORY_ICON[app.category]}
        </span>
        <h3 className="app-card-name">{app.name}</h3>
        <span
          className={`app-card-chip app-card-chip-${live ? "live" : "soon"}`}
          // The chip is a visual status indicator; its text is the accessible label.
        >
          {STATUS_LABEL[app.status]}
        </span>
      </div>
      <p className="app-card-desc">{app.description}</p>
      <div className="app-card-actions">
        {live && href ? (
          // Native link, descriptive label, safe rel. The WebID (when present) rides in
          // the URL fragment/query built by launchUrl — never a token.
          <a className="app-card-launch" href={href} rel="noopener noreferrer">
            {launchLabel}
            <span aria-hidden="true"> →</span>
          </a>
        ) : (
          <span className="app-card-soon" aria-disabled="true">
            Coming soon
          </span>
        )}
        {app.repo ? (
          <a className="app-card-repo" href={app.repo} target="_blank" rel="noopener noreferrer">
            Source
          </a>
        ) : null}
      </div>
    </article>
  );
}
