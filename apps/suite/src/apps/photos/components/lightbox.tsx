// AUTHORED-BY Codex GPT-6
"use client";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorState,
  formatBytes,
  IconButton,
  Input,
  LoadingSkeleton,
  TagInput,
  toast,
} from "@jeswr/suite-ui";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Info,
  Plus,
  Share2,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { decodeRef, encodeRef } from "@/lib/refs";
import type { LibraryPhoto } from "../lib/data/library";
import { usePhotos } from "../state/photos-context";
import { AlbumDialog } from "./album-dialogs";
import { CollectionScreen, collectionPhotos } from "./collections";
import { usePhotoUrl } from "./photo-image";

function safeFrom(value: string | null) {
  if (
    value === "/photos" ||
    value === "/photos/favourites" ||
    value?.startsWith("/photos/search?") ||
    /^\/photos\/a\/[A-Za-z0-9_-]+$/.test(value ?? "")
  )
    return value as string;
  return "/photos";
}
function ZoomImage({ photo }: { photo: LibraryPhoto }) {
  const image = usePhotoUrl(photo.contentUrl);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [decodeError, setDecodeError] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastDistance = useRef<number | null>(null);
  const adjust = (delta: number) => setZoom((value) => Math.max(1, Math.min(5, value + delta)));
  const distance = () => {
    const points = [...pointers.current.values()];
    return points.length === 2
      ? Math.hypot(
          (points[0]?.x ?? 0) - (points[1]?.x ?? 0),
          (points[0]?.y ?? 0) - (points[1]?.y ?? 0),
        )
      : null;
  };
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((value) => Math.max(1, Math.min(5, value - event.deltaY * 0.005)));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 });
  }, [zoom]);
  function move(event: PointerEvent<HTMLElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const currentDistance = distance();
    if (currentDistance && lastDistance.current) {
      const ratio = currentDistance / lastDistance.current;
      setZoom((value) => Math.max(1, Math.min(5, value * ratio)));
    } else if (zoom > 1) {
      const bounds = event.currentTarget.getBoundingClientRect();
      setPan((value) => ({
        x: Math.max(
          (-bounds.width * (zoom - 1)) / 2,
          Math.min((bounds.width * (zoom - 1)) / 2, value.x + event.clientX - previous.x),
        ),
        y: Math.max(
          (-bounds.height * (zoom - 1)) / 2,
          Math.min((bounds.height * (zoom - 1)) / 2, value.y + event.clientY - previous.y),
        ),
      }));
    }
    lastDistance.current = currentDistance;
  }
  function release(event: PointerEvent<HTMLElement>) {
    pointers.current.delete(event.pointerId);
    lastDistance.current = null;
  }
  return (
    <div className="pho-viewer">
      <figure
        className="pho-image-stage"
        ref={stage}
        aria-label="Photo viewer. Use plus and minus to zoom, drag to pan."
        onPointerDown={(event) => {
          if (!image.url || (event.target as Element).closest("button, a")) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          lastDistance.current = distance();
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {image.error || decodeError ? (
          <ErrorState
            error="unreachable"
            actions={{
              retry: () => {
                setDecodeError(false);
                image.retry();
              },
            }}
          />
        ) : image.url ? (
          // biome-ignore lint/performance/noImgElement: authenticated original is a browser-local blob
          <img
            src={image.url}
            alt={photo.name}
            draggable={false}
            onError={() => setDecodeError(true)}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          />
        ) : (
          <LoadingSkeleton preset="detail" label="Loading original photo…" />
        )}
      </figure>
      <div className="pho-zoom">
        <IconButton
          label="Zoom out"
          variant="outline"
          disabled={zoom === 1}
          onClick={() => adjust(-0.25)}
        >
          <ZoomOut size={18} />
        </IconButton>
        <Button variant="outline" onClick={() => setZoom(1)} aria-label="Reset zoom">
          {Math.round(zoom * 100)}%
        </Button>
        <IconButton
          label="Zoom in"
          variant="outline"
          disabled={zoom === 5}
          onClick={() => adjust(0.25)}
        >
          <ZoomIn size={18} />
        </IconButton>
      </div>
      {zoom > 1 && (
        <div className="pho-pan">
          {(
            [
              ["Left", -40, 0],
              ["Up", 0, -40],
              ["Down", 0, 40],
              ["Right", 40, 0],
            ] as const
          ).map(([label, x, y]) => (
            <Button
              key={label}
              size="sm"
              variant="outline"
              onClick={() => setPan((value) => ({ x: value.x + x, y: value.y + y }))}
            >
              Pan {label}
            </Button>
          ))}
        </div>
      )}
      <p className="pho-file-size">
        {image.size === undefined ? "Original photo" : formatBytes(image.size)}
      </p>
    </div>
  );
}
function InfoPane({ photo }: { photo: LibraryPhoto }) {
  const state = usePhotos();
  const [newTag, setNewTag] = useState("");
  const exif = photo.exif;
  const options = [...new Set(state.photos.flatMap((item) => item.keywords))].map((tag) => ({
    id: tag,
    label: tag,
  }));
  const albums = state.albums.filter((album) => album.members.includes(photo.ref));
  const details = [
    [
      "Date taken",
      exif.dateTimeOriginal
        ? `${new Date(exif.dateTimeOriginal).toLocaleString("en", { timeZone: "UTC" })} UTC`
        : "Not recorded",
    ],
    [
      "Uploaded",
      photo.created
        ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
            new Date(photo.created),
          )
        : "Not recorded",
    ],
    ["File name", photo.name],
    [
      "Dimensions",
      exif.pixelWidth && exif.pixelHeight
        ? `${exif.pixelWidth} × ${exif.pixelHeight} px`
        : "Not recorded",
    ],
    ["Camera", [exif.make, exif.model].filter(Boolean).join(" ") || "Not recorded"],
    ["Lens", exif.lensModel ?? "Not recorded"],
    [
      "Exposure",
      exif.exposureTimeSec
        ? `${exif.exposureTimeSec} s${exif.fNumber ? ` · ƒ/${exif.fNumber}` : ""}`
        : exif.fNumber
          ? `ƒ/${exif.fNumber}`
          : "Not recorded",
    ],
    ["ISO", exif.iso ?? "Not recorded"],
    ["Focal length", exif.focalLengthMm ? `${exif.focalLengthMm} mm` : "Not recorded"],
  ];
  const editable = !photo.readOnly;
  return (
    <aside className="pho-info" aria-label="Photo information">
      <h2>Information</h2>
      <dl>
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {exif.location && (
        <div className="pho-location">
          <h3>Location</h3>
          <p>
            {exif.location.lat.toFixed(6)}, {exif.location.long.toFixed(6)}
          </p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${exif.location.lat}&mlon=${exif.location.long}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Maps ↗
          </a>
        </div>
      )}
      <h3>Albums</h3>
      {albums.length ? (
        <ul>
          {albums.map((album) => (
            <li key={album.url}>
              <Link href={`/photos/a/${encodeRef(album.url)}`}>{album.name}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>Not in an album yet.</p>
      )}
      <TagInput
        label="Keywords"
        value={photo.keywords}
        options={options}
        disabled={!editable}
        onChange={(value) => {
          void state.keywords(photo, value);
        }}
      />
      {editable && (
        <form
          className="pho-add-keyword"
          onSubmit={(event) => {
            event.preventDefault();
            if (newTag.trim()) {
              void state.keywords(photo, [...new Set([...photo.keywords, newTag.trim()])]);
              setNewTag("");
            }
          }}
        >
          <label htmlFor="pho-keyword">New keyword</label>
          <div>
            <Input
              id="pho-keyword"
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!newTag.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}
      {!editable && <p>Imported metadata is read-only.</p>}
    </aside>
  );
}
export function LightboxScreen() {
  const state = usePhotos();
  const params = useParams<{ ref: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const from = safeFrom(search.get("from"));
  const [info, setInfo] = useState(false);
  const [add, setAdd] = useState(false);
  let ref: string | undefined;
  try {
    ref = decodeRef(params.ref);
  } catch {
    /* Show the unavailable view. */
  }
  const collection = collectionPhotos(state.photos, state.albums, state.favourites, from);
  const photo = state.photos.find((item) => item.ref === ref);
  const index = collection.findIndex((item) => item.ref === ref);
  const previous = collection[index - 1];
  const next = collection[index + 1];
  const route = (item: LibraryPhoto) =>
    `/photos/p/${encodeRef(item.ref)}?from=${encodeURIComponent(from)}`;
  const close = () =>
    router.push(`${from}${from.includes("?") ? "&" : "?"}focus=${encodeURIComponent(params.ref)}`, {
      scroll: false,
    });
  async function download() {
    if (!photo) return;
    try {
      const fetch = createPodScopedFetch(state.session.storageUrl, { fetch: state.session.fetch });
      const response = await fetch(photo.contentUrl);
      if (!response.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = photo.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Download started");
    } catch {
      toast.error("Couldn't download this photo. Please try again.");
    }
  }
  return (
    <>
      <div aria-hidden="true">
        <CollectionScreen
          collectionPath={from}
          kind={
            from.startsWith("/photos/a/")
              ? "album"
              : from.startsWith("/photos/favourites")
                ? "favourites"
                : from.startsWith("/photos/search")
                  ? "search"
                  : "timeline"
          }
        />
      </div>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !add) close();
        }}
      >
        <DialogContent
          className="pho-lightbox"
          showCloseButton={false}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("input, textarea, select, [role=combobox]")) return;
            if (event.key === "ArrowLeft" && previous) {
              event.preventDefault();
              router.replace(route(previous), { scroll: false });
            }
            if (event.key === "ArrowRight" && next) {
              event.preventDefault();
              router.replace(route(next), { scroll: false });
            }
            if (event.key.toLowerCase() === "i") {
              event.preventDefault();
              setInfo((value) => !value);
            }
            if (["+", "=", "-", "0"].includes(event.key)) {
              event.preventDefault();
              document
                .querySelector<HTMLButtonElement>(
                  event.key === "0"
                    ? 'button[aria-label="Reset zoom"]'
                    : event.key === "-"
                      ? 'button[aria-label="Zoom out"]'
                      : 'button[aria-label="Zoom in"]',
                )
                ?.click();
            }
          }}
        >
          <DialogTitle className="sr-only">{photo?.name ?? "Photo"}</DialogTitle>
          <DialogDescription className="sr-only">
            Photo viewer. Left and right arrows browse, i toggles information, plus and minus zoom,
            Escape returns to your collection.
          </DialogDescription>
          <header className="pho-lightbox-header">
            <IconButton label="Close photo" variant="ghost" onClick={close}>
              <X size={20} />
            </IconButton>
            <h1>{photo?.name ?? "Photo"}</h1>
            <span className="pho-position">
              {index >= 0 ? `${index + 1} / ${collection.length}` : ""}
            </span>
          </header>
          {state.status === "loading" ? (
            <LoadingSkeleton preset="detail" />
          ) : state.status === "error" ? (
            <ErrorState
              error="unreachable"
              actions={{
                retry: () => {
                  void state.refresh();
                },
              }}
            />
          ) : !photo ? (
            <div className="pho-unavailable">
              <p>This photo is unavailable. It may have been moved to trash.</p>
              <Button onClick={close}>Back to photos</Button>
            </div>
          ) : (
            <>
              <div className="pho-lightbox-actions">
                <IconButton
                  label={state.favourites.includes(photo.ref) ? "Remove favourite" : "Favourite"}
                  variant="ghost"
                  aria-pressed={state.favourites.includes(photo.ref)}
                  onClick={() => {
                    void state.favourite([photo.ref], !state.favourites.includes(photo.ref));
                  }}
                >
                  <Heart
                    size={20}
                    fill={state.favourites.includes(photo.ref) ? "currentColor" : "none"}
                  />
                </IconButton>
                <IconButton
                  label="Download original"
                  variant="ghost"
                  onClick={() => {
                    void download();
                  }}
                >
                  <Download size={20} />
                </IconButton>
                <IconButton label="Add to album" variant="ghost" onClick={() => setAdd(true)}>
                  <Plus size={20} />
                </IconButton>
                <span title="Sharing arrives with the suite share dialog">
                  <IconButton label="Share" variant="ghost" disabled>
                    <Share2 size={20} />
                  </IconButton>
                </span>
                <IconButton
                  label="Move to trash"
                  variant="ghost"
                  disabled={photo.readOnly}
                  onClick={() => {
                    void state.moveToTrash([photo]).then((ok) => {
                      if (ok) close();
                    });
                  }}
                >
                  <Trash2 size={20} />
                </IconButton>
                <IconButton
                  label={info ? "Hide information" : "Show information"}
                  variant="ghost"
                  aria-pressed={info}
                  onClick={() => setInfo(!info)}
                >
                  <Info size={20} />
                </IconButton>
              </div>
              <div className="pho-lightbox-body" data-info={info}>
                <div className="pho-lightbox-image">
                  <ZoomImage key={photo.ref} photo={photo} />
                  <div className="pho-prev-next">
                    {previous ? (
                      <Link href={route(previous)} replace aria-label="Previous photo">
                        <ChevronLeft size={24} />
                      </Link>
                    ) : (
                      <span />
                    )}
                    {next ? (
                      <Link href={route(next)} replace aria-label="Next photo">
                        <ChevronRight size={24} />
                      </Link>
                    ) : (
                      <span />
                    )}
                  </div>
                </div>
                {info && <InfoPane key={photo.ref} photo={photo} />}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlbumDialog open={add} refs={photo ? [photo.ref] : []} onClose={() => setAdd(false)} />
    </>
  );
}
