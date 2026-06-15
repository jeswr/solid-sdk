// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Drive file-browser VIEW — one cloud-drive-style listing of a Solid
// container: folders first, then files, each with kind / size / modified-date,
// click a folder to descend, a breadcrumb to climb back.
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into the create-solid-app Next.js shell's
// `components/` (like the template's ProfileCard) or any React app. It renders
// only — it never touches RDF or fetch directly; all data flows through
// `useDriveListing`, which calls the data layer. Styling is plain class names
// (`pod-drive-*`) so the host app's CSS (the shell's Tailwind/shadcn) owns the
// look; the component ships no styles of its own.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `useDriveListing` → the data layer. See useDriveListing.ts for the full note.

import { breadcrumbFor } from "./breadcrumb.js";
import { displayName, formatKind, formatModified, formatSize } from "./format.js";
import { useDriveListing } from "./useDriveListing.js";

/** Props for {@link FileBrowser}. */
export interface FileBrowserProps {
  /** The container URL to open first (the drive root). */
  rootUrl: string;
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
 * Render a Solid container as a navigable file list. Folders are buttons (click
 * to descend); files are plain rows linking to their resource URL.
 */
export function FileBrowser({ rootUrl, fetch, title }: FileBrowserProps) {
  const { listing, loading, error, isAccessError, currentUrl, navigate, refresh } = useDriveListing(
    rootUrl,
    fetch ? { fetch } : {},
  );

  const crumbs = breadcrumbFor(currentUrl, rootUrl);
  const entries = listing?.container.entries ?? [];

  return (
    <section className="pod-drive-browser" aria-label={title ?? "Pod Drive file browser"}>
      {title ? <h2 className="pod-drive-title">{title}</h2> : null}

      <nav className="pod-drive-breadcrumb" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <li key={crumb.url}>
                {isLast ? (
                  <span aria-current="page">{crumb.label}</span>
                ) : (
                  <button type="button" onClick={() => navigate(crumb.url)}>
                    {crumb.label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {loading ? (
        <p className="pod-drive-loading" role="status">
          Loading…
        </p>
      ) : null}

      {error ? (
        <div className="pod-drive-error" role="alert">
          <p>{error}</p>
          {!isAccessError ? (
            <button type="button" onClick={refresh}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <p className="pod-drive-empty">This folder is empty.</p>
      ) : null}

      {!error && entries.length > 0 ? (
        <table className="pod-drive-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Size</th>
              <th scope="col">Modified</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const name = displayName(entry);
              return (
                <tr
                  key={entry.url}
                  className={entry.isContainer ? "pod-drive-row-folder" : "pod-drive-row-file"}
                >
                  <td>
                    {entry.isContainer ? (
                      <button
                        type="button"
                        className="pod-drive-folder-link"
                        onClick={() => navigate(entry.url)}
                      >
                        <span aria-hidden="true">📁</span> {name}
                      </button>
                    ) : (
                      <a
                        className="pod-drive-file-link"
                        href={entry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span aria-hidden="true">📄</span> {name}
                      </a>
                    )}
                  </td>
                  <td>{formatKind(entry)}</td>
                  <td>{formatSize(entry.size)}</td>
                  <td>{formatModified(entry.modifiedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
