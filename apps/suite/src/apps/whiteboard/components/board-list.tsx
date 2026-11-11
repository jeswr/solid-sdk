// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
"use client";
import { emptyScene, LIMITS, parseScene, type Scene, sceneToSvg } from "@jeswr/excalidraw-scene";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  EmptyState,
  IconButton,
  Input,
  toast,
} from "@jeswr/suite-ui";
import { Copy, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import type { Board } from "../lib/repository";

const BoardThumbnail = memo(function BoardThumbnail({ scene }: { scene: Scene }) {
  const src = useMemo(
    () =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sceneToSvg(scene, { background: true }))}`,
    [scene],
  );
  // biome-ignore lint/performance/noImgElement: a local generated SVG thumbnail needs no image optimiser or network request.
  return <img alt="" src={src} draggable={false} />;
});
export function BoardList({
  boards,
  ready,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  boards: Board[];
  ready: boolean;
  onOpen: (board: Board) => void;
  onCreate: (title: string, scene: Scene, open?: boolean) => void;
  onRename: (board: Board, title: string) => void;
  onDelete: (board: Board) => void;
}) {
  const [naming, setNaming] = useState<Board | "new" | null>(null),
    [name, setName] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const start = () => {
    setName("");
    setNaming("new");
  };
  return (
    <>
      <div className="wb-list-actions">
        <Button onClick={start}>
          <Plus size={18} aria-hidden="true" />
          New board
        </Button>
        <Button variant="outline" onClick={() => upload.current?.click()} disabled={!ready}>
          <Upload size={18} aria-hidden="true" />
          Import .excalidraw
        </Button>
        <input
          ref={upload}
          hidden
          type="file"
          accept=".excalidraw,application/json"
          aria-label="Import Excalidraw file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > LIMITS.bytes) {
              toast.error("This file is too large. Choose a file under 8 MB.");
              return;
            }
            void file
              .text()
              .then(
                (json) => {
                  onCreate(
                    file.name.replace(/\.excalidraw$/i, "") || "Imported board",
                    parseScene(json),
                  );
                },
                () => toast.error("Couldn't read this file."),
              )
              .catch(() => toast.error("This isn't a supported Excalidraw scene."));
          }}
        />
      </div>
      {!boards.length ? (
        <EmptyState
          title="Give your ideas some space"
          body="Sketch a plan, map a thought or make something together. Start with a blank board."
          primaryAction={<Button onClick={start}>Create your first board</Button>}
        />
      ) : (
        <div className="wb-grid">
          {boards.map((board) => (
            <article className="wb-card" aria-label={board.title} key={board.id}>
              <button
                type="button"
                className="wb-preview"
                aria-label={`Open ${board.title}`}
                onClick={() => onOpen(board)}
              >
                <BoardThumbnail scene={board.scene} />
              </button>
              <div className="wb-card-foot">
                <div>
                  <h3>{board.title}</h3>
                  <span className="wb-muted">
                    {board.descriptor
                      ? `${board.scene.elements.filter((e) => !e.isDeleted).length} shapes`
                      : "Saving new board…"}
                  </span>
                </div>
                <div className="wb-card-actions">
                  <IconButton
                    label={`Rename ${board.title}`}
                    variant="ghost"
                    disabled={!ready || !board.descriptor}
                    onClick={() => {
                      setNaming(board);
                      setName(board.title);
                    }}
                  >
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton
                    label={`Duplicate ${board.title}`}
                    variant="ghost"
                    onClick={() => onCreate(`${board.title} — copy`, board.scene)}
                  >
                    <Copy size={16} />
                  </IconButton>
                  <IconButton
                    label={`Delete ${board.title}`}
                    variant="ghost"
                    disabled={!ready || !board.descriptor}
                    onClick={() => onDelete(board)}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog open={naming !== null} onOpenChange={(open) => !open && setNaming(null)}>
        <DialogContent>
          <DialogTitle>{naming === "new" ? "New whiteboard" : "Rename whiteboard"}</DialogTitle>
          <DialogDescription>A name to help you find your ideas.</DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || !naming) return;
              if (naming === "new") {
                const scene = emptyScene();
                scene.appState.viewBackgroundColor =
                  getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() ||
                  "white";
                onCreate(name.trim(), scene, true);
              } else onRename(naming, name.trim());
              setNaming(null);
            }}
          >
            <label htmlFor="wb-name">Board name</label>
            <Input
              id="wb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="A bright idea"
              autoFocus
              required
            />
            <DialogFooter>
              <Button type="submit">{naming === "new" ? "Create board" : "Save name"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
