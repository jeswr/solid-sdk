// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { StorageError } from "@jeswr/storage-client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Toaster,
  toast,
} from "@jeswr/suite-ui";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useOptionalAccounts } from "@/shell/session/accounts-context";
import { useConnectionState } from "@/shell/sync/connection-state";
import { seedSamples } from "../demo/sample";
import {
  activateDraftOwner,
  draftOwners,
  purgeDraftOwner,
  readDrafts,
  writeDrafts,
} from "../lib/drafts";
import {
  type Board,
  disconnectedBoards,
  isConflict,
  openWhiteboards,
  type WhiteboardRepository,
} from "../lib/repository";
import type { BoardAutosave } from "../state/autosave";
import { mergeBoardFields } from "../state/board-fields";
import { BoardList } from "./board-list";
import { BoardEditor } from "./editor";

function SessionGate() {
  const state = usePodSessionState();
  useEffect(() => {
    try {
      if (state.status === "ready") activateDraftOwner(localStorage, state.session.webId);
      else if (state.status === "signed-out") activateDraftOwner(localStorage, null);
    } catch {}
  }, [state]);
  if (state.status === "ready")
    return (
      <Boards key={`${state.session.webId}:${state.session.storageUrl}`} session={state.session} />
    );
  return (
    <AppFrame app="whiteboard" sidebar={<p>Space to think</p>}>
      <div className="wb-page">
        <AppHeading>Whiteboard</AppHeading>
        {state.status === "loading" ? (
          <LoadingSkeleton preset="grid" label="Opening Whiteboard" />
        ) : state.status === "error" ? (
          <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
        ) : (
          <EmptyState title="Sign in to open your boards" body="Your ideas live in your pod." />
        )}
      </div>
    </AppFrame>
  );
}
function Boards({ session }: { session: PodSession }) {
  const [boards, setBoards] = useState<Board[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [repository, setRepository] = useState<WhiteboardRepository | null>(null),
    [boot, setBoot] = useState<"loading" | "error" | "ready">("loading"),
    [attempt, setAttempt] = useState(0);
  const [conflicted, setConflicted] = useState<Board | null>(null);
  const [otherVersion, setOtherVersion] = useState<Board | null>(null);
  const [remoteDeleted, setRemoteDeleted] = useState(false);
  const conflictRequest = useRef(0);
  // Keep disposed editors reachable until their teardown flush settles. Each registration owns a
  // token: Strict Mode re-registers the same writer before the first cleanup's async release runs.
  const writers = useRef(new Map<string, { writer: BoardAutosave; token: symbol }>());
  const registerWriter = useCallback((id: string, writer: BoardAutosave) => {
    const token = Symbol(id);
    writers.current.set(id, { writer, token });
    return () => {
      if (writers.current.get(id)?.token === token) writers.current.delete(id);
    };
  }, []);
  const deleting = useRef(new Set<string>());
  const pendingFields = useRef(new Map<string, Set<"scene" | "title">>());
  const dirty = useRef(new Map<string, Board>()),
    queue = useRef(Promise.resolve()),
    live = useRef(true);
  const connection = useConnectionState();
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (connection === "online" && previousConnection.current !== "online")
      setAttempt((value) => value + 1);
    previousConnection.current = connection;
  }, [connection]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries pod initialisation.
  useEffect(() => {
    live.current = true;
    let active = true;
    try {
      for (const b of readDrafts(localStorage, session.webId, session.storageUrl)) {
        dirty.current.set(b.id, b);
        pendingFields.current.set(b.id, new Set(["scene"]));
        if (b.descriptor && b.metadata.title !== b.title)
          pendingFields.current.get(b.id)?.add("title");
      }
      setBoards([...dirty.current.values()]);
    } catch {}
    void openWhiteboards(session)
      .then(async (repo) => {
        if (!active) return;
        if (session.mode === "demo") await seedSamples(repo, session.fetch);
        const loaded = await repo.list();
        if (active && repo.unreadable.length)
          toast.warning(
            "Some boards could not be opened. They are still in your pod; try reloading or import a saved copy.",
          );
        if (active && repo.truncated)
          toast.warning(
            "Showing the first 100 boards. The remaining boards are still in your pod.",
          );
        // Resume new boards retained during an interrupted create, before merging the listing.
        for (const [id, draft] of dirty.current) {
          if (!draft.descriptor) {
            try {
              const saved = await repo.create(draft.title, draft.scene);
              const latest = dirty.current.get(id);
              dirty.current.delete(id);
              if (latest && latest.scene !== draft.scene) {
                saved.scene = latest.scene;
                dirty.current.set(saved.id, saved);
              }
              loaded.push(saved);
              if (active) setSelected((current) => (current === id ? saved.id : current));
            } catch {
              /* Keep the local board for another connection attempt. */
            }
          }
        }
        try {
          writeDrafts(localStorage, session.webId, session.storageUrl, [...dirty.current.values()]);
        } catch {}

        if (!active) return;
        setRepository(repo);
        const merged = new Map(loaded.map((b) => [b.id, b]));
        for (const b of dirty.current.values()) merged.set(b.id, b);
        setBoards([...merged.values()]);
        setBoot("ready");
      })
      .catch(() => {
        if (active) setBoot("error");
      });
    return () => {
      active = false;
      live.current = false;
    };
  }, [session, attempt]);
  const retain = (board: Board, pending: boolean, field: "scene" | "title" = "scene") => {
    if (deleting.current.has(board.id)) return;
    const fields = pendingFields.current.get(board.id) ?? new Set<"scene" | "title">();
    if (pending) fields.add(field);
    else fields.delete(field);
    pendingFields.current.set(board.id, fields);
    if (fields.size)
      dirty.current.set(
        board.id,
        mergeBoardFields(
          dirty.current.get(board.id) ?? board,
          board,
          field === "scene" ? "canvas" : "metadata",
        ),
      );
    else {
      dirty.current.delete(board.id);
      pendingFields.current.delete(board.id);
    }

    try {
      if (
        writeDrafts(localStorage, session.webId, session.storageUrl, [
          ...dirty.current.values(),
        ]) === false
      )
        toast.error("Local storage is full. Keep this tab open or export your board.");
    } catch {
      toast.error(
        "This browser could not retain your unsaved board. Export a copy before closing.",
      );
    }
  };
  const update = (board: Board, replace = false) => {
    if (replace) {
      retain(board, false, "title");
      retain(board, false, "scene");
    }
    setBoards((current) =>
      current.map((b) =>
        b.id === board.id ? mergeBoardFields(b, board, replace ? "all" : "canvas") : b,
      ),
    );
  };
  const updateMetadata = (board: Board) =>
    setBoards((current) =>
      current.map((b) => (b.id === board.id ? mergeBoardFields(b, board, "metadata") : b)),
    );
  const forget = (board: Board) => {
    deleting.current.add(board.id);
    dirty.current.delete(board.id);
    pendingFields.current.delete(board.id);
    writers.current.delete(board.id);
    setBoards((current) => current.filter((b) => b.id !== board.id));
    setSelected((current) => (current === board.id ? null : current));
    try {
      writeDrafts(localStorage, session.webId, session.storageUrl, [...dirty.current.values()]);
    } catch {}
  };
  /** Escape and outside clicks only close the dialog; the draft waits for an explicit choice. */
  const closeConflict = () => {
    conflictRequest.current++;
    setConflicted(null);
  };
  /** Dismiss accepts the pod's state: a deleted board is forgotten, a changed one reloaded. */
  const dismissConflict = () => {
    if (conflicted && remoteDeleted) forget(conflicted);
    else if (otherVersion) update(otherVersion, true);
    closeConflict();
  };
  const keepConflictCopy = () => {
    if (conflicted) {
      const latest = dirty.current.get(conflicted.id) ?? conflicted;
      create(`${latest.title} — copy`, latest.scene);
      if (remoteDeleted) forget(conflicted);
    }
    if (otherVersion) update(otherVersion, true);
    closeConflict();
  };
  /** Only a missing descriptor means the board was deleted; a damaged canvas is not deletion. */
  const readRemote = async (board: Board): Promise<Board | "deleted" | null> => {
    try {
      return (await repository?.read(board.descriptor)) ?? null;
    } catch (error) {
      if (error instanceof StorageError && error.code === "not-found") return "deleted";
      if (live.current) toast.error("Couldn't load the other version. You can still keep a copy.");
      return null;
    }
  };
  const showConflict = async (board: Board, remote?: Board | "deleted" | null) => {
    const request = ++conflictRequest.current;
    setConflicted(board);
    setOtherVersion(null);
    setRemoteDeleted(false);
    const result = remote === undefined ? await readRemote(board) : remote;
    if (request !== conflictRequest.current || !live.current) return;
    if (result === "deleted") setRemoteDeleted(true);
    else if (result) setOtherVersion(result);
  };
  const task = (work: () => Promise<void>) => {
    const next = queue.current.then(work);
    queue.current = next.catch(() => {
      toast.error("Couldn't save your board. Your local copy is still available.");
    });
    return next;
  };
  const create = (title: string, scene: Board["scene"], open = false) => {
    const id = `local:${crypto.randomUUID()}`;
    const optimistic: Board = {
      id,
      title,
      scene,
      descriptor: "",
      blob: "",
      etag: null,
      descriptorEtag: null,
      metadata: { sceneDocument: "" },
    };
    setBoards((current) => [optimistic, ...current]);
    retain(optimistic, true);
    if (open) setSelected(id);
    if (!repository) {
      toast("Board kept in this browser. Reconnect to save it to your pod.");
      return;
    }
    void task(async () => {
      const saved = await repository.create(title, scene);
      const latest = dirty.current.get(id);
      if (latest && latest.scene !== scene) {
        saved.scene = latest.scene;
        retain(saved, true);
      }
      retain(optimistic, false);
      if (live.current) {
        setBoards((current) => current.map((b) => (b.id === id ? saved : b)));
        setSelected((current) => (current === id ? saved.id : current));
      }
    }).catch(() => {});
  };
  const remove = (board: Board) => {
    if (!repository) return;
    const writer = writers.current.get(board.id)?.writer;
    deleting.current.add(board.id);
    setBoards((current) => current.filter((b) => b.id !== board.id));
    setSelected(null);
    dirty.current.delete(board.id);
    pendingFields.current.delete(board.id);
    try {
      writeDrafts(localStorage, session.webId, session.storageUrl, [...dirty.current.values()]);
    } catch {}
    let undone = false;
    toast("Board deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          if (!undone) create(board.title, board.scene);
          undone = true;
        },
      },
    });
    let remote: Board | null | undefined;
    void task(async () => {
      const saved = writer ? mergeBoardFields(board, await writer.finish(), "canvas") : board;
      try {
        await repository.remove(saved);
      } catch (error) {
        // A board that is already gone is what this deletion asked for: succeed quietly.
        if (!(error instanceof StorageError && error.code === "not-found")) {
          if (!isConflict(error)) throw error;
          const found = await readRemote(board);
          if (found !== "deleted") {
            remote = found;
            throw error;
          }
        }
      }
      writers.current.delete(board.id);
    }).catch(() => {
      if (remote !== undefined) void showConflict(board, remote);
      deleting.current.delete(board.id);
      // After a 412 the dialog offers the local copy and finish() discarded unsent edits, so
      // the restored board keeps no draft that would override the pod listing on every boot.
      retain(board, remote === undefined);
      if (live.current)
        setBoards((current) =>
          current.some((b) => b.id === board.id) ? current : [board, ...current],
        );
    });
  };
  const rename = (board: Board, title: string) => {
    if (!repository) return;
    const optimistic = { ...board, title };
    updateMetadata(optimistic);
    retain(optimistic, true, "title");
    void task(async () => {
      const saved = await repository.rename(board, title);
      retain(saved, false, "title");
      if (live.current) updateMetadata(saved);
    }).catch((error) => {
      if (isConflict(error) || (error instanceof StorageError && error.code === "not-found"))
        void showConflict(optimistic);
    });
  };
  const board = boards.find((b) => b.id === selected);
  const sidebar = (
    <div className="wb-sidebar">
      <strong>Whiteboard</strong>
      <p>Space to think, sketch and connect.</p>
      <Button variant="outline" onClick={() => setSelected(null)}>
        All boards
      </Button>
      <p className="wb-muted">
        {session.mode === "demo" ? "A demo pod with fictional projects." : "Saved in your pod."}
      </p>
    </div>
  );
  let content: ReactNode;
  if (board)
    content = (
      <BoardEditor
        key={`${board.id}:${repository ? "pod" : "local"}`}
        board={board}
        onWriter={registerWriter}
        repository={repository ?? disconnectedBoards}
        onBack={() => setSelected(null)}
        onChange={update}
        retain={retain}
        onCopy={(scene) => create(`${board.title} — recovered copy`, scene)}
        hasDraft={dirty.current.has(board.id)}
      />
    );
  else
    content = (
      <div className="wb-page">
        <div className="wb-page-heading">
          <div>
            <p className="wb-eyebrow">A LITTLE ROOM FOR BIG IDEAS</p>
            <AppHeading>Your whiteboards</AppHeading>
            <p className="wb-muted">Start with a blank canvas. See where it takes you.</p>
          </div>
        </div>
        {boot === "loading" && !boards.length ? (
          <LoadingSkeleton preset="grid" label="Loading whiteboards" />
        ) : boot === "error" && !boards.length ? (
          <ErrorState error="unreachable" actions={{ retry: () => setAttempt((a) => a + 1) }}>
            <p>Couldn't open your boards. Check your connection and try again.</p>
          </ErrorState>
        ) : (
          <>
            <BoardList
              boards={boards}
              ready={!!repository}
              onOpen={(b) => setSelected(b.id)}
              onCreate={create}
              onRename={rename}
              onDelete={remove}
            />
            {boot === "error" && (
              <p role="status">
                Showing unsaved local copies.{" "}
                <Button variant="link" onClick={() => setAttempt((a) => a + 1)}>
                  Reconnect
                </Button>
              </p>
            )}
          </>
        )}
      </div>
    );
  return (
    <AppFrame app="whiteboard" sidebar={sidebar} context={<span>Whiteboard</span>}>
      <div className="wb-root">
        {connection !== "online" && (
          <p className="wb-offline" role="status">
            You're offline. Keep sketching; unsaved boards stay in this browser.
          </p>
        )}
        {content}
        <Dialog
          open={conflicted !== null}
          onOpenChange={(open) => {
            if (!open) closeConflict();
          }}
        >
          <DialogContent>
            <DialogTitle>
              {remoteDeleted ? "This board was deleted elsewhere" : "This board changed elsewhere"}
            </DialogTitle>
            <DialogDescription>
              {remoteDeleted
                ? "Keep your local drawing as a new board, or dismiss this message."
                : "Keep your drawing as a separate board, or reload the version from your pod."}
            </DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={dismissConflict}>
                Dismiss
              </Button>
              <Button
                variant="outline"
                disabled={!otherVersion}
                onClick={() => {
                  if (otherVersion) update(otherVersion, true);
                  closeConflict();
                }}
              >
                Reload board
              </Button>
              <Button onClick={keepConflictCopy}>Keep a copy</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppFrame>
  );
}
export function WhiteboardApp() {
  const accounts = useOptionalAccounts();
  const knownOwners = useRef<Set<string> | null>(null);
  // This observer sits outside AppSessionGuard, which hides its children on sign-out.
  useLayoutEffect(() => {
    try {
      if (!accounts || accounts.status === "loading") return;
      const signedIn = new Set(accounts.accounts.map((account) => account.webId));
      // On first run, also purge accounts that signed out while Whiteboard was closed.
      for (const owner of knownOwners.current ?? draftOwners(localStorage)) {
        if (!signedIn.has(owner)) purgeDraftOwner(localStorage, owner);
      }
      knownOwners.current = signedIn;
      if (accounts.status === "signed-out") activateDraftOwner(localStorage, null);
      else if (accounts.active) activateDraftOwner(localStorage, accounts.active.webId);
    } catch {}
  }, [accounts]);
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
