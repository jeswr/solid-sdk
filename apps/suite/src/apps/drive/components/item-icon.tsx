// AUTHORED-BY Claude Opus 5.5
"use client";
import { FileTypeIcon } from "@jeswr/suite-ui";
import type { DriveItem } from "../lib/client/client";

/** `FileTypeIcon` for a Drive item; folders map to the folder glyph. */
export function ItemIcon({
  item,
  size,
}: {
  item: Pick<DriveItem, "kind" | "name" | "contentType">;
  size: 16 | 20 | 24 | 32 | 40 | 48;
}) {
  const contentType = item.kind === "folder" ? "inode/directory" : item.contentType;
  return (
    <FileTypeIcon
      {...(contentType ? { contentType } : {})}
      name={item.name}
      size={size}
      decorative
    />
  );
}
