// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorState,
  FileTypeIcon,
  formatBytes,
  LoadingSkeleton,
  PreviewPane,
  toast,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSolidDriveClient, isMissingItem } from "@/apps/drive/lib/client/client";
import { createFolder, uploadFile } from "@/apps/drive/lib/operations/operations";
import { encodeRef } from "@/lib/refs";
import { type AttachmentView, mailErrorMessage } from "../lib/client";
import { useMail } from "../state/mail-context";
export function MailAttachment({ attachment }: { attachment: AttachmentView }) {
  const { client, session } = useMail();
  const [open, setOpen] = useState(false);
  const [blob, setBlob] = useState<Blob>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [download, setDownload] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries attachment I/O
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(false);
    void client
      .binaryFetch(attachment.url)
      .then(async (response) => {
        if (!response.ok) throw new Error("Attachment unavailable");
        return response.blob();
      })
      .then(
        (value) => {
          if (live) setBlob(value);
        },
        () => {
          if (live) setError(true);
        },
      );
    return () => {
      live = false;
    };
  }, [attachment.url, client, open, attempt]);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setDownload(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  const save = async () => {
    if (!blob) return;
    setSaving(true);
    try {
      const drive = createSolidDriveClient({
        fetch: session.fetch,
        storageUrl: session.storageUrl,
        webId: session.webId,
      });
      const driveRoot = new URL("drive/", session.storageUrl).href;
      try {
        await drive.stat(driveRoot);
      } catch (error) {
        if (!isMissingItem(error)) throw error;
        await drive.createFolder(driveRoot, { kind: "inherit-verified" });
      }
      const folder = new URL("Mail%20attachments/", driveRoot).href;
      try {
        await drive.stat(folder);
      } catch (error) {
        if (!isMissingItem(error)) throw error;
        await createFolder(drive, driveRoot, "Mail attachments");
      }
      await uploadFile(drive, folder, blob, attachment.name, "keep-both");
      toast.success("Attachment saved", {
        action: <Link href={`/drive/f/${encodeRef(folder)}`}>Open in Drive</Link>,
      });
    } catch (error) {
      toast.error(mailErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  // PreviewPane handles images as images, PDF in its isolated viewer, and text
  // as text. HTML attachments must never become active same-origin documents.
  const previewType = attachment.contentType.split(";")[0]?.toLowerCase() ?? "";
  const safePreview =
    /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|text\/plain|text\/csv)$/.test(
      previewType,
    );
  return (
    <>
      <Button variant="outline" className="mail-attachment" onClick={() => setOpen(true)}>
        <FileTypeIcon contentType={attachment.contentType} name={attachment.name} decorative />
        <span>{attachment.name}</span>
        <small>{formatBytes(attachment.size)}</small>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mail-preview">
          <DialogTitle>{attachment.name}</DialogTitle>
          <DialogDescription>
            {formatBytes(attachment.size)} · {attachment.contentType}
          </DialogDescription>
          {error ? (
            <ErrorState error="unreachable" actions={{ retry: () => setAttempt((n) => n + 1) }}>
              <p>Couldn't load the attachment.</p>
            </ErrorState>
          ) : !blob ? (
            <LoadingSkeleton preset="detail" />
          ) : safePreview ? (
            <PreviewPane
              source={{ name: attachment.name, blob, contentType: attachment.contentType }}
            />
          ) : (
            <p>Download this attachment to open it in a suitable application.</p>
          )}
          <div className="mail-actions">
            {download && (
              <a className="mail-action-link" href={download} download={attachment.name}>
                Download
              </a>
            )}
            <Button disabled={!blob || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save to Drive"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
