// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createDiaryStore,
  type DiaryDraft,
  type DiaryEntry,
  type DiaryReadFailure,
} from "../lib/data/diary";
import { diaryDay } from "../lib/diary-time";
import type { Range } from "../lib/model";
import { DiaryModeProvider } from "./diary-mode-context";
import { type AsyncState, useHealth } from "./health-context";

interface Edit {
  url: string;
  previousUrl?: string;
  entry: DiaryEntry | null;
  generation: number;
}
interface Snapshot {
  entries: DiaryEntry[];
  failures: DiaryReadFailure[];
  generation: number;
}
interface DiaryContextValue {
  activate(): void;
  load(range?: Range): Promise<Snapshot>;
  revision: number;
  edits: Edit[];
  busy: readonly string[];
  retry(): void;
  save(draft: DiaryDraft, id: string, existing?: DiaryEntry): Promise<void>;
  remove(entry: DiaryEntry): Promise<void>;
}
const Context = createContext<DiaryContextValue | null>(null);
/** Keeps one account-scoped month cache. Only useDiary consumers initiate reads. */
export function DiaryProvider({ children }: { children: ReactNode }) {
  const { session, mutate } = useHealth();
  const diary = useMemo(
    () => createDiaryStore(session.fetch, session.storageUrl, session.webId),
    [session],
  );
  const generation = useRef(0),
    completed = useRef(0),
    pending = useRef(0);
  const [revision, setRevision] = useState(0);
  const [activated, setActivated] = useState(false);
  const activate = useCallback(() => setActivated(true), []);
  const [busy, setBusy] = useState<string[]>([]);
  const [edits, setEdits] = useState<Edit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retry = useCallback(() => {
    clearTimeout(timer.current);
    diary.invalidate();
    setRevision((value) => value + 1);
  }, [diary]);
  const refresh = useCallback(() => {
    diary.invalidate(diary.base);
    setRevision((value) => value + 1);
  }, [diary]);
  useEffect(() => {
    if (!activated) return;
    const changed = new Set<string>();
    const off = session.subscribe((url) => {
      const legacy =
        url.startsWith(`${diary.base}meals/`) || url.startsWith(`${diary.base}symptoms/`);
      if (
        (pending.current && !legacy) ||
        !(url.startsWith(diary.base) || (url.endsWith("/") && diary.base.startsWith(url)))
      )
        return;
      clearTimeout(timer.current);
      changed.add(url);
      timer.current = setTimeout(() => {
        for (const path of changed) diary.invalidate(path);
        changed.clear();
        setRevision((value) => value + 1);
      }, 100);
    });
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, [session, diary, activated]);
  const load = useCallback(
    async (range?: Range): Promise<Snapshot> => {
      const generation = completed.current;
      const failures: DiaryReadFailure[] = [];
      const entries = await diary.list(range, { failures, cached: true });
      return { entries, failures, generation };
    },
    [diary],
  );
  function addEdit(edit: Edit) {
    setEdits((current) => [
      ...current.filter((item) => item.url !== edit.url && item.url !== edit.previousUrl),
      edit,
    ]);
  }
  async function persist(
    draft: DiaryDraft,
    id: string,
    existing?: DiaryEntry,
    undo = true,
    restore = false,
  ) {
    const filename = existing?.url.split("/").at(-1) ?? `${id}.ttl`;
    const url = restore
      ? (existing as DiaryEntry).url
      : `${diary.base}${diaryDay(draft.at).slice(0, 7)}/${filename}`;
    const busyUrl = existing?.url ?? url;
    const token = ++generation.current;
    pending.current++;
    setBusy((current) => [...current, busyUrl]);
    addEdit({
      url,
      ...(existing ? { previousUrl: existing.url } : {}),
      entry: { ...draft, url, etag: existing?.etag ?? null },
      generation: token,
    });
    try {
      const saved = await mutate(async () => {
        const saved = await (restore
          ? diary.restore(existing as DiaryEntry)
          : diary.save(draft, id, existing));
        completed.current = token;
        return saved;
      });
      setEdits((current) =>
        current.map((edit) => (edit.generation === token ? { ...edit, entry: saved } : edit)),
      );
      toast.success(
        existing && undo ? "Diary entry updated" : "Diary entry saved",
        existing && undo
          ? {
              duration: 8000,
              action: {
                label: "Undo",
                onClick: () => {
                  void persist(existing, id, saved, false).catch(() => {});
                },
              },
            }
          : undefined,
      );
    } catch (error) {
      setEdits((current) => current.filter((edit) => edit.generation !== token));
      throw error;
    } finally {
      pending.current--;
      setBusy((current) => current.filter((entry) => entry !== busyUrl));
      refresh();
    }
  }
  async function remove(entry: DiaryEntry) {
    const token = ++generation.current;
    pending.current++;
    setBusy((current) => [...current, entry.url]);
    addEdit({ url: entry.url, entry: null, generation: token });
    try {
      await mutate(async () => {
        await diary.remove(entry);
        completed.current = token;
      });
      toast.success("Diary entry deleted", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => {
            void persist(entry, "restore", entry, false, true).catch(() => {});
          },
        },
      });
    } catch (error) {
      setEdits((current) => current.filter((edit) => edit.generation !== token));
      throw error;
    } finally {
      pending.current--;
      setBusy((current) => current.filter((url) => url !== entry.url));
      refresh();
    }
  }
  return (
    <Context value={{ activate, load, revision, edits, busy, retry, save: persist, remove }}>
      <DiaryModeProvider key={`${session.webId}:${session.storageUrl}`}>
        {children}
      </DiaryModeProvider>
    </Context>
  );
}
export function useDiary(range?: Range) {
  const context = useContext(Context);
  if (!context) throw new Error("Diary provider is required");
  const { boot } = useHealth();
  const { load, revision, busy, edits, activate } = context;
  useEffect(activate, [activate]);
  const start = range?.start.getTime(),
    end = range?.end.getTime();
  const signature = `${start}:${end}`;
  const [loaded, setLoaded] = useState<AsyncState<Snapshot & { signature: string }>>({
    status: "loading",
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the diary-only invalidation event
  useEffect(() => {
    if (boot.status !== "ready" || busy.length) return;
    let live = true;
    const bounds =
      start === undefined || end === undefined
        ? undefined
        : { start: new Date(start), end: new Date(end) };
    void load(bounds).then(
      (data) => {
        if (live)
          setLoaded({
            status: data.entries.length ? "ready" : "empty",
            data: { ...data, signature },
          });
      },
      (error: unknown) => {
        if (live) setLoaded({ status: "error", error });
      },
    );
    return () => {
      live = false;
    };
  }, [load, revision, boot.status, busy.length, start, end, signature]);
  let state: AsyncState<DiaryEntry[]> = loaded.status === "error" ? loaded : { status: "loading" };
  let failures: DiaryReadFailure[] = [];
  if (
    (loaded.status === "ready" || loaded.status === "empty") &&
    loaded.data.signature === signature
  ) {
    failures = loaded.data.failures;
    const entries = new Map(loaded.data.entries.map((entry) => [entry.url, entry]));
    for (const edit of edits)
      if (edit.generation > loaded.data.generation) {
        if (edit.previousUrl) entries.delete(edit.previousUrl);
        if (edit.entry) entries.set(edit.url, edit.entry);
        else entries.delete(edit.url);
      }
    const data = [...entries.values()]
      .filter((entry) => !range || (entry.at >= range.start && entry.at < range.end))
      .sort((a, b) => b.at.getTime() - a.at.getTime() || a.url.localeCompare(b.url));
    state = { status: data.length ? "ready" : "empty", data };
  }
  return {
    state,
    failures,
    busy,
    retry: context.retry,
    save: context.save,
    remove: context.remove,
  };
}
/** Sheets need mutation actions without requesting another (unbounded) listing. */
export function useDiaryActions() {
  const context = useContext(Context);
  if (!context) throw new Error("Diary provider is required");
  return { save: context.save };
}
