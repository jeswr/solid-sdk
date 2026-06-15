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

import { useState } from "react";
import { displayTitle, formatModified } from "./format.js";
import { type SaveStatus, useDocsListing } from "./useDocsListing.js";

/**
 * The "Saving…/Saved/failed" indicator shared by the create + save-edit flows.
 * Renders nothing while idle. The failed state carries the user-facing message
 * (already login-/permission-flavoured for a 401/403) in an `alert` — the hook
 * always sets `error` when `status` is `failed`, so the alert is never empty.
 */
function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="pod-docs-save-status" role="status">
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="pod-docs-save-status" role="status">
        Saved
      </span>
    );
  }
  return (
    <span className="pod-docs-save-status pod-docs-save-failed" role="alert">
      {error}
    </span>
  );
}

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
  const {
    entries,
    openDocument,
    loading,
    opening,
    error,
    isAccessError,
    open,
    close,
    refresh,
    saveStatus,
    saveError,
    createDocument,
    saveOpenDocument,
  } = useDocsListing(podRoot, webId, fetch ? { fetch } : {});

  const heading = title ?? "Pod Docs";

  // ── Open-document mode: a single document with a minimal body editor. ───────
  if (openDocument) {
    return (
      <OpenDocumentView
        // Remount the editor when the open resource changes so its draft state
        // resets to the new document's body (a stale draft must not leak across
        // documents).
        key={openDocument.url}
        body={openDocument.data.body}
        docTitle={openDocument.data.title}
        format={openDocument.data.format}
        modified={openDocument.data.modified}
        creator={openDocument.data.creator}
        heading={heading}
        saveStatus={saveStatus}
        saveError={saveError}
        onBack={close}
        onSave={saveOpenDocument}
      />
    );
  }

  // ── Listing mode: every document in the container + a create form. ──────────
  return (
    <section className="pod-docs-browser" aria-label={heading}>
      <h2 className="pod-docs-title">{heading}</h2>

      <NewDocumentForm saveStatus={saveStatus} saveError={saveError} onCreate={createDocument} />

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
            {entries.map((entry) => {
              // An optimistic placeholder (local-only temp URL) is not yet a real
              // pod resource — show it, but don't let a click drive a read of a
              // URL the store's scope guard would reject.
              const pending = entry.url.startsWith(PENDING_URL_PREFIX);
              return (
                <tr key={entry.url} className="pod-docs-row">
                  <td>
                    <button
                      type="button"
                      className="pod-docs-open-link"
                      onClick={() => open(entry.url)}
                      disabled={pending}
                    >
                      <span aria-hidden="true">📄</span> {displayTitle(entry)}
                      {pending ? <span className="pod-docs-pending"> (pending)</span> : null}
                    </button>
                  </td>
                  <td>{formatModified(entry.modified)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/**
 * Local-only URL prefix for an optimistic create placeholder (kept in sync with
 * `useDocsListing`'s `createDocument`). A row with this prefix is a pending,
 * not-yet-persisted document — never a real pod resource.
 */
const PENDING_URL_PREFIX = "pod-docs:pending:";

/** Props for {@link NewDocumentForm}. */
interface NewDocumentFormProps {
  saveStatus: SaveStatus;
  saveError: string | null;
  onCreate: (input: { title: string; body: string }) => void | Promise<void>;
}

/**
 * The "New document" control: a collapsed button that expands to a title + body
 * form. On submit it delegates to the optimistic `createDocument`; the hook
 * inserts the row + opens the new doc, so this form only resets + closes itself.
 * The Saving…/Saved/failed indicator renders inline.
 */
function NewDocumentForm({ saveStatus, saveError, onCreate }: NewDocumentFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  // Both blank → nothing to create. Disabling the submit is the primary guard;
  // the hook also rejects this case (defence in depth + a clear message).
  const isBlank = draftTitle.trim() === "" && draftBody.trim() === "";

  if (!expanded) {
    return (
      <div className="pod-docs-new">
        <button type="button" className="pod-docs-new-button" onClick={() => setExpanded(true)}>
          + New document
        </button>
        <SaveIndicator status={saveStatus} error={saveError} />
      </div>
    );
  }

  return (
    <form
      className="pod-docs-new-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (isBlank) return;
        // Fire-and-forget: the hook owns the optimistic insert + open. Reset the
        // draft and collapse the form so the listing (now showing the new row)
        // is in view.
        void onCreate({ title: draftTitle, body: draftBody });
        setDraftTitle("");
        setDraftBody("");
        setExpanded(false);
      }}
    >
      <label className="pod-docs-field">
        <span>Title</span>
        <input
          type="text"
          className="pod-docs-new-title"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="Untitled document"
        />
      </label>
      <label className="pod-docs-field">
        <span>Body</span>
        <textarea
          className="pod-docs-new-body"
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={4}
        />
      </label>
      <div className="pod-docs-new-actions">
        <button type="submit" className="pod-docs-new-submit" disabled={isBlank}>
          Create document
        </button>
        <button
          type="button"
          className="pod-docs-new-cancel"
          onClick={() => {
            setDraftTitle("");
            setDraftBody("");
            setExpanded(false);
          }}
        >
          Cancel
        </button>
        <SaveIndicator status={saveStatus} error={saveError} />
      </div>
    </form>
  );
}

/** Props for {@link OpenDocumentView}. */
interface OpenDocumentViewProps {
  body: string;
  docTitle: string;
  format: string;
  modified: string | undefined;
  creator: string | undefined;
  heading: string;
  saveStatus: SaveStatus;
  saveError: string | null;
  onBack: () => void;
  onSave: (body: string) => void | Promise<void>;
}

/**
 * The open-document view: metadata + a minimal body editor (a plain textarea —
 * the rich editor engine is a separate ADR). Saving is OPTIMISTIC via the hook;
 * this component owns only the draft body + dirty tracking. The original body is
 * still rendered as ESCAPED TEXT in a <pre> below the editor (never HTML — the
 * XSS guard from the read view holds).
 */
function OpenDocumentView({
  body,
  docTitle,
  format,
  modified,
  creator,
  heading,
  saveStatus,
  saveError,
  onBack,
  onSave,
}: OpenDocumentViewProps) {
  const [draft, setDraft] = useState(body);
  const dirty = draft !== body;

  return (
    <section className="pod-docs-document" aria-label={heading}>
      <nav className="pod-docs-toolbar">
        <button type="button" className="pod-docs-back" onClick={onBack}>
          ← Back to documents
        </button>
      </nav>
      <article>
        <h2 className="pod-docs-document-title">{displayTitle({ title: docTitle, name: "" })}</h2>
        <dl className="pod-docs-meta">
          <div>
            <dt>Format</dt>
            <dd>{format}</dd>
          </div>
          <div>
            <dt>Modified</dt>
            <dd>{formatModified(modified)}</dd>
          </div>
          {creator ? (
            <div>
              <dt>Author</dt>
              <dd>{creator}</dd>
            </div>
          ) : null}
        </dl>

        <form
          className="pod-docs-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dirty) return;
            void onSave(draft);
          }}
        >
          <label className="pod-docs-field">
            <span>Body</span>
            <textarea
              className="pod-docs-edit-body"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
            />
          </label>
          <div className="pod-docs-edit-actions">
            <button type="submit" className="pod-docs-save" disabled={!dirty}>
              Save
            </button>
            <SaveIndicator status={saveStatus} error={saveError} />
          </div>
        </form>

        {/* The persisted body, rendered as ESCAPED TEXT — never HTML — see the
            file header (the XSS guard). */}
        <pre className="pod-docs-body">{body}</pre>
      </article>
    </section>
  );
}
