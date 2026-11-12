// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropZoneOverlay,
  IconButton,
  toast,
} from "@jeswr/suite-ui";
import { MoreHorizontal } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { useCalendarState, useEventMutations } from "../state/calendar-context";
import { exportCalendar, importCalendar, importEvents } from "../state/transfer";
import type { CalendarInfo } from "../state/view";
import { CalendarSelect, useCalendarEditing } from "./event-editor";

const Transfer = createContext<
  | { choose: (calendar: string) => void; read: (files: File[], target?: string) => Promise<void> }
  | undefined
>(undefined);
export function CalendarTransferProvider({ children }: { children: ReactNode }) {
  const { calendars, prefs } = useCalendarState();
  const editing = useCalendarEditing();
  const picker = useRef<HTMLInputElement>(null);
  const [calendar, setCalendar] = useState("");
  const [parsed, setParsed] = useState<ReturnType<typeof importCalendar>>();
  const [progress, setProgress] = useState<number>();
  const [result, setResult] = useState<Awaited<ReturnType<typeof importEvents>>>();
  const [error, setError] = useState("");
  const mutations = useEventMutations();
  const defaultCalendar = () => {
    const visible =
      calendars.status === "ready"
        ? calendars.calendars.filter((c) => !prefs.hidden.includes(c.url))
        : [];
    return visible.find((c) => c.url === editing?.lastCalendar) ?? visible[0];
  };
  async function read(files: File[], target?: string) {
    setError("");
    setResult(undefined);
    setProgress(undefined);
    try {
      if (!files.length || files.some((f) => !/\.ics$/i.test(f.name) || f.size > 5 * 1024 * 1024))
        throw new Error("Choose .ics files up to 5 MB each.");
      const results = await Promise.all(
        files.map(async (f) =>
          importCalendar(await f.text(), Intl.DateTimeFormat().resolvedOptions().timeZone),
        ),
      );
      setParsed({
        events: results.flatMap((r) => r.events),
        timeZones: results.flatMap((r) => r.timeZones),
        warnings: results.flatMap((r) => r.warnings),
        skipped: results.reduce((n, r) => n + r.skipped, 0),
      });
      setCalendar(
        target
          ? `${target.replace(/#it$/, "")}#it`
          : defaultCalendar()
            ? `${defaultCalendar()?.url}#it`
            : "",
      );
    } catch (failure) {
      toast.error((failure as Error).message);
    }
  }
  return (
    <Transfer
      value={{
        choose: (value) => {
          setCalendar(value ? `${value}#it` : "");
          picker.current?.click();
        },
        read,
      }}
    >
      {children}
      <input
        ref={picker}
        aria-label="Import ICS file"
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void read(files, calendar);
        }}
      />
      <Dialog
        open={Boolean(parsed)}
        onOpenChange={(open) => {
          if (!open && (progress === undefined || result)) setParsed(undefined);
        }}
      >
        <DialogContent className="cal-import-dialog">
          <DialogTitle>Import calendar events</DialogTitle>
          <DialogDescription>
            Review the events and choose their calendar before importing.
          </DialogDescription>
          <p>
            {parsed?.events.length ?? 0} events · {parsed?.skipped ?? 0} skipped
          </p>
          {!!parsed?.warnings.length && (
            <ul aria-label="Import warnings">
              {parsed.warnings.map((w, i) => (
                <li key={String(i)}>{w}</li>
              ))}
            </ul>
          )}
          <CalendarSelect label="Target calendar" value={calendar} onChange={setCalendar} />
          {error && <p role="alert">{error}</p>}
          {progress !== undefined && (
            <p role="status" aria-live="polite">
              {result
                ? `${result.imported} imported, ${result.failed.length} failed`
                : `Importing ${progress} of ${parsed?.events.length ?? 0}…`}
            </p>
          )}
          {!!result?.failed.length && (
            <ul aria-label="Failed imports">
              {result.failed.map((name, i) => (
                <li key={String(i)}>{name}</li>
              ))}
            </ul>
          )}
          <div className="cal-actions">
            {result ? (
              <Button onClick={() => setParsed(undefined)}>Done</Button>
            ) : (
              <>
                <Button
                  disabled={!parsed?.events.length || progress !== undefined}
                  onClick={async () => {
                    const target =
                      calendars.status === "ready" &&
                      calendars.calendars.find((c) => `${c.url}#it` === calendar);
                    if (!target || !parsed) {
                      setError("Choose a calendar.");
                      return;
                    }
                    setProgress(0);
                    const summary = await importEvents(
                      parsed.events,
                      (event) =>
                        mutations.create(
                          new URL(`${crypto.randomUUID()}.ttl`, target.container).href,
                          { ...event, inCalendar: calendar, uid: crypto.randomUUID() },
                        ),
                      setProgress,
                    );
                    editing?.remember(target.url);
                    setResult(summary);
                  }}
                >
                  Import
                </Button>
                <Button
                  variant="outline"
                  disabled={progress !== undefined}
                  onClick={() => setParsed(undefined)}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Transfer>
  );
}
export function CalendarDropArea({ children }: { children: ReactNode }) {
  const transfer = useContext(Transfer);
  const { calendars, prefs } = useCalendarState();
  const editing = useCalendarEditing();
  const visible =
    calendars.status === "ready"
      ? calendars.calendars.filter((c) => !prefs.hidden.includes(c.url))
      : [];
  const target = visible.find((c) => c.url === editing?.lastCalendar) ?? visible[0];
  return (
    <div className="cal-drop-area">
      <DropZoneOverlay
        folderName={target?.title ?? "calendar"}
        disabled={!target}
        readOptions={{ maxEntries: 20, maxDepth: 0 }}
        onFiles={async (dropped) => {
          await transfer?.read(
            dropped.files.map((f) => f.file),
            target?.url,
          );
        }}
      >
        {children}
      </DropZoneOverlay>
      <div className="cal-drop-copy" aria-hidden="true">
        Drop to import into {target?.title}
      </div>
    </div>
  );
}
export function CalendarImportButton() {
  const transfer = useContext(Transfer);
  return (
    <Button variant="outline" onClick={() => transfer?.choose("")}>
      Import .ics
    </Button>
  );
}
export function CalendarMenu({ calendar }: { calendar: CalendarInfo }) {
  const transfer = useContext(Transfer);
  const { session } = useCalendarState();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton variant="ghost" label={`${calendar.title} calendar menu`}>
          <MoreHorizontal aria-hidden="true" size={18} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => transfer?.choose(calendar.url)}>Import…</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void exportCalendar(session, calendar).then(
              (text) => {
                const blob = URL.createObjectURL(
                  new Blob([text], { type: "text/calendar;charset=utf-8" }),
                );
                const anchor = document.createElement("a");
                anchor.href = blob;
                anchor.download = `${calendar.title.replace(/[\\/:*?"<>|]/g, "-")}.ics`;
                document.body.append(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(blob), 1000);
              },
              () => toast.error("Couldn't export this calendar. Please retry."),
            );
          }}
        >
          Export (.ics)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
