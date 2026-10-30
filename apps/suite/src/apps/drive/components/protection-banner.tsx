// AUTHORED-BY Codex
"use client";

import { Button, toast } from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { type DriveClient, DriveError, type DriveItem, isMissingItem } from "../lib/client/client";
import { DriveDeletePendingError } from "../lib/client/deletion";
import { useDrive } from "../state/drive-context";

/** Keep failed provisioning visible until the policy verifies or the item is deleted. */
export function ProtectionBanner({ item }: { item: DriveItem }) {
  const { client, invalidate } = useDrive();
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [capture, setCapture] = useState<{
    client: DriveClient;
    item: DriveItem;
    etag: string | undefined;
    verifyHeaders?: DriveItem["verifyHeaders"];
  }>();
  useEffect(() => {
    if (!item.protectionRequired || item.etag !== undefined) return;
    let live = true;
    // Listings may omit ETags. Hydrate before enabling confirmation, and never
    // replace a validator already carried by the displayed item.
    client.stat(item.url).then(
      (current) =>
        live &&
        setCapture({ client, item, etag: current.etag, verifyHeaders: current.verifyHeaders }),
      () => live && setCapture({ client, item, etag: undefined }),
    );
    return () => {
      live = false;
    };
  }, [client, item]);
  const current = capture?.client === client && capture.item === item ? capture : undefined;
  const hydrating = item.etag === undefined && !current;
  const confirmedEtag = item.etag ?? current?.etag;
  if (!item.protectionRequired || resolved) return null;
  const recover = async (remove: boolean) => {
    setBusy(true);
    try {
      if (remove) {
        if (!confirmedEtag || confirmedEtag.startsWith("W/"))
          throw new DriveError("missing-validator", 409, item.url);
        await client.remove(item.url, {
          ifMatch: confirmedEtag,
          ...((item.verifyHeaders ?? current?.verifyHeaders)
            ? {
                verifyHeaders: (item.verifyHeaders ?? current?.verifyHeaders) as NonNullable<
                  DriveItem["verifyHeaders"]
                >,
              }
            : {}),
        });
      } else await client.read(item.url);
      setResolved(true);
      invalidate(item.url);
    } catch (error) {
      if (remove && error instanceof DriveError && error.status === 412) {
        const absent = await client.stat(item.url).then(() => false, isMissingItem);
        if (absent) {
          setResolved(true);
          invalidate(item.url);
          return;
        }
      }
      toast.error(
        error instanceof DriveDeletePendingError
          ? error.message
          : error instanceof DriveError &&
              (error.kind === "conflict" || error.kind === "missing-validator")
            ? "This item's version could not be confirmed. Refresh and confirm deletion again."
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
      <Button variant="outline" disabled={busy || hydrating} onClick={() => void recover(true)}>
        Delete
      </Button>
    </div>
  );
}
