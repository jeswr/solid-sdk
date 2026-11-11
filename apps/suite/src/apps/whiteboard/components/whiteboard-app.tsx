// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, Toaster, toast } from "@jeswr/suite-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { seedSamples } from "../demo/sample";
import { readDrafts, writeDrafts } from "../lib/drafts";
import {
  type Board,
  disconnectedBoards,
  openWhiteboards,
  type WhiteboardRepository,
} from "../lib/repository";
import { mergeBoardFields } from "../state/board-fields";
import { BoardList } from "./board-list";
import { BoardEditor } from "./editor";

function SessionGate() {
  const state = usePodSessionState();
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
        !writeDrafts(localStorage, session.webId, session.storageUrl, [...dirty.current.values()])
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
    setBoards((current) => current.filter((b) => b.id !== board.id));
    setSelected(null);
    retain(board, false);
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
    void task(async () => {
      await repository.remove(board);
      retain(board, false);
    }).catch(() => {
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
    }).catch(() => {});
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
      </div>
    </AppFrame>
  );
}
export function WhiteboardApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
