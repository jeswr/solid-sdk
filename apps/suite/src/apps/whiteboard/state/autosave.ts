// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Scene } from "@jeswr/excalidraw-scene";
import { type Board, type BoardAccess, isConflict } from "../lib/repository";
export type SaveState = "saved" | "saving" | "pending" | "error" | "conflict";
/** One writer per opened board. New edits never borrow an ETag from another writer. */
export class BoardAutosave {
  private board: Board;
  private pending: Scene | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | null = null;
  private blocked = false;
  constructor(
    private repository: BoardAccess,
    board: Board,
    private changed: (status: SaveState, board: Board, error?: unknown) => void,
    private delay = 700,
  ) {
    this.board = board;
  }
  update(scene: Scene) {
    this.pending = scene;
    this.changed("pending", { ...this.board, scene });
    clearTimeout(this.timer);
    if (!this.blocked)
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.delay);
  }
  async flush(keepalive = true): Promise<void> {
    clearTimeout(this.timer);
    if (this.flight) {
      await this.flight;
      if (this.pending && !this.blocked) return this.flush(keepalive);
      return;
    }
    if (!this.pending || this.blocked) return;
    const scene = this.pending;
    this.pending = null;
    this.changed("saving", { ...this.board, scene });
    this.flight = (async () => {
      try {
        this.board = await this.repository.save(this.board, scene, keepalive);
        this.changed(this.pending ? "pending" : "saved", this.board);
      } catch (error) {
        this.pending ??= scene;
        this.blocked = true;
        this.changed(
          isConflict(error) ? "conflict" : "error",
          { ...this.board, scene: this.pending },
          error,
        );
      }
    })();
    await this.flight;
    this.flight = null;
    if (this.pending && !this.blocked) await this.flush(keepalive);
  }
  /** Drain pending writes before the descriptor is deleted; never delete after a failed flush. */
  async finish(): Promise<Board> {
    await this.flush();
    if (this.pending || this.blocked) throw new Error("Save this board before deleting it");
    return this.board;
  }
  retry() {
    this.blocked = false;
    return this.flush();
  }
  dispose() {
    clearTimeout(this.timer);
    void this.flush(true);
  }
}
