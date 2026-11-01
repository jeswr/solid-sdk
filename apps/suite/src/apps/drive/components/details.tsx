// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * Details pane (04-drive §2.8): who has access, the item's facts and, under
 * "Show technical details", its content type and address.
 */

import { Button, IconButton } from "@jeswr/suite-ui";
import { Copy, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { type DriveItem, parentOf } from "../lib/client/client";
import { formatFileSize } from "../lib/files";
import { breadcrumbs } from "../lib/files/breadcrumbs";
import { formatModified, formatSize, friendlyType } from "../lib/view/view";
import { useAccessLabel } from "../state/access";
import { useDrive } from "../state/drive-context";
import { useItemOwner } from "../state/ownership";
import { useLiveItems } from "../state/resource";
import { useDriveUi } from "../state/ui";
import { ItemIcon } from "./item-icon";
import { ProtectionBanner } from "./protection-banner";

function Location({ url }: { url: string }) {
  const { driveRoot } = useDrive();
  const parent = parentOf(url);
  if (!parent || !driveRoot) return <>—</>;
  let trail: { label: string; url: string }[] = [];
  try {
    trail = breadcrumbs(parent, driveRoot);
  } catch {
    return <>{parent}</>;
  }
  return (
    <span className="drv-details-location">
      <Link href="/drive/my">My Drive</Link>
      {trail.map((segment) => (
        <span key={segment.url}>
          {" › "}
          <Link href={`/drive/f/${encodeRef(segment.url)}`}>{segment.label}</Link>
        </span>
      ))}
    </span>
  );
}

export function DetailsPane({
  onClose,
  items,
}: {
  onClose: () => void;
  items?: readonly DriveItem[];
}) {
  const { detailsItems: selectedItems } = useDriveUi();
  const detailsItems = useLiveItems(items ?? selectedItems);
  const accessId = useId();
  const factsId = useId();
  const [technical, setTechnical] = useState(false);
  const item = detailsItems[0];
  const owner = useItemOwner(detailsItems.length === 1 ? item?.url : undefined);
  const access = useAccessLabel(detailsItems.length === 1 ? detailsItems[0]?.url : undefined);
  if (!item) {
    return (
      <div className="drv-details">
        <div className="drv-details-head">
          <h2>Details</h2>
          <IconButton label="Close details" variant="ghost" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </IconButton>
        </div>
        <p className="drv-details-empty">Select an item to see its details</p>
      </div>
    );
  }
  if (detailsItems.length > 1) {
    const total = detailsItems.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
    return (
      <div className="drv-details">
        <div className="drv-details-head">
          <h2>{detailsItems.length} items selected</h2>
          <IconButton label="Close details" variant="ghost" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </IconButton>
        </div>
        <p className="drv-details-empty">
          {detailsItems.length} items selected · {formatFileSize(Math.round(total))}
        </p>
      </div>
    );
  }
  return (
    <div className="drv-details">
      <div className="drv-details-head">
        <ItemIcon item={item} size={24} />
        <h2>{item.name}</h2>
        <IconButton label="Close details" variant="ghost" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </IconButton>
      </div>
      <ProtectionBanner key={item.url} item={item} />
      <section aria-labelledby={accessId}>
        <h3 id={accessId}>Who has access</h3>
        <p className="drv-access-line" role="status" aria-live="polite">
          {access}
        </p>
        <Button variant="outline" size="sm" disabled title="Sharing arrives with the share dialog">
          Manage access
        </Button>
      </section>
      <section aria-labelledby={factsId}>
        <h3 id={factsId}>Details</h3>
        <dl className="drv-facts">
          <div>
            <dt>Type</dt>
            <dd>{friendlyType(item)}</dd>
          </div>
          {item.kind === "file" ? (
            <div>
              <dt>Size</dt>
              <dd>{formatSize(item)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Location</dt>
            <dd>
              <Location url={item.url} />
            </dd>
          </div>
          <div>
            <dt>Modified</dt>
            <dd>{formatModified(item.modified)}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{owner?.label ?? "Unknown"}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="drv-link-button"
          onClick={() => setTechnical((on) => !on)}
          aria-expanded={technical}
        >
          {technical ? "Hide technical details" : "Show technical details"}
        </button>
        {technical ? (
          <dl className="drv-facts">
            <div>
              <dt>Content type</dt>
              <dd>{item.kind === "folder" ? "Container" : (item.contentType ?? "Unknown")}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd className="drv-address">
                <code>{item.url}</code>
                <IconButton
                  label="Copy address"
                  variant="ghost"
                  onClick={() => void navigator.clipboard.writeText(item.url)}
                >
                  <Copy aria-hidden="true" size={16} />
                </IconButton>
              </dd>
            </div>
            <div>
              <dt>Owner Account ID</dt>
              <dd>
                <code>{owner?.webId ?? "Unknown"}</code>
              </dd>
            </div>
          </dl>
        ) : null}
      </section>
    </div>
  );
}
