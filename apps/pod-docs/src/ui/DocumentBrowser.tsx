// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Docs document-browser VIEW — a list of the documents in a pod's
// Pod-Docs container (title / format / modified), click a row to open the
// document read-only (its title, metadata and body), a "Back" control to return
// to the list.
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into the create-solid-app Next.js shell's
// `components/` or any React app. It renders only — it never touches RDF or
// fetch directly; all data flows through `useDocsListing`, which calls the data
// layer (`DocsStore`). Styling is plain class names (`pod-docs-*`) so the host
// app's CSS owns the look; the component ships no styles of its own.
//
// BODY RENDERING — DELIBERATELY TEXT, NOT HTML. A Pod-Docs `pd:body` is opaque
// rich text (text/html, text/markdown, …) whose interpreting *editor engine* is
// a separate ADR (see the package README). This read-only view therefore renders
// the body as ESCAPED TEXT in a <pre>, never via dangerouslySetInnerHTML — so a
// hostile document body can never inject script/markup into the host app. A real
// editor surface is a follow-up that owns sanitisation for its chosen format.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `useDocsListing` → the data layer. See useDocsListing.ts for the full note.

import { displayTitle, formatModified } from "./format.js";
import { useDocsListing } from "./useDocsListing.js";

/** Props for {@link DocumentBrowser}. */
export interface DocumentBrowserProps {
  /** The pod root URL whose `pod-docs/` container is browsed. */
  podRoot: string;
  /** The pod owner's WebID — needed by the data layer for type-index discovery. */
  webId: string;
  /**
   * The authenticated fetch for pod reads. Omit to use the ambient global fetch
   * (patched by @solid/reactive-authentication in a real session). The
   * injectable auth seam — unit tests pass a stub here.
   */
  fetch?: typeof fetch;
  /** Optional heading rendered above the listing. */
  title?: string;
}

/**
 * Render a pod's Pod-Docs documents as a navigable list with a read-only
 * document viewer. Documents are rows (click to open); the open document shows
 * its title, metadata and body. All states — loading, empty, error, access
 * denied — are surfaced.
 */
export function DocumentBrowser({ podRoot, webId, fetch, title }: DocumentBrowserProps) {
  const { entries, openDocument, loading, opening, error, isAccessError, open, close, refresh } =
    useDocsListing(podRoot, webId, fetch ? { fetch } : {});

  const heading = title ?? "Pod Docs";

  // ── Open-document mode: a single document, read-only. ──────────────────────
  if (openDocument) {
    const doc = openDocument.data;
    return (
      <section className="pod-docs-document" aria-label={heading}>
        <nav className="pod-docs-toolbar">
          <button type="button" className="pod-docs-back" onClick={close}>
            ← Back to documents
          </button>
        </nav>
        <article>
          <h2 className="pod-docs-document-title">
            {displayTitle({ title: doc.title, name: "" })}
          </h2>
          <dl className="pod-docs-meta">
            <div>
              <dt>Format</dt>
              <dd>{doc.format}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{formatModified(doc.modified)}</dd>
            </div>
            {doc.creator ? (
              <div>
                <dt>Author</dt>
                <dd>{doc.creator}</dd>
              </div>
            ) : null}
          </dl>
          {/* Rendered as ESCAPED TEXT — never HTML — see the file header. */}
          <pre className="pod-docs-body">{doc.body}</pre>
        </article>
      </section>
    );
  }

  // ── Listing mode: every document in the container. ─────────────────────────
  return (
    <section className="pod-docs-browser" aria-label={heading}>
      <h2 className="pod-docs-title">{heading}</h2>

      {loading || opening ? (
        <p className="pod-docs-loading" role="status">
          Loading…
        </p>
      ) : null}

      {error ? (
        <div className="pod-docs-error" role="alert">
          <p>{error}</p>
          {!isAccessError ? (
            <button type="button" onClick={refresh}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !opening && !error && entries.length === 0 ? (
        <p className="pod-docs-empty">No documents yet.</p>
      ) : null}

      {!loading && !opening && !error && entries.length > 0 ? (
        <table className="pod-docs-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Modified</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.url} className="pod-docs-row">
                <td>
                  <button
                    type="button"
                    className="pod-docs-open-link"
                    onClick={() => open(entry.url)}
                  >
                    <span aria-hidden="true">📄</span> {displayTitle(entry)}
                  </button>
                </td>
                <td>{formatModified(entry.modified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
