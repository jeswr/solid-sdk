// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  ConsentSheet,
  DurationChips,
  PeoplePicker,
  type PermissionItem,
  PermissionRow,
  RoleSelect,
  type SharingDuration,
  type SharingError,
  type SharingPerson,
  type SharingRole,
  type SharingState,
} from "@jeswr/suite-ui";
import { type ReactNode, useState } from "react";

const people: SharingPerson[] = [
  {
    webId: "https://bram.example/profile#me",
    displayName: "Bram Kerst",
    emails: ["bram@example.com"],
  },
  { webId: "https://alice.example/profile#me", displayName: "Alice Wilder" },
];
const profile = (webId: string) => ({
  displayName: people.find((person) => person.webId === webId)?.displayName ?? "",
  loading: false,
});
const errors: SharingError[] = [
  "reauth",
  "forbidden",
  "not-found",
  "unreachable",
  "unsupported",
  "unknown",
];
export const asyncFixtureStates: { name: string; state: SharingState }[] = [
  { name: "Loading", state: { kind: "loading" } },
  { name: "First use", state: { kind: "empty" } },
  { name: "Filtered empty", state: { kind: "filtered", query: "Playlists" } },
  ...errors.map((code) => ({ name: `Error ${code}`, state: { kind: "error" as const, code } })),
  { name: "Offline saved copies", state: { kind: "offline", cached: true } },
  { name: "Offline unavailable", state: { kind: "offline", cached: false } },
];

function Block({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="foundation-card su-stack" data-fixture={name} aria-label={name}>
      <h2>{name}</h2>
      {children}
    </section>
  );
}
function Frame({ name, children }: { name: string; children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <header className="fixture-heading">
        <a href="/dev/components">All component fixtures</a>
        <h1>{name}</h1>
        <p className="eyebrow">DS-09 · Sharing and consent</p>
      </header>
      <div className="sharing-fixture-grid">{children}</div>
    </main>
  );
}

function PeopleDemo({
  state = { kind: "ready" },
  selected = false,
  initialQuery = "",
  loadingProfile = false,
}: {
  state?: SharingState;
  selected?: boolean;
  initialQuery?: string;
  loadingProfile?: boolean;
}) {
  const [value, setValue] = useState<SharingPerson[]>(selected ? [people[0] as SharingPerson] : []);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("");
  return (
    <>
      <PeoplePicker
        contacts={{
          people: state.kind === "empty" ? [] : people,
          state,
          onRetry: () => setStatus("Retry requested"),
        }}
        value={value}
        onChange={setValue}
        query={query}
        onQueryChange={setQuery}
        useProfile={loadingProfile ? () => ({ loading: true }) : profile}
      />
      <p role="status">{status}</p>
    </>
  );
}
export function PeopleFixtures() {
  return (
    <Frame name="PeoplePicker">
      <Block name="Contacts and raw entry">
        <PeopleDemo />
      </Block>
      <Block name="Selected person">
        <PeopleDemo selected />
      </Block>
      <Block name="Profile loading">
        <PeopleDemo selected loadingProfile />
      </Block>
      <Block name="Unmatched search">
        <PeopleDemo initialQuery="Nobody" />
      </Block>
      {asyncFixtureStates.map(({ name, state }) => (
        <Block name={name} key={name}>
          <PeopleDemo state={state} />
        </Block>
      ))}
    </Frame>
  );
}
function RoleDemo({ disabledRole }: { disabledRole?: SharingRole }) {
  const [value, setValue] = useState<SharingRole>("viewer");
  return (
    <RoleSelect
      value={value}
      onChange={setValue}
      options={
        disabledRole
          ? { [disabledRole]: { disabled: true, reason: "Not available on this storage" } }
          : {}
      }
    />
  );
}
export function RoleFixtures() {
  return (
    <Frame name="RoleSelect">
      <Block name="All roles">
        <RoleDemo />
      </Block>
      {(["viewer", "commenter", "editor", "manager"] as const).map((role) => (
        <Block name={`${role} disabled`} key={role}>
          <RoleDemo disabledRole={role} />
        </Block>
      ))}
    </Frame>
  );
}
function DurationDemo({
  initial = "until-revoked",
  disabled = false,
}: {
  initial?: SharingDuration;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<SharingDuration>(initial);
  const [date, setDate] = useState("2027-01-02");
  return (
    <DurationChips
      value={value}
      onChange={setValue}
      customDate={date}
      onCustomDateChange={setDate}
      {...(disabled ? { disabled: true, reason: "Not available on this storage" } : {})}
    />
  );
}
export function DurationFixtures() {
  return (
    <Frame name="DurationChips">
      {(["until-revoked", "day", "month", "year", "custom"] as const).map((value) => (
        <Block name={value} key={value}>
          <DurationDemo initial={value} />
        </Block>
      ))}
      <Block name="Expiry unavailable">
        <DurationDemo disabled />
      </Block>
      <Block name="Custom unavailable">
        <DurationDemo initial="custom" disabled />
      </Block>
    </Frame>
  );
}

const dataTypes = [
  {
    id: "music",
    label: "Music interests",
    description: "Artists you follow and songs you like.",
    count: 24,
    sources: ["Spotify"],
  },
  {
    id: "activity",
    label: "Activity",
    description: "Your exercise sessions and daily activity.",
    count: 12,
    sources: ["Strava", "Your pod"],
  },
  {
    id: "vitals",
    label: "Vitals",
    description: "Your heart rate and sleep observations.",
    count: 1,
    sources: ["MyHealth"],
  },
];
export const consentFixtureNames = [
  "Default",
  "No purpose",
  "Nothing selected",
  "Partly selected",
  "Single account",
  "Expiry unavailable",
  "Custom duration",
  ...asyncFixtureStates.map(({ name }) => name),
];
export function ConsentFixtures() {
  const [scenario, setScenario] = useState("Default");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(["music", "activity", "vitals"]);
  const [duration, setDuration] = useState<SharingDuration>("until-revoked");
  const [date, setDate] = useState("2027-01-02");
  const [account, setAccount] = useState("personal");
  const [status, setStatus] = useState("");
  const state = asyncFixtureStates.find(({ name }) => name === scenario)?.state ?? {
    kind: "ready" as const,
  };
  return (
    <Frame name="ConsentSheet">
      <Block name="Request variants">
        <div className="su-wrap">
          {consentFixtureNames.map((name) => (
            <button
              type="button"
              key={name}
              className="su-button"
              onClick={() => {
                setScenario(name);
                setSelected(
                  name === "Nothing selected"
                    ? []
                    : name === "Partly selected"
                      ? ["music"]
                      : ["music", "activity", "vitals"],
                );
                setDuration(name === "Custom duration" ? "custom" : "until-revoked");
                setAccount("personal");
                setOpen(true);
                setStatus("");
              }}
            >
              Open {name}
            </button>
          ))}
        </div>
        <p role="status">{status}</p>
      </Block>
      <ConsentSheet
        open={open}
        onOpenChange={setOpen}
        name="MaraCoach"
        {...(scenario === "No purpose" ? {} : { purpose: "suggest running playlists" })}
        dataTypes={dataTypes}
        selected={selected}
        onSelectionChange={setSelected}
        duration={{
          value: duration,
          onChange: setDuration,
          customDate: date,
          onCustomDateChange: setDate,
          ...(scenario === "Expiry unavailable"
            ? { disabled: true as const, reason: "Not available on this storage" }
            : {}),
        }}
        accounts={
          scenario === "Single account"
            ? [{ id: "personal", label: "Alice · Personal" }]
            : [
                { id: "personal", label: "Alice · Personal" },
                { id: "work", label: "Alice · Work" },
              ]
        }
        accountId={account}
        onAccountChange={setAccount}
        state={state}
        onRetry={() => setStatus("Retry requested")}
        onClear={() => setScenario("Default")}
        onCancel={() => {
          setOpen(false);
          setStatus("Request denied");
        }}
        onShare={() => {
          setOpen(false);
          setStatus(`Shared ${selected.length} data types from ${account}`);
        }}
      />
    </Frame>
  );
}

const permissionItems: PermissionItem[] = [
  {
    id: "music",
    label: "Music interests",
    feature: "Suggests running playlists",
    duration: "Until revoked",
    checked: false,
    sources: ["Spotify"],
    consequence:
      "Playlist suggestions in MaraCoach will stop working. Your data stays in your pod.",
  },
  {
    id: "activity",
    label: "Activity",
    feature: "Builds your weekly plan",
    duration: "Until 2 Jan 2027",
    checked: true,
  },
  {
    id: "vitals",
    label: "Vitals",
    feature: "Adjusts intensity to your heart rate",
    duration: "Until revoked",
    checked: true,
  },
];
function PermissionDemo({
  state = { kind: "ready" },
  collapsed = false,
  inherited = false,
  fallback = false,
}: {
  state?: SharingState;
  collapsed?: boolean;
  inherited?: boolean;
  fallback?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsed);
  const [items, setItems] = useState<PermissionItem[]>(
    state.kind === "empty"
      ? []
      : fallback
        ? [{ id: "files", label: "Files", duration: "Until revoked", checked: false }]
        : inherited
          ? permissionItems.map((item) => ({
              ...item,
              disabled: true,
              reason: "Inherited from Health. Change access on the parent.",
            }))
          : permissionItems,
  );
  const [status, setStatus] = useState("");
  return (
    <>
      <PermissionRow
        name={fallback ? "Bram Kerst" : "MaraCoach"}
        since={fallback ? "" : "2 Oct 2026"}
        items={items}
        expanded={expanded}
        onExpandedChange={setExpanded}
        onItemChange={(id, checked) =>
          setItems(items.map((item) => (item.id === id ? { ...item, checked } : item)))
        }
        onRevoke={() => {
          setItems(items.map((item) => ({ ...item, checked: false })));
          setStatus("MaraCoach no longer has access");
        }}
        state={state}
        onRetry={() => setStatus("Retry requested")}
        onClear={() => setStatus("Clear filters requested")}
      />
      <p role="status">{status}</p>
    </>
  );
}
export function PermissionFixtures() {
  return (
    <Frame name="PermissionRow">
      <Block name="Expanded and consequence">
        <PermissionDemo />
      </Block>
      <Block name="Collapsed">
        <PermissionDemo collapsed />
      </Block>
      <Block name="Inherited disabled">
        <PermissionDemo inherited />
      </Block>
      <Block name="Fallback feature and unknown date">
        <PermissionDemo fallback />
      </Block>
      {asyncFixtureStates.map(({ name, state }) => (
        <Block name={name} key={name}>
          <PermissionDemo state={state} />
        </Block>
      ))}
    </Frame>
  );
}
