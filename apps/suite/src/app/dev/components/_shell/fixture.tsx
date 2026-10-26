// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { type DetailsPaneProps, ShellFrame, type SidebarNavProps } from "@jeswr/suite-ui/shell";
import {
  Bell,
  CheckSquare2,
  Clock,
  FileText,
  Folder,
  HardDrive,
  House,
  LayoutGrid,
  Search,
  ShieldCheck,
  Star,
  Table2,
  Trash2,
  Users,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { useFixturePreferences } from "./preferences";
import "./fixture.css";

const apps = [
  { name: "Home", icon: House, path: "shell" },
  { name: "Drive", icon: HardDrive, path: "sidebar-nav" },
  { name: "Docs", icon: FileText, path: "top-bar" },
  { name: "Tasks", icon: CheckSquare2, path: "details-pane" },
];
const states = [
  "ready",
  "loading",
  "first-use",
  "filtered",
  "forbidden",
  "unreachable",
  "not-found",
  "refreshing",
  "offline",
] as const;
export type FixtureState = (typeof states)[number];
export function fixtureState(value: string | undefined): FixtureState {
  return states.find((state) => state === value) ?? "ready";
}
const sidebar: SidebarNavProps = {
  label: "Drive sections",
  header: <h2>Drive</h2>,
  sections: [
    {
      id: "files",
      label: "Files",
      items: [
        { id: "my", label: "My Drive", href: "#suite-page-title", icon: HardDrive, current: true },
        { id: "recent", label: "Recent", href: "#fixture-files", icon: Clock },
        { id: "starred", label: "Starred", href: "#fixture-files", icon: Star, count: 8 },
        { id: "shared", label: "Shared with me", href: "#fixture-files", icon: Users, count: 3 },
        { id: "trash", label: "Trash", href: "#fixture-files", icon: Trash2 },
      ],
    },
    {
      id: "folders",
      label: "Folders",
      collapsible: true,
      items: [
        { id: "work", label: "Work", href: "#fixture-files", icon: Folder, count: 12 },
        { id: "personal", label: "Personal", href: "#fixture-files", icon: Folder, count: 4 },
      ],
    },
  ],
  footer: <>Saved to your pod</>,
};

function SurfaceState({ state, onReset }: { state: FixtureState; onReset: () => void }) {
  if (state === "loading")
    return (
      <div className="ds04-skeleton" role="status" aria-label="Loading details">
        {[0, 1, 2, 3].map((n) => (
          <span key={n} />
        ))}
      </div>
    );
  const copy: Record<string, { title: string; body: string; action: string }> = {
    "first-use": {
      title: "Select a file",
      body: "Choose a file to see its details and who has access.",
      action: "Choose a file",
    },
    filtered: {
      title: "No results for 'budget'",
      body: "Try another search or clear your filters.",
      action: "Clear filters",
    },
    forbidden: {
      title: "You don't have access to this",
      body: "Ask the owner to share this file with you.",
      action: "Switch account",
    },
    unreachable: {
      title: "Can't reach your storage",
      body: "Try again or open one of your saved copies.",
      action: "Retry",
    },
    "not-found": {
      title: "This item isn't here any more",
      body: "Go to the parent folder to choose another file.",
      action: "Go to parent",
    },
  };
  const item = copy[state];
  if (!item) return null;
  return (
    <div
      className="ds04-surface-state"
      role={["forbidden", "unreachable", "not-found"].includes(state) ? "alert" : "status"}
    >
      <Folder size={24} strokeWidth={1.5} aria-hidden="true" />
      <h3>{item.title}</h3>
      <p>{item.body}</p>
      <button type="button" onClick={onReset}>
        {item.action}
      </button>
    </div>
  );
}

export function ShellFixture({
  component,
  initialState,
}: {
  component: string;
  initialState: string | undefined;
}) {
  const [preferences, setPreferences] = useFixturePreferences();
  const [state, setState] = useState<FixtureState>(fixtureState(initialState));
  const ready = ["ready", "refreshing", "offline"].includes(state);
  const details: DetailsPaneProps = {
    title: ready ? "Q3 Budget" : "File details",
    ...(ready
      ? {
          preview: (
            <div className="ds04-preview">
              <Table2 size={48} strokeWidth={1.5} aria-hidden="true" />
            </div>
          ),
          metadata: [
            { label: "Type", value: "Spreadsheet" },
            { label: "Size", value: "24 KB" },
            { label: "Modified", value: "Today, 10:42" },
            { label: "Location", value: "My Drive / Work" },
            { label: "Owner", value: "You" },
          ],
          access: (
            <p className="ds04-access">
              <ShieldCheck size={20} strokeWidth={1.75} aria-hidden="true" />
              Only you have access
            </p>
          ),
          actions: <a href="#fixture-files">Open file</a>,
        }
      : { children: <SurfaceState state={state} onReset={() => setState("ready")} /> }),
  };
  return (
    <ShellFrame
      skipLink={false}
      pageTitle="My Drive"
      preferences={preferences}
      onPreferencesChange={setPreferences}
      rail={
        <nav aria-label="Apps" className="ds04-rail">
          <a
            href="/dev/components"
            aria-label="Component fixtures"
            title="Component fixtures"
            className="ds04-brand"
          >
            <LayoutGrid size={24} strokeWidth={1.5} aria-hidden="true" />
          </a>
          {apps.map(({ name, icon: Icon, path }) => (
            <a
              key={name}
              href={`/dev/components/${path}`}
              title={name}
              aria-label={name}
              aria-current={name === "Drive" ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            </a>
          ))}
          <a
            className="ds04-rail-bottom"
            href="#fixture-notes"
            title="Account"
            aria-label="Account"
          >
            <span className="ds04-avatar">AW</span>
          </a>
        </nav>
      }
      tabBar={
        <nav aria-label="Apps" className="ds04-tabs">
          {apps.map(({ name, icon: Icon, path }) => (
            <a
              key={name}
              href={`/dev/components/${path}`}
              aria-current={name === "Drive" ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
              {name}
            </a>
          ))}
          <a href="/dev/components">
            <LayoutGrid size={20} strokeWidth={1.75} aria-hidden="true" />
            More
          </a>
        </nav>
      }
      sidebar={sidebar}
      details={details}
      topBar={{
        appName: "Drive",
        context: "My Drive",
        search: (
          <>
            <label className="ds04-search">
              <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only">Search Drive</span>
              <input type="search" placeholder="Search in Drive" />
            </label>
            <a
              href="#fixture-filter"
              className="suite-icon-button ds04-mobile-search"
              title="Search Drive"
              aria-label="Search Drive"
            >
              <Search size={20} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </>
        ),
        actions: (
          <a className="ds04-fixture-link" href="/dev/components">
            Fixtures
          </a>
        ),
        offlinePill:
          state === "offline" ? (
            <span role="status" className="ds04-offline">
              <WifiOff size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Offline — showing saved copies</span>
            </span>
          ) : undefined,
        bell: (
          <a
            href="#fixture-notes"
            className="suite-icon-button ds04-bell"
            aria-label="Notifications, 2 unread"
            title="Notifications, 2 unread"
          >
            <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
          </a>
        ),
        account: (
          <a
            href="#fixture-notes"
            className="suite-icon-button"
            aria-label="Account, Alice Wilder"
            title="Account, Alice Wilder"
          >
            <span className="ds04-avatar">AW</span>
          </a>
        ),
        refreshing: state === "refreshing",
      }}
    >
      <div className="ds04-fixture-controls">
        <p className="eyebrow">DS-04 · {component}</p>
        <label>
          Fixture state{" "}
          <select value={state} onChange={(event) => setState(fixtureState(event.target.value))}>
            {states.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Filter files <input id="fixture-filter" type="search" placeholder="Name contains…" />
        </label>
      </div>
      {ready ? (
        <section id="fixture-files" aria-label="Files" className="ds04-files">
          {[
            "Q3 Budget",
            "Project brief",
            "Holiday plans",
            "Meeting notes",
            ...Array.from({ length: 20 }, (_, n) => `Project ${n + 1}`),
          ].map((name, n) => (
            <a key={name} href="#fixture-notes" className="ds04-file" id={`file-${n}`}>
              {n === 0 ? (
                <Table2 size={20} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <FileText size={20} strokeWidth={1.75} aria-hidden="true" />
              )}
              <span>{name}</span>
              <span className="ds04-file-meta">{n === 0 ? "Today, 10:42" : "Yesterday"}</span>
            </a>
          ))}
        </section>
      ) : (
        <section id="fixture-files" className="foundation-card" aria-label="File list state">
          <SurfaceState state={state} onReset={() => setState("ready")} />
        </section>
      )}
      <section id="fixture-notes" className="ds04-notes" aria-label="Fixture notes">
        <h2>Shell layout</h2>
        <p>
          Use [ to toggle the sidebar and ] to toggle file details. Choices are saved in this
          browser for these fixtures.
        </p>
        <a href="/dev/components">All component fixtures</a>
      </section>
    </ShellFrame>
  );
}
