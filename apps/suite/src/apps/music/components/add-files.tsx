// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  LoadingSkeleton,
} from "@jeswr/suite-ui";
import { FolderOpen, Upload } from "lucide-react";
import { useState } from "react";
import type { DriveAudio } from "../lib/data/owned";
import { audioType } from "../lib/data/owned";
import { useMusic } from "../state/music-context";

export function AddMusicFiles() {
  const music = useMusic();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload size={16} aria-hidden="true" />
          Add music files
        </Button>
      </DialogTrigger>
      <DialogContent className="mus-dialog">
        <DialogHeader>
          <DialogTitle>Add music files</DialogTitle>
          <DialogDescription>
            Choose MP3, M4A, FLAC, Ogg, WAV or WebM files. Include a same-named .lrc file for synced
            lyrics.
          </DialogDescription>
        </DialogHeader>
        <div className="mus-form">
          <label htmlFor="mus-audio-files">Choose audio files and lyrics</label>
          <input
            id="mus-audio-files"
            type="file"
            multiple
            accept="audio/mpeg,audio/mp4,audio/flac,audio/ogg,audio/wav,audio/webm,.mp3,.m4a,.flac,.ogg,.wav,.webm,.lrc"
            disabled={busy}
            aria-describedby={error ? "mus-upload-error" : undefined}
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (!files.length) return;
              setError("");
              setMessage("");
              const audio = files.filter((file) => audioType(file.name, file.type));
              if (
                !audio.length ||
                files.some(
                  (file) => !audioType(file.name, file.type) && !/\.lrc$/iu.test(file.name),
                )
              ) {
                setError("Choose audio files, with optional matching .lrc lyrics.");
                return;
              }
              setBusy(true);
              let added = 0;
              let existing = 0;
              try {
                for (const file of audio) {
                  setMessage(`Adding ${added + existing + 1} of ${audio.length}: ${file.name}`);
                  const lrc = files.find(
                    (sidecar) =>
                      sidecar.name.toLocaleLowerCase() ===
                      file.name.replace(/\.[^.]+$/u, ".lrc").toLocaleLowerCase(),
                  );
                  const ok = await music.importFile({
                    name: file.name,
                    type: file.type,
                    bytes: await file.arrayBuffer(),
                    ...(lrc ? { lyrics: await lrc.text() } : {}),
                  });
                  if (!ok)
                    throw new Error(
                      "Couldn't add this file. Check the save message for details, then retry.",
                    );
                  if (ok.status === "already-owned") existing++;
                  else added++;
                }
                setMessage(
                  existing
                    ? `Added ${added} songs. Already in your library: ${existing}.`
                    : `Added ${added} ${added === 1 ? "song" : "songs"}. Find them in Your files.`,
                );
              } catch (error) {
                setError(error instanceof Error ? error.message : "Couldn't read this file.");
                setMessage(
                  `Added ${added} of ${audio.length} songs. Already in your library: ${existing}.`,
                );
              } finally {
                setBusy(false);
              }
            }}
          />
          <p role="status">{message}</p>
          {error && (
            <p id="mus-upload-error" role="alert" className="mus-import-error">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function AddFromDrive() {
  const music = useMusic();
  const [files, setFiles] = useState<DriveAudio[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    setStatus("loading");
    setMessage("");
    try {
      setFiles(await music.driveFiles());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderOpen size={16} aria-hidden="true" />
          Add from Drive
        </Button>
      </DialogTrigger>
      <DialogContent className="mus-dialog">
        <DialogHeader>
          <DialogTitle>Add from Drive</DialogTitle>
          <DialogDescription>
            Play audio from your pod’s Drive. Files stay in their original location.
          </DialogDescription>
        </DialogHeader>
        {status === "loading" ? (
          <LoadingSkeleton preset="list" label="Finding audio in Drive" />
        ) : status === "error" ? (
          <div>
            <p role="alert">Couldn't open Drive.</p>
            <Button onClick={() => void load()}>Retry</Button>
          </div>
        ) : files.length ? (
          <ul className="mus-drive-files">
            {files.map((file) => (
              <li key={file.url}>
                <span>{file.name}</span>
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`Add ${file.name} from Drive`}
                  onClick={async () => {
                    setBusy(true);
                    const ok = await music.fromDrive(file.url);
                    setMessage(
                      ok
                        ? `Added ${file.name}`
                        : `Couldn't add ${file.name}. Check the file and try again.`,
                    );
                    setBusy(false);
                  }}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No audio files in Drive"
            body="Upload audio to Drive, or use Add music files in Music."
          />
        )}
        <p role="status">{message}</p>
      </DialogContent>
    </Dialog>
  );
}
