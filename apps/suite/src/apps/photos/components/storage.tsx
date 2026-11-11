// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  EmptyState,
  ErrorState,
  formatBytes,
  IconButton,
  LoadingSkeleton,
} from "@jeswr/suite-ui";
import { HardDrive, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { LibraryPhoto } from "../lib/data/library";
import {
  createBinarySizer,
  measureUsage,
  type UsageReport,
  type UsageSource,
} from "../lib/data/usage";
import { usePhotos } from "../state/photos-context";
import { PhotoImage } from "./photo-image";
import { mediaLabel, VideoBadge } from "./video-badge";

/** Rows shown before "Show more"; the list is largest first. */
const PAGE = 25;
type Measured =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; library: UsageReport; trash: UsageReport };

export function StorageScreen() {
  const state = usePhotos();
  const [attempt, setAttempt] = useState(0);
  const [measured, setMeasured] = useState<Measured>({ status: "loading" });
  const [shown, setShown] = useState(PAGE);
  const [refreshing, setRefreshing] = useState(false);
  /** Row to focus after its predecessor moves to trash; null focuses the list heading. */
  const [focusAfter, setFocusAfter] = useState<string | null>();
  const list = useRef<HTMLElement>(null);
  const sizer = useMemo(
    () => createBinarySizer(state.session.fetch, state.io.root),
    [state.session, state.io],
  );
  const byRef = useMemo(
    () => new Map(state.photos.map((photo) => [photo.ref, photo])),
    [state.photos],
  );
  const librarySources = useMemo<UsageSource[]>(
    () =>
      state.photos.map((photo) => ({
        key: photo.ref,
        photo,
        external: photo.source === "google-photos",
      })),
    [state.photos],
  );
  const trashSources = useMemo<UsageSource[]>(
    () => state.trash.map((item) => ({ key: item.url, photo: item.photo })),
    [state.trash],
  );
  // "empty" means no library photos; the trash may still hold space worth showing.
  const ready = state.status === "ready" || state.status === "empty";
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly recalculates
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setMeasured((current) => (current.status === "ready" ? current : { status: "loading" }));
    setRefreshing(true);
    Promise.all([
      measureUsage(sizer, librarySources, { signal: controller.signal }),
      measureUsage(sizer, trashSources, { signal: controller.signal }),
    ])
      .then(([library, trash]) => {
        if (!controller.signal.aborted) setMeasured({ status: "ready", library, trash });
      })
      .catch(() => {
        if (!controller.signal.aborted) setMeasured({ status: "error" });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [ready, sizer, librarySources, trashSources, attempt]);

  useEffect(() => {
    if (focusAfter === undefined) return;
    const target =
      (focusAfter !== null &&
        list.current?.querySelector<HTMLButtonElement>(
          `[data-trash-for="${CSS.escape(focusAfter)}"]`,
        )) ||
      list.current?.querySelector<HTMLElement>("#pho-largest");
    target?.focus();
    setFocusAfter(undefined);
  }, [focusAfter]);

  if (state.status === "loading" || (ready && measured.status === "loading"))
    return <LoadingSkeleton preset="list" label="Calculating storage…" />;
  if (state.status === "error" || measured.status === "error")
    return (
      <div className="pho-page">
        <h1>Storage</h1>
        <ErrorState
          error="unreachable"
          actions={{
            retry: () =>
              state.status === "error" ? void state.refresh() : setAttempt((n) => n + 1),
          }}
        />
      </div>
    );
  if (measured.status !== "ready") return null;
  const { library, trash } = measured;
  const stored = library.items.filter((item) => item.location === "stored");
  const total = library.totalBytes + trash.totalBytes;
  return (
    <div className="pho-page pho-storage">
      <header className="pho-page-header">
        <div className="pho-header-text">
          <h1>Storage</h1>
          <p>See what takes up space in your pod and free some up.</p>
        </div>
        <div className="pho-header-actions">
          <Button
            variant="outline"
            // aria-disabled keeps focus on the button while it recalculates.
            aria-disabled={refreshing || undefined}
            onClick={() => {
              if (refreshing) return;
              sizer.clear();
              setAttempt((n) => n + 1);
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {refreshing ? "Recalculating…" : "Recalculate"}
          </Button>
        </div>
      </header>
      <section className="pho-storage-summary" aria-label="Storage summary">
        <div className="pho-storage-total">
          <HardDrive size={24} aria-hidden="true" />
          <div>
            <p className="pho-storage-figure">{formatBytes(total)}</p>
            <p>used by Photos in your pod</p>
          </div>
        </div>
        <dl className="pho-storage-breakdown">
          <div>
            <dt>Library</dt>
            <dd>
              {formatBytes(library.totalBytes)} · {plural(library.storedCount, "item")}
            </dd>
          </div>
          <div>
            <dt>Trash</dt>
            <dd>
              {formatBytes(trash.totalBytes)} · {plural(trash.storedCount, "item")}
              {trash.storedCount > 0 && (
                <>
                  {" · "}
                  <Link href="/photos/trash">Review trash</Link>
                </>
              )}
            </dd>
          </div>
        </dl>
        {library.externalCount > 0 && (
          <p className="pho-storage-note">
            {plural(library.externalCount, "imported photo")}{" "}
            {library.externalCount === 1 ? "is" : "are"} stored with Google Photos and{" "}
            {library.externalCount === 1 ? "doesn't" : "don't"} use space in your pod.
          </p>
        )}
        {library.incompleteCount + trash.incompleteCount > 0 && (
          <p className="pho-storage-note" role="status">
            Couldn't measure {plural(library.incompleteCount + trash.incompleteCount, "item")}.
            Totals may be low.
          </p>
        )}
      </section>
      <section aria-labelledby="pho-largest" ref={list}>
        <h2 id="pho-largest" tabIndex={-1}>
          Largest photos and videos
        </h2>
        {stored.length === 0 ? (
          <EmptyState
            title="No photos or videos in your pod yet"
            body="Photos and videos you upload appear here, largest first."
          />
        ) : (
          <>
            <ol className="pho-storage-list">
              {stored.slice(0, shown).map((item, index) => {
                const photo = byRef.get(item.key);
                if (!photo) return null;
                return (
                  <li key={item.key} className="pho-storage-row">
                    <Link
                      className="pho-storage-thumb"
                      href={`/photos/p/${encodeRef(photo.ref)}?from=%2Fphotos`}
                      aria-label={`Open ${mediaLabel(photo)}`}
                    >
                      <PhotoImage
                        url={
                          photo.thumbnailUrl ??
                          (photo.kind === "video" ? undefined : photo.contentUrl)
                        }
                        name={photo.name}
                      />
                      <VideoBadge photo={photo} />
                    </Link>
                    <div className="pho-storage-name">
                      <span>{photo.name}</span>
                      <span className="pho-storage-meta">
                        {dimensions(photo)}
                        {item.incomplete ? " · size partly unknown" : ""}
                      </span>
                    </div>
                    <span className="pho-storage-size">{formatBytes(item.bytes)}</span>
                    {!photo.readOnly && (
                      <IconButton
                        variant="ghost"
                        label={`Move ${photo.name} to trash`}
                        data-trash-for={item.key}
                        onClick={(event) => {
                          // Keep keyboard users in the list once this row disappears. A mouse
                          // click skips this, so the next row's tooltip doesn't pop open.
                          if (event.currentTarget.matches(":focus-visible"))
                            setFocusAfter((stored[index + 1] ?? stored[index - 1])?.key ?? null);
                          void state.moveToTrash([photo]);
                        }}
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ol>
            {stored.length > shown && (
              <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                Show more
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function dimensions(photo: LibraryPhoto) {
  const { pixelWidth, pixelHeight } = photo.exif;
  return pixelWidth && pixelHeight ? `${pixelWidth} × ${pixelHeight}` : "Unknown size";
}
