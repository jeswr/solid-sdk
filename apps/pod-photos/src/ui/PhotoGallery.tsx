// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Photos gallery VIEW — one photo-grid screen over a Solid container:
// folder tiles first (click to descend), then a thumbnail grid of the photos in
// the current container, with a breadcrumb to climb back.
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into a create-solid-app Next.js shell's
// `components/` or any React app. It renders ONLY — it never touches RDF or
// fetch directly; all data flows through `usePhotoGallery`, which calls the data
// layer. Styling is plain class names (`pod-photos-*`) so the host app's CSS
// owns the look; the component ships no styles of its own.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `usePhotoGallery` → the data layer. See usePhotoGallery.ts for the full note.

import { breadcrumbFor } from './breadcrumb.js';
import { photoAltText, photoDimensions, photoTitle } from './format.js';
import { usePhotoGallery } from './usePhotoGallery.js';

/** Props for {@link PhotoGallery}. */
export interface PhotoGalleryProps {
  /** The container URL to open first (the gallery root). */
  rootUrl: string;
  /**
   * The authenticated fetch for pod reads. Omit to use the ambient global fetch
   * (patched by @solid/reactive-authentication in a real session). The
   * injectable auth seam — unit tests pass a stub here.
   */
  fetch?: typeof fetch;
  /** Optional heading rendered above the gallery. */
  title?: string;
}

/**
 * Render a Solid photo container as a navigable thumbnail gallery. Sub-folders
 * are buttons (click to descend); photos are figures with the image binary
 * (`schema:contentUrl`) as the thumbnail, a title caption, and optional pixel
 * dimensions. Empty / loading / error / access-denied states are all handled.
 */
export function PhotoGallery({ rootUrl, fetch, title }: PhotoGalleryProps) {
  const { listing, loading, error, isAccessError, currentUrl, navigate, refresh } = usePhotoGallery(
    rootUrl,
    fetch ? { fetch } : {},
  );

  const crumbs = breadcrumbFor(currentUrl, rootUrl);
  const folders = listing?.folders ?? [];
  const photos = listing?.photos ?? [];
  const isEmpty = folders.length === 0 && photos.length === 0;

  return (
    <section className="pod-photos-gallery" aria-label={title ?? 'Pod Photos gallery'}>
      {title ? <h2 className="pod-photos-title">{title}</h2> : null}

      <nav className="pod-photos-breadcrumb" aria-label="Breadcrumb">
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
        // <output> is the semantic live-status element (implicit role="status"),
        // so a screen reader announces the load without a redundant ARIA role.
        <output className="pod-photos-loading">Loading…</output>
      ) : null}

      {error ? (
        <div className="pod-photos-error" role="alert">
          <p>{error}</p>
          {!isAccessError ? (
            <button type="button" onClick={refresh}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && isEmpty ? (
        <p className="pod-photos-empty">No photos here yet.</p>
      ) : null}

      {!error && folders.length > 0 ? (
        <ul className="pod-photos-folders" aria-label="Folders">
          {folders.map((folder) => (
            <li key={folder.url} className="pod-photos-folder">
              <button
                type="button"
                className="pod-photos-folder-link"
                onClick={() => navigate(folder.url)}
              >
                <span aria-hidden="true">📁</span> {folder.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!error && photos.length > 0 ? (
        <ul className="pod-photos-grid" aria-label="Photos">
          {photos.map((entry) => {
            const heading = photoTitle(entry.url, entry.photo);
            const dimensions = photoDimensions(entry.photo);
            const src = entry.photo.contentUrl;
            return (
              <li key={entry.url} className="pod-photos-tile">
                <figure>
                  {src ? (
                    <img
                      className="pod-photos-thumb"
                      src={src}
                      alt={photoAltText(entry.url, entry.photo)}
                      loading="lazy"
                    />
                  ) : (
                    // A photo description with no image binary — render a
                    // placeholder rather than a broken <img> with an empty src.
                    <div className="pod-photos-thumb-missing" aria-hidden="true">
                      🖼️
                    </div>
                  )}
                  <figcaption className="pod-photos-caption">
                    <span className="pod-photos-name">{heading}</span>
                    {dimensions ? (
                      <span className="pod-photos-dimensions"> {dimensions}</span>
                    ) : null}
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
