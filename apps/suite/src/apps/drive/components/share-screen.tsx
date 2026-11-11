// AUTHORED-BY Codex GPT-6
"use client";
import {
  isNativeApp,
  type ShareBatch,
  type ShareTextItem,
  type ShareUrlItem,
} from "@jeswr/suite-native";
import { Button } from "@jeswr/suite-ui";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { nativeShareIntake, type ShareIntake } from "@/shell/share/intake";
import { nameOf, parentOf } from "../lib/client/client";
import { DriveProvider, useDrive, useFolder } from "../state/drive-context";
import { createShareActions } from "../state/share-actions";
import type { UploadQueue } from "../state/uploads";

function ShareFrame({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="mx-auto max-w-2xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Save to Suite</h1>
      {children}
    </main>
  );
}

export function ShareBatchView({
  intake,
  batch,
  uploads,
  folder,
  saveLink,
  saveText,
  children,
}: {
  intake: ShareIntake;
  batch: ShareBatch;
  uploads: UploadQueue;
  folder: string | undefined;
  saveLink: (item: ShareUrlItem, batch: ShareBatch, index: number) => Promise<void>;
  saveText: (item: ShareTextItem) => Promise<void>;
  children?: ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    intake.subscribe,
    intake.getSnapshot,
    intake.getServerSnapshot,
  );
  const progress = snapshot.progress[batch.id] ?? {};
  const busy = Object.values(progress).some(
    (item) => item.status === "saving" && item.task?.status !== "conflict",
  );
  const allSaved = batch.items.every((_, index) =>
    ["saved", "discarded"].includes(progress[index]?.status ?? ""),
  );
  const save = async (index: number) => {
    const item = batch.items[index];
    const before = intake.getSnapshot().progress[batch.id]?.[index];
    // A route teardown or reauthentication replaces the account's queue. Re-read the still
    // pending item instead of retrying with a retired session.
    if (
      before?.task &&
      !uploads.tasks.some((task) => task.id === before.task?.id) &&
      ["failed", "skipped", "conflict"].includes(before.task.status)
    ) {
      before.queue?.cancel(before.task.id);
      intake.fail(batch, index);
    }
    if (!item || !intake.begin(batch, index)) return;
    try {
      if (item.kind === "file") {
        if (!folder) throw new Error("Choose a folder");
        const blob = await intake.readFile(batch, index);
        uploads.enqueue(folder, [new File([blob], item.name, { type: item.mimeType })], {
          onChange: (task) => intake.uploadChanged(batch, index, task, uploads),
          preserveContentType: true,
        });
      } else {
        if (item.kind === "url") await saveLink(item, batch, index);
        else await saveText(item);
        await intake.saved(batch, index);
      }
    } catch {
      intake.fail(batch, index);
    }
  };
  return (
    <>
      <p>
        Review these items, then choose what to save. They stay on this device until saved or
        discarded.
      </p>
      {children}
      <ul className="space-y-4" aria-label="Shared items">
        {batch.items.map((item, index) => {
          const state = progress[index];
          const task = state?.task;
          const queue = state?.queue;
          const detached =
            task &&
            !uploads.tasks.some((current) => current.id === task.id) &&
            ["failed", "skipped", "conflict"].includes(task.status);
          const saving = state?.status === "saving" && !detached;
          const failed = state?.status === "failed" || detached;
          const label =
            item.kind === "file"
              ? "Save to Drive"
              : item.kind === "url"
                ? "Save link"
                : "New note from text";
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: native item indices are immutable chunk-read identities within a batch
              key={`${batch.id}-${index}`}
              className="space-y-2 break-words rounded-lg border p-4"
            >
              {item.kind === "file" ? (
                <>
                  <p>{item.name}</p>
                  <p>
                    {item.mimeType} · {item.size} bytes
                  </p>
                </>
              ) : item.kind === "url" ? (
                <>
                  <p>{item.title}</p>
                  <p>{item.url}</p>
                </>
              ) : (
                <pre className="whitespace-pre-wrap font-sans">
                  {item.text.slice(0, 500)}
                  {item.text.length > 500 ? "…" : ""}
                </pre>
              )}
              {state?.status === "saved" || state?.status === "discarded" ? (
                <p role="status">{state.status === "saved" ? "Saved" : "Discarded"}</p>
              ) : task?.status === "conflict" && queue && !detached ? (
                <>
                  <p role="status">
                    {task.missingReplacement
                      ? "The original file is gone. Upload a new file?"
                      : "A file with this name already exists."}
                  </p>
                  {task.missingReplacement ? (
                    <Button onClick={() => queue.resolve(task.id, "upload")}>
                      Upload new file
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => queue.resolve(task.id, "keep-both")}>Keep both</Button>
                      <Button variant="outline" onClick={() => queue.resolve(task.id, "replace")}>
                        Replace existing file
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  {failed ? (
                    <p role="alert">Couldn't save this item. It is still pending.</p>
                  ) : null}
                  <Button
                    disabled={saving || (item.kind === "file" && !folder)}
                    onClick={() => {
                      if (task?.status === "failed" && queue && !detached) queue.retry(task.id);
                      else void save(index);
                    }}
                  >
                    {saving ? "Saving…" : failed ? `Retry ${label}` : label}
                  </Button>
                </>
              )}
              {state?.status !== "saved" && state?.status !== "discarded" ? (
                <Button
                  variant="ghost"
                  disabled={state?.status === "saving" && task?.status !== "conflict"}
                  onClick={() => {
                    if (task && queue) queue.cancel(task.id);
                    void intake.discardItem(batch, index);
                  }}
                >
                  Discard item
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {snapshot.error ? (
        <p role="alert">Couldn't finish this share. It is still on this device.</p>
      ) : null}
      {allSaved ? (
        <Button onClick={() => void intake.finish(batch)}>Retry finishing share</Button>
      ) : null}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          for (const item of Object.values(progress))
            if (item.task) item.queue?.cancel(item.task.id);
          void intake.discard(batch);
        }}
      >
        Discard batch
      </Button>
    </>
  );
}

function DriveShareBatch({
  intake,
  batch,
  session,
}: {
  intake: ShareIntake;
  batch: ShareBatch;
  session: PodSession;
}) {
  const { driveRoot, rootError, retryRoot, uploads } = useDrive();
  const [chosen, setChosen] = useState<string>();
  const folder = chosen ?? driveRoot;
  const listing = useFolder(batch.items.some((item) => item.kind === "file") ? folder : undefined);
  const actions = useMemo(() => createShareActions(session), [session]);
  return (
    <ShareBatchView intake={intake} batch={batch} uploads={uploads} folder={folder} {...actions}>
      {batch.items.some((item) => item.kind === "file") ? (
        <section aria-label="Destination folder" className="space-y-2">
          <p>
            Save files in:{" "}
            {folder ? (folder === driveRoot ? "My Drive" : nameOf(folder)) : "Finding Drive…"}
          </p>
          {rootError ? (
            <>
              <p role="alert">Couldn't find your Drive.</p>
              <Button onClick={retryRoot}>Retry finding Drive</Button>
            </>
          ) : null}
          {chosen && chosen !== driveRoot ? (
            <Button variant="outline" onClick={() => setChosen(parentOf(chosen) ?? driveRoot)}>
              Up a folder
            </Button>
          ) : null}
          {listing.status === "ready" ? (
            listing.items
              .filter((item) => item.kind === "folder" && !item.name.startsWith("."))
              .map((item) => (
                <Button variant="outline" key={item.url} onClick={() => setChosen(item.url)}>
                  Open folder {item.name}
                </Button>
              ))
          ) : listing.status === "error" ? (
            <Button variant="ghost" onClick={listing.reload}>
              Retry loading folders
            </Button>
          ) : null}
        </section>
      ) : null}
    </ShareBatchView>
  );
}

function ShareSession({ intake, batch }: { intake: ShareIntake; batch: ShareBatch }) {
  const state = usePodSessionState();
  if (state.status === "signed-out")
    return (
      <>
        <p>Sign in to save these items. Your share will stay pending.</p>
        <Link href="/signin?next=%2Fshare">Sign in</Link>
      </>
    );
  if (state.status === "loading") return <p role="status">Opening your account…</p>;
  if (state.status === "error")
    return <p role="alert">Couldn't open your account. Your share is still pending.</p>;
  return (
    <DriveProvider
      key={JSON.stringify([state.session.mode, state.session.webId, state.session.storageUrl])}
      session={state.session}
      provision={false}
    >
      <DriveShareBatch key={batch.id} intake={intake} batch={batch} session={state.session} />
    </DriveProvider>
  );
}

export function ShareScreen({ intake = nativeShareIntake }: { intake?: ShareIntake }) {
  const [native, setNative] = useState(false);
  const snapshot = useSyncExternalStore(
    intake.subscribe,
    intake.getSnapshot,
    intake.getServerSnapshot,
  );
  useEffect(() => {
    if (!isNativeApp()) return;
    setNative(true);
    void intake.refresh();
  }, [intake]);
  const batch = native ? snapshot.batches[0] : undefined;
  return (
    <ShareFrame>
      {batch ? (
        <PodSessionProvider>
          <ShareSession intake={intake} batch={batch} />
        </PodSessionProvider>
      ) : snapshot.error && native ? (
        <>
          <p role="alert">Couldn't read pending shares.</p>
          <Button onClick={() => void intake.refresh()}>Retry</Button>
        </>
      ) : (
        <p>Nothing to save</p>
      )}
    </ShareFrame>
  );
}
