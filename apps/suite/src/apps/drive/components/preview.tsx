// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * File preview (04-drive §2.7, §4.6): the full-screen preview dialog over a
 * listing (←/→ step through the folder's files) and the same viewer as a page
 * on a direct load of `/drive/p/[ref]`. The body picks a renderer by content
 * type; typed RDF shows a readable summary until DS-12 `TypedView` lands.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Skeleton,
} from "@jeswr/suite-ui";
import type { Quad } from "@rdfjs/types";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Info, Star, X } from "lucide-react";
import Link from "next/link";
import {
  type MouseEventHandler,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { encodeRef } from "@/lib/refs";
import type { DriveClient, DriveItem } from "../lib/client/client";
import { parseCsv, previewKind } from "../lib/view/view";
import { useDrive } from "../state/drive-context";
import { useDriveActions, useDriveUi } from "../state/ui";
import { DetailsPane } from "./details";
import { ItemIcon } from "./item-icon";

const TEXT_LIMIT = 1024 * 1024;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

type Loaded =
  | { status: "loading" }
  | { status: "error" }
  | { status: "blob"; url: string }
  | { status: "text"; text: string; truncated: boolean }
  | { status: "rdf"; quads: Quad[] };

const LABELS: Record<string, string> = {
  fn: "Name",
  hasEmail: "Email",
  hasTelephone: "Phone",
  "organization-name": "Organization",
  hasAddress: "Address",
  note: "Note",
  title: "Title",
  name: "Name",
};

/** A readable label for a vocabulary term (types and properties). */
function termLabel(iri: string): string {
  const tail = iri.split(/[#/]/).filter(Boolean).pop() ?? iri;
  return (
    (Object.hasOwn(LABELS, tail) ? LABELS[tail] : undefined) ??
    tail
      .replace(/[-_]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase())
  );
}

function filePreviewKind(item: DriveItem) {
  // SVG is safe in an image element, which does not execute its scripts.
  return item.contentType?.toLowerCase() === "image/svg+xml"
    ? "image"
    : previewKind(item.contentType);
}

/** A readable value for an object IRI: contact schemes lose their prefix. */
function valueLabel(iri: string): string {
  const contact = /^(?:mailto|tel):(.+)$/i.exec(iri);
  if (contact?.[1]) {
    try {
      return decodeURIComponent(contact[1]);
    } catch {
      return iri;
    }
  }
  return termLabel(iri);
}

function useLoadedFile(client: DriveClient, item: DriveItem): Loaded {
  const kind = filePreviewKind(item);
  const [state, setState] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    let live = true;
    let objectUrl: string | undefined;
    setState({ status: "loading" });
    if (kind === "none") {
      setState({ status: "error" });
      return;
    }
    const run = async () => {
      if (kind === "rdf") {
        const result = await client.readRdf(item.url);
        return { status: "rdf", quads: result ? [...result.dataset] : [] } as const;
      }
      const blob = await client.read(item.url);
      if (kind === "text" || kind === "markdown" || kind === "csv") {
        const slice = blob.size > TEXT_LIMIT ? blob.slice(0, TEXT_LIMIT) : blob;
        return {
          status: "text",
          text: await slice.text(),
          truncated: blob.size > TEXT_LIMIT,
        } as const;
      }
      let media = blob;
      if (kind === "pdf") {
        if ((await blob.slice(0, 5).text()) !== "%PDF-") return { status: "error" } as const;
        // The listing and GET may disagree. Never embed an HTML blob on our origin.
        media = new Blob([blob], { type: "application/pdf" });
      } else if (kind === "image" && !blob.type.startsWith("image/")) {
        return { status: "error" } as const;
      }
      objectUrl = URL.createObjectURL(media);
      // A read may finish after cleanup has already run.
      if (!live) URL.revokeObjectURL(objectUrl);
      return { status: "blob", url: objectUrl } as const;
    };
    run().then(
      (loaded) => live && setState(loaded),
      () => live && setState({ status: "error" }),
    );
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, item.url, kind]);
  return state;
}

function RdfSummary({ quads }: { quads: Quad[] }) {
  const subjects = useMemo(() => {
    const map = new Map<string, Quad[]>();
    for (const quad of quads) {
      const key = quad.subject.value;
      map.set(key, [...(map.get(key) ?? []), quad]);
    }
    return [...map.entries()];
  }, [quads]);
  if (subjects.length === 0) return <p className="drv-preview-note">This data file is empty.</p>;
  return (
    <div className="drv-rdf">
      {subjects.map(([subject, statements]) => {
        const types = statements
          .filter((q) => q.predicate.value === RDF_TYPE)
          .map((q) => termLabel(q.object.value));
        const rest = statements.filter((q) => q.predicate.value !== RDF_TYPE);
        return (
          <section key={subject} className="drv-rdf-card">
            <h2>{types.length > 0 ? types.join(", ") : "Item"}</h2>
            <dl>
              {rest.map((quad) => (
                <div key={`${quad.predicate.value}|${quad.object.value}`}>
                  <dt>{termLabel(quad.predicate.value)}</dt>
                  <dd>
                    {quad.object.termType === "Literal"
                      ? quad.object.value
                      : valueLabel(quad.object.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

export function PreviewBody({ item }: { item: DriveItem }) {
  const { client } = useDrive();
  const actions = useDriveActions();
  const loaded = useLoadedFile(client, item);
  const kind = filePreviewKind(item);
  if (loaded.status === "loading")
    return <Skeleton className="drv-preview-skeleton" aria-label="Loading preview" />;
  if (loaded.status === "error") {
    return (
      <div className="drv-state">
        <div className="drv-state-icon" aria-hidden="true">
          <ItemIcon item={item} size={48} />
        </div>
        <h2>Can't preview this file</h2>
        <Button onClick={() => void actions.download(item)}>
          <Download aria-hidden="true" size={16} /> Download
        </Button>
      </div>
    );
  }
  if (loaded.status === "rdf") return <RdfSummary quads={loaded.quads} />;
  if (loaded.status === "text") {
    const note = loaded.truncated ? (
      <p className="drv-preview-note">Showing the first 1 MB.</p>
    ) : null;
    if (kind === "csv") {
      const [header, ...rows] = parseCsv(loaded.text);
      return (
        <div className="drv-preview-scroll">
          <table className="drv-csv">
            {header ? (
              <thead>
                <tr>
                  {header.map((cell, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                    <th key={index} scope="col">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                <tr key={r}>
                  {row.map((cell, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {note}
        </div>
      );
    }
    return (
      <div className="drv-preview-scroll">
        <pre className="drv-preview-text">{loaded.text}</pre>
        {note}
      </div>
    );
  }
  switch (kind) {
    case "image":
      // biome-ignore lint/performance/noImgElement: blob URLs bypass the Next image loader
      return <img className="drv-preview-image" src={loaded.url} alt={item.name} />;
    case "pdf":
      return <iframe className="drv-preview-frame" src={loaded.url} title={item.name} sandbox="" />;
    case "audio":
      // biome-ignore lint/a11y/useMediaCaption: user files have no caption track
      return <audio controls src={loaded.url} />;
    default:
      // biome-ignore lint/a11y/useMediaCaption: user files have no caption track
      return <video className="drv-preview-image" controls src={loaded.url} />;
  }
}

function PreviewHeader({
  item,
  leading,
  trailing,
  onDetails,
  detailsOpen,
}: {
  item: DriveItem;
  leading?: ReactNode;
  trailing?: ReactNode;
  onDetails?: MouseEventHandler<HTMLButtonElement>;
  detailsOpen?: boolean;
}) {
  const actions = useDriveActions();
  const ui = useDriveUi();
  const starred = actions.starred.has(item.url);
  return (
    <header className="drv-preview-header">
      {leading}
      <ItemIcon item={item} size={24} />
      <span className="drv-preview-title">{item.name}</span>
      <div className="drv-preview-actions">
        <IconButton label="Download" variant="ghost" onClick={() => void actions.download(item)}>
          <Download aria-hidden="true" size={18} />
        </IconButton>
        <IconButton
          label={starred ? "Remove star" : "Star"}
          variant="ghost"
          aria-pressed={starred}
          onClick={() => actions.toggleStar([item])}
        >
          <Star aria-hidden="true" size={18} fill={starred ? "currentColor" : "none"} />
        </IconButton>
        <IconButton
          label="Details"
          variant="ghost"
          aria-expanded={detailsOpen}
          onClick={
            onDetails ??
            (() => {
              ui.setDetailsItems([item]);
              ui.setDetailsOpen((open) => !open);
            })
          }
        >
          <Info aria-hidden="true" size={18} />
        </IconButton>
        {trailing}
      </div>
    </header>
  );
}

/** The preview over a listing; ←/→ step through the listing's files. */
export function PreviewDialog() {
  const { preview, setPreview } = useDriveUi();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const item = preview?.items[preview.index];
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      const index = preview.index + delta;
      if (index < 0 || index >= preview.items.length) return;
      event.preventDefault();
      setPreview({ ...preview, index });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [preview, setPreview]);
  if (!preview || !item) return null;
  const step = (delta: number) => setPreview({ ...preview, index: preview.index + delta });
  return (
    <Dialog open onOpenChange={(open) => !open && setPreview(undefined)}>
      <DialogContent
        className="drv-preview-dialog"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Focus the viewer, not the first toolbar button (its tooltip would cover the header).
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        onCloseAutoFocus={(event) => {
          // Return focus to the previewed file's row so list shortcuts keep working.
          const row = document.querySelector<HTMLElement>(`[data-url="${CSS.escape(item.url)}"]`);
          if (row) {
            event.preventDefault();
            row.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">{item.name}</DialogTitle>
        <DialogDescription className="sr-only">
          File {preview.index + 1} of {preview.items.length}. Use the arrow keys for the previous or
          next file.
        </DialogDescription>
        <PreviewHeader
          item={item}
          detailsOpen={detailsOpen}
          onDetails={(event) => {
            detailsTrigger.current = event.currentTarget;
            setDetailsOpen((open) => !open);
          }}
          trailing={
            <IconButton label="Close" variant="ghost" onClick={() => setPreview(undefined)}>
              <X aria-hidden="true" size={18} />
            </IconButton>
          }
        />
        <div className="drv-preview-content">
          <div className="drv-preview-body">
            {preview.index > 0 ? (
              <IconButton
                label="Previous file"
                className="drv-preview-nav"
                data-side="prev"
                variant="secondary"
                onClick={() => step(-1)}
              >
                <ChevronLeft aria-hidden="true" size={20} />
              </IconButton>
            ) : null}
            <PreviewBody key={item.url} item={item} />
            {preview.index < preview.items.length - 1 ? (
              <IconButton
                label="Next file"
                className="drv-preview-nav"
                data-side="next"
                variant="secondary"
                onClick={() => step(1)}
              >
                <ChevronRight aria-hidden="true" size={20} />
              </IconButton>
            ) : null}
          </div>
          {detailsOpen ? (
            <aside className="drv-preview-details" aria-label="Details">
              <DetailsPane
                items={[item]}
                onClose={() => {
                  setDetailsOpen(false);
                  detailsTrigger.current?.focus();
                }}
              />
            </aside>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Direct load of `/drive/p/[ref]`: the viewer as a page with a way back. */
export function PreviewPage({ item, parent }: { item: DriveItem; parent: string | undefined }) {
  const { driveRoot } = useDrive();
  const back = !parent || parent === driveRoot ? "/drive/my" : `/drive/f/${encodeRef(parent)}`;
  return (
    <div className="drv-preview-page">
      <h1 className="sr-only">{item.name}</h1>
      <PreviewHeader
        item={item}
        leading={
          <Link href={back} className="drv-back" aria-label="Back to folder">
            <ArrowLeft aria-hidden="true" size={18} />
          </Link>
        }
      />
      <div className="drv-preview-body">
        <PreviewBody item={item} />
      </div>
    </div>
  );
}
