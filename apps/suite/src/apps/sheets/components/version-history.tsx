// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from "@jeswr/suite-ui";
import { useEffect, useId, useRef, useState } from "react";
import type { Snapshot } from "../lib/contract";
import { loadEngine } from "../lib/engine";
import type { SheetVersion, VersionHistory } from "../lib/versions";

/** A separate read-only engine has no change listeners or save connection. */
export function VersionPreview({ snapshot }: { snapshot: Snapshot }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    let dispose: (() => void) | undefined;
    setError(false);
    void (async () => {
      const mount = await loadEngine();
      if (!live || !host.current) return;
      const engine = await mount(host.current, {
        snapshot,
        readOnly: true,
        dark: document.documentElement.classList.contains("dark"),
        compact: true,
      });
      if (!live) engine.dispose();
      else dispose = () => engine.dispose();
    })().catch(() => {
      if (live) setError(true);
    });
    return () => {
      live = false;
      dispose?.();
    };
  }, [snapshot]);
  return (
    <section aria-label="Version preview" className="sht-version-preview">
      {error && <p role="alert">Couldn't preview this version.</p>}
      <div ref={host} className="sht-version-grid" />
    </section>
  );
}

export function SheetVersionHistory({
  history,
  readOnly,
  namingCurrent = false,
  prepare,
  restore,
  copy,
  close,
}: {
  history: VersionHistory;
  readOnly: boolean;
  namingCurrent?: boolean;
  prepare: () => Promise<void>;
  restore: (snapshot: Snapshot) => Promise<void>;
  copy: (snapshot: Snapshot) => Promise<void>;
  close: () => void;
}) {
  const [versions, setVersions] = useState<SheetVersion[]>([]);
  const [selected, setSelected] = useState<SheetVersion>();
  const [preview, setPreview] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [naming, setNaming] = useState(namingCurrent);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const sequence = useRef(0);
  const live = useRef(true);
  const permission = useRef(readOnly);
  permission.current = readOnly;
  const nameId = useId();
  useEffect(() => {
    let active = true;
    live.current = true;
    void history.list().then(
      (entries) => {
        if (active) {
          setVersions(entries);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setError("Couldn't load version history. Close and try again.");
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
      live.current = false;
      sequence.current++;
    };
  }, [history]);
  const choose = async (version: SheetVersion) => {
    const request = ++sequence.current;
    setSelected(version);
    setPreview(undefined);
    setConfirm(false);
    setNaming(false);
    setError(undefined);
    setLoading(true);
    try {
      const snapshot = await history.load(version.url);
      if (live.current && request === sequence.current) setPreview(snapshot);
    } catch {
      if (live.current && request === sequence.current) setError("Couldn't load this version.");
    } finally {
      if (live.current && request === sequence.current) setLoading(false);
    }
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch {
      if (live.current) setError("Couldn't complete this action. Your version is still available.");
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        className="sht-history-dialog"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>Version history</DialogTitle>
        <DialogDescription>Browse saved versions. Previews are view only.</DialogDescription>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Loading versions…</p>}
        <div className="sht-history-layout">
          <div>
            <Button
              disabled={readOnly || busy}
              onClick={() => {
                if (permission.current) return;
                setSelected(undefined);
                setPreview(undefined);
                sequence.current++;
                setLoading(false);
                setName("");
                setNaming(true);
                setConfirm(false);
              }}
            >
              Name current version
            </Button>
            {!loading && versions.length === 0 && <p>No saved versions yet.</p>}
            <ul aria-label="Spreadsheet versions" className="sht-version-list">
              {versions.map((version) => (
                <li key={version.url}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-current={selected?.url === version.url ? "true" : undefined}
                    onClick={() => void choose(version)}
                  >
                    <span>{version.name ?? "Automatic version"}</span>
                    <time dateTime={version.created}>
                      {new Date(version.created).toLocaleString()}
                    </time>
                    <small>{version.author ?? "Unknown author"}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            {preview && <VersionPreview snapshot={preview} />}
            {selected && (
              <div className="sht-version-actions">
                <Button
                  disabled={readOnly || busy || !preview}
                  onClick={() => {
                    if (!permission.current) setConfirm(true);
                  }}
                >
                  Restore this version
                </Button>
                <Button
                  disabled={readOnly || busy}
                  onClick={() => {
                    if (permission.current) return;
                    setName(selected.name ?? "");
                    setNaming(true);
                    setConfirm(false);
                  }}
                >
                  Name this version
                </Button>
                <Button
                  disabled={busy || !preview}
                  onClick={() =>
                    void run(async () => {
                      if (preview) await copy(preview);
                    })
                  }
                >
                  Make a copy
                </Button>
              </div>
            )}
            {naming && !readOnly && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (permission.current || !name.trim()) return;
                  void run(async () => {
                    if (selected) await history.name(selected, name.trim());
                    else {
                      await prepare();
                      if (permission.current) return;
                      await history.capture(name.trim());
                    }
                    const entries = await history.list();
                    if (!live.current) return;
                    setVersions(entries);
                    setSelected((current) => entries.find((entry) => entry.url === current?.url));
                    setNaming(false);
                  });
                }}
              >
                <label htmlFor={nameId}>Version name</label>
                <Input
                  id={nameId}
                  value={name}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button type="submit" disabled={busy || !name.trim()}>
                  Save name
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setNaming(false)}
                >
                  Cancel
                </Button>
              </form>
            )}
            {confirm && !readOnly && (
              <fieldset aria-label="Confirm restore">
                <p>
                  Restore this version? Your current content will be saved in version history first.
                </p>
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (permission.current || !preview) return;
                    void run(async () => {
                      await restore(preview);
                      if (live.current) close();
                    });
                  }}
                >
                  Restore
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
              </fieldset>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
