// AUTHORED-BY Claude Opus 5.5
"use client";
/** Folder breadcrumbs (04-drive §2.2): My Drive › … › current; "‹ Parent" on phones. Crumbs accept drops. */

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { type DragEvent, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { DriveItem } from "../lib/client/client";
import { breadcrumbs } from "../lib/files/breadcrumbs";
import { useDrive } from "../state/drive-context";
import { useDriveActions } from "../state/ui";

const DRAG_TYPE = "application/x-solid-drive-items";

export function Breadcrumbs({ folder }: { folder: string }) {
  const { driveRoot, client } = useDrive();
  const actions = useDriveActions();
  const [over, setOver] = useState<string>();
  if (!driveRoot) return null;
  let trail: { label: string; url: string }[];
  try {
    trail = breadcrumbs(folder, driveRoot);
  } catch {
    return null;
  }
  const crumbs = [{ label: "My Drive", url: driveRoot }, ...trail];
  const hrefOf = (url: string) => (url === driveRoot ? "/drive/my" : `/drive/f/${encodeRef(url)}`);
  const parent = crumbs[crumbs.length - 2];
  const dropProps = (url: string) => ({
    onDragOver: (event: DragEvent) => {
      if (![...event.dataTransfer.types].includes(DRAG_TYPE)) return;
      event.preventDefault();
      setOver(url);
    },
    onDragLeave: () => setOver(undefined),
    onDrop: async (event: DragEvent) => {
      event.preventDefault();
      setOver(undefined);
      try {
        const urls = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as string[];
        const items = await Promise.all(urls.map((entry) => client.stat(entry)));
        await actions.move(items as DriveItem[], url);
      } catch {
        // A drop from elsewhere: nothing to move.
      }
    },
  });
  return (
    <nav className="drv-crumbs" aria-label="Breadcrumb">
      {parent ? (
        <Link className="drv-crumbs-back" href={hrefOf(parent.url)}>
          <ChevronLeft aria-hidden="true" size={16} /> {parent.label}
        </Link>
      ) : null}
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={crumb.url} data-drop={over === crumb.url || undefined} {...dropProps(crumb.url)}>
            {index === crumbs.length - 1 ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <>
                <Link href={hrefOf(crumb.url)}>{crumb.label}</Link>
                <span aria-hidden="true" className="drv-crumb-sep">
                  ›
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
