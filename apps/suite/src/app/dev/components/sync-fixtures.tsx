// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  Button,
  CapabilityGate,
  CapabilityProvider,
  ConflictDialog,
  OfflinePill,
  type OutboxItem,
  type SyncConflict,
  SyncSheet,
  type SyncSnapshot,
  useRequiresOnline,
} from "@jeswr/suite-ui";
import { type ReactNode, useEffect, useState } from "react";
import type { SyncFixtureName } from "./fixture-names";

const now = new Date("2026-10-20T12:00:00Z");
const conflict: SyncConflict = {
  id: "project-brief",
  name: "Project brief",
  where: "My Drive / Work",
  summary: "You changed the title. Another device changed the introduction.",
  changedAt: new Date("2026-10-20T11:56:00Z"),
};
const saved: SyncSnapshot = {
  online: true,
  reconnecting: false,
  pending: [],
  conflicts: [],
  lastSyncedAt: new Date("2026-10-20T11:55:00Z"),
};
const failed: OutboxItem = {
  id: "failed-change",
  label: "Rename project brief",
  where: "My Drive / Work",
  queuedAt: new Date("2026-10-20T11:59:00Z"),
  state: "failed",
};
const pending = ["Rename project brief", "Save meeting notes", "Move holiday plans"].map(
  (label, i) => ({
    id: `change-${i}`,
    label,
    where: "My Drive / Work",
    queuedAt: new Date(now.getTime() - (i + 1) * 60000),
    state: "pending" as const,
  }),
);
export const syncScenarios: { name: string; snapshot: SyncSnapshot }[] = [
  { name: "Hidden", snapshot: saved },
  { name: "Offline", snapshot: { ...saved, online: false } },
  { name: "Reconnecting", snapshot: { ...saved, reconnecting: true } },
  { name: "1 waiting", snapshot: { ...saved, pending: pending.slice(0, 1) } },
  { name: "3 waiting", snapshot: { ...saved, pending } },
  { name: "Conflict", snapshot: { ...saved, conflicts: [conflict] } },
  {
    name: "3 conflicts",
    snapshot: {
      ...saved,
      conflicts: [
        conflict,
        { ...conflict, id: "notes", name: "Meeting notes" },
        { ...conflict, id: "plans", name: "Holiday plans" },
      ],
    },
  },
  { name: "Offline with changes", snapshot: { ...saved, online: false, pending } },
  {
    name: "Failed",
    snapshot: {
      ...saved,
      pending: [{ ...failed, error: "Your storage could not save this change." }],
    },
  },
  {
    name: "Failed without detail",
    snapshot: { ...saved, pending: [failed] },
  },
  {
    name: "Not synced yet",
    snapshot: { online: true, reconnecting: false, pending: [], conflicts: [] },
  },
  { name: "Mixed", snapshot: { ...saved, pending, conflicts: [conflict] } },
  {
    // Taller than any viewport: the sheet body must scroll to its last action.
    name: "Long queue",
    snapshot: {
      ...saved,
      pending: Array.from({ length: 24 }, (_, i) => ({
        id: `long-${i}`,
        label: `Queued change ${i + 1}`,
        where: "My Drive / Work",
        queuedAt: new Date(now.getTime() - (i + 1) * 60000),
        state: "pending" as const,
      })),
      conflicts: [{ ...conflict, id: "last", name: "Last conflict" }],
    },
  },
  {
    // Nothing focusable inside: only the region itself can take keyboard scrolling.
    name: "Long pending queue",
    snapshot: {
      ...saved,
      pending: Array.from({ length: 24 }, (_, i) => ({
        id: `pending-${i}`,
        label: `Waiting change ${i + 1}`,
        where: "My Drive / Work",
        queuedAt: new Date(now.getTime() - (i + 1) * 60000),
        state: "pending" as const,
      })),
    },
  },
];

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <header className="fixture-heading">
        <a href="/dev/components">All component fixtures</a>
        <h1>{title}</h1>
        <p className="eyebrow">DS-10 · Storage capabilities and sync</p>
      </header>
      <div className="grid gap-4">{children}</div>
    </main>
  );
}
function BrowserOnlineDemo() {
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <section
      className="foundation-card grid gap-3"
      data-fixture="Browser connection"
      aria-label="Browser connection"
    >
      <h2>Browser connection</h2>
      <p role="status">{online ? "Browser is online" : "Browser is offline"}</p>
      <OfflinePill snapshot={{ ...saved, online }} onOpen={() => setOpen(true)} />
      <SyncSheet
        open={open}
        onOpenChange={setOpen}
        snapshot={{ ...saved, online }}
        now={now}
        locale="en-GB"
        onRetryAll={() => {}}
        onRetry={() => {}}
        onResolve={() => {}}
      />
    </section>
  );
}
function OnlineControl({ online }: { online: boolean }) {
  const { disabled, reason } = useRequiresOnline(online, "change sharing");
  return (
    <div>
      <Button variant="outline" disabled={disabled}>
        Change sharing
      </Button>
      {disabled && <p className="suite-sync-note">{reason}</p>}
    </div>
  );
}
export function SyncFixtures({ name }: { name: SyncFixtureName }) {
  const [sheet, setSheet] = useState<SyncSnapshot | null>(null);
  const [decision, setDecision] = useState<SyncConflict | null>(null);
  const [message, setMessage] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  if (name === "capability-gate")
    return (
      <Frame title={name}>
        {(
          [
            "Supported",
            "Disabled",
            "Hidden",
            "Note",
            "Custom reason",
            "Missing capability",
          ] as const
        ).map((scenario) => (
          <section
            key={scenario}
            className="foundation-card grid gap-3"
            aria-label={scenario}
            data-fixture={scenario}
          >
            <h2>{scenario}</h2>
            <CapabilityProvider
              capabilities={
                scenario === "Supported"
                  ? { trash: true }
                  : scenario === "Missing capability"
                    ? {}
                    : { trash: false }
              }
            >
              <CapabilityGate
                need="trash"
                fallback={
                  scenario === "Hidden" ? "hidden" : scenario === "Note" ? "note" : "disabled"
                }
                {...(scenario === "Custom reason"
                  ? { reason: "Your storage does not offer trash." }
                  : {})}
              >
                <Button variant="outline" onClick={() => setMessage("Moved to trash")}>
                  Move to trash
                </Button>
              </CapabilityGate>
            </CapabilityProvider>
          </section>
        ))}
        <section
          className="foundation-card grid gap-3"
          aria-label="Online requirements"
          data-fixture="Online requirements"
        >
          <h2>Online requirements</h2>
          <OnlineControl online />
          <OnlineControl online={false} />
        </section>
        <p role="status">{message}</p>
      </Frame>
    );
  return (
    <Frame title={name}>
      {name === "offline-pill" ? (
        <>
          {syncScenarios.map(({ name: scenario, snapshot }) => (
            <section
              key={scenario}
              className="foundation-card flex flex-wrap items-center gap-3"
              data-fixture={scenario}
              aria-label={scenario}
            >
              <h2 className="w-full">{scenario}</h2>
              <OfflinePill snapshot={snapshot} onOpen={() => setSheet(snapshot)} />
              <OfflinePill snapshot={snapshot} onOpen={() => setSheet(snapshot)} variant="icon" />
            </section>
          ))}
          <BrowserOnlineDemo />
        </>
      ) : name === "sync-sheet" ? (
        syncScenarios.map(({ name: scenario, snapshot }) => (
          <Button key={scenario} variant="outline" onClick={() => setSheet(snapshot)}>
            Open {scenario}
          </Button>
        ))
      ) : (
        <>
          <Button
            variant="outline"
            onClick={() => {
              setDecision(conflict);
              setDialogOpen(true);
            }}
          >
            Open conflict
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDecision({
                ...conflict,
                name: "An item with a long name that wraps across narrow screens",
                summary:
                  "You and another device saved different versions of this item. Review both versions before choosing which changes to keep.",
              });
              setDialogOpen(true);
            }}
          >
            Open long summary
          </Button>
          <p>The dialog stays hidden until a conflict is opened.</p>
        </>
      )}
      <p role="status">{message}</p>
      <SyncSheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
        snapshot={sheet ?? saved}
        now={now}
        locale="en-GB"
        onRetryAll={() => setMessage("Retrying all changes")}
        onRetry={(id) => setMessage(`Retrying ${id}`)}
        onResolve={(id) => {
          setDecision(sheet?.conflicts.find((item) => item.id === id) ?? null);
          setDialogOpen(true);
        }}
      />
      <ConflictDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        conflict={decision}
        onChoose={(strategy) => {
          setMessage(`Chose ${strategy}`);
          setDialogOpen(false);
        }}
      />
    </Frame>
  );
}
