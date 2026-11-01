// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@jeswr/suite-ui";
import { useState } from "react";
import { changeMembers } from "../lib/data/albums";
import { usePhotos } from "../state/photos-context";

export function AlbumDialog({
  refs,
  open,
  onClose,
  createOnly = false,
}: {
  refs: string[];
  open: boolean;
  onClose: () => void;
  createOnly?: boolean;
}) {
  const photos = usePhotos();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function submit() {
    setBusy(true);
    setError(false);
    const success =
      selected && !createOnly
        ? await photos.editAlbum(
            selected,
            (album) => changeMembers(album, refs, true),
            `${refs.length} photos added to album`,
          )
        : await photos.newAlbum(name, refs);
    setBusy(false);
    if (success) {
      setName("");
      setSelected("");
      onClose();
    } else setError(true);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent className="pho-dialog">
        <DialogHeader>
          <DialogTitle>{createOnly ? "New album" : "Add to album"}</DialogTitle>
          <DialogDescription>
            {createOnly
              ? "Give your collection a name."
              : `Choose a collection for ${refs.length} selected photo${refs.length === 1 ? "" : "s"}.`}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {!createOnly && (
            <label className="pho-field">
              Album
              <select
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
                disabled={busy}
              >
                <option value="">Create a new album</option>
                {photos.albums
                  .filter((album) => album.etag)
                  .map((album) => (
                    <option key={album.url} value={album.url}>
                      {album.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {(!selected || createOnly) && (
            <label className="pho-field" htmlFor="pho-album-name">
              Album name
              <Input
                id="pho-album-name"
                value={name}
                required
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
              />
            </label>
          )}
          {error && <p role="alert">Couldn't save the album. Please try again.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (!selected && !name.trim())}>
              {busy ? "Saving…" : createOnly || !selected ? "Create album" : "Add photos"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function ConfirmDialog({
  title,
  description,
  action,
  open,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  action: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent className="pho-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().then((ok) => {
                setBusy(false);
                if (ok) onClose();
              });
            }}
          >
            {busy ? "Saving…" : action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
