// AUTHORED-BY Codex
"use client";

import { Button, toast } from "@jeswr/suite-ui";
import { useState } from "react";
import type { DriveItem } from "../lib/client/client";
import { DriveDeletePendingError } from "../lib/client/deletion";
import { useDrive } from "../state/drive-context";

/** Keep failed provisioning visible until the policy verifies or the item is deleted. */
export function ProtectionBanner({ item }: { item: DriveItem }) {
  const { client, invalidate } = useDrive();
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);
  if (!item.protectionRequired || resolved) return null;
  const recover = async (remove: boolean) => {
    setBusy(true);
    try {
      if (remove) await client.remove(item.url);
      else await client.read(item.url);
      setResolved(true);
      invalidate(item.url);
    } catch (error) {
      toast.error(
        error instanceof DriveDeletePendingError
          ? error.message
          : "Sharing is still unsecured. Retry or delete this item.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="alert" className="drv-state">
      <p>
        <strong>{item.name}</strong>: This {item.kind === "file" ? "file" : "folder"}'s sharing
        could not be secured — Retry / Delete
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void recover(false)}>
        Retry
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => void recover(true)}>
        Delete
      </Button>
    </div>
  );
}
