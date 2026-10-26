#!/usr/bin/env node
/**
 * awp-dashboard: the owner's local settings dashboard.
 *
 *   init              create the private state directory (0700) and settings (0600)
 *   import-inventory  read-only import of a SANITISED account inventory snapshot (explicit file)
 *   demo-setup        a separate synthetic demo: two new agents plus generic demo records
 *   serve             the loopback web UI (prints a one-time sign-in link; Enter prints another)
 *   status            revision and counts (no account details)
 *
 * The state directory holds owner-private settings only. It never holds agent signing keys the
 * web server would load: demo owner keys go to a separate directory the server never reads.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { actionsCommand, addFixtureProviderCalendars } from "../actions/cli.js";
import { providerEnvironment } from "../actions/providers/setup.js";
import { main as pilot } from "../pilot/cli.js";
import { SyntheticCalendar } from "../pilot/domains/scheduling.js";
import { applyToAgent, evaluateCalendars } from "./calendars.js";
import { applySnapshot, parseSnapshot } from "./inventory.js";
import type { CalendarSource, Connection, Settings } from "./model.js";
import { createDashboardApp, DEFAULT_PORT, listenDashboard } from "./server.js";
import { ensurePrivateDir, SettingsStore } from "./store.js";

const USAGE = `awp-dashboard <command> [options]

  init                          create the private state directory and empty settings
  import-inventory --file FILE  import a sanitised inventory snapshot (read-only; the file and
                                the project it came from are never modified)
  demo-setup (--sparq-bin PATH | --policy-engine solid-odrl)
                                create the synthetic demo agents demo-owner and demo-peer (new,
                                in the dashboard's own agents directory) and generic demo records
  serve [--port ${DEFAULT_PORT}] [--open]   the loopback dashboard (127.0.0.1 only); prints a one-time
                                sign-in link, or with --open hands it to the default browser
  status                        settings revision and counts
  label-demo-clock              one-off, recorded migration: label history entries and record
                                times later than the real time (written by the demo clock before
                                the clocks were separated); times are kept, not rewritten
  actions list | describe --id ID | prepare --id ID --input FILE|- | execute --token T | mcp
                                the deterministic action catalogue (see docs/ACTIONS.md)
  demo-provider-fixtures        add SYNTHETIC Google and Microsoft fixture calendars to a separate
                                demo state (use with --provider-fixtures)

Provider access (serve, actions): --provider-config FILE (operator file, no secrets; see
docs/PROVIDER-ACTIONS.md) or --provider-fixtures (synthetic, no network). Default: none.

Common: --state DIR (default .awp-dashboard)  --agents-dir DIR (default <state>/demo-agents)
        --now ISO   fixed synthetic SCHEDULING clock (serve previews; demo-setup agents and busy
                    periods). History, audit times and status freshness always use the real clock.

Optional hosted triage (TypeSafe): set TYPESAFE_API_KEY (and optionally TYPESAFE_MODEL, a pinned
jev-X.Y.Z) in the environment of \`serve\` only. It is never read from a file, form or chat.`;

const DEMO_OWNER = "demo-owner";
const DEMO_PEER = "demo-peer";
const DEMO = {
  [DEMO_OWNER]: {
    party: "https://owner.example/#me",
    actor: "https://agents.owner.example/personal#agent",
    email: "owner.awp@example.org",
    tz: "Europe/London",
  },
  [DEMO_PEER]: {
    party: "https://peer.example/#me",
    actor: "https://agents.peer.example/personal#agent",
    email: "peer.awp@example.net",
    tz: "Europe/London",
  },
} as const;

type Io = { stdout: (s: string) => void; stderr: (s: string) => void };

export async function main(
  argv: readonly string[],
  io: Io = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) },
): Promise<number> {
  const [command, ...afterCommand] = argv;
  // `actions` takes a sub-command word before its options.
  const sub = command === "actions" ? afterCommand[0] : undefined;
  const rest = command === "actions" ? afterCommand.slice(1) : afterCommand;
  const { values } = parseArgs({
    args: rest,
    options: {
      state: { type: "string" },
      "agents-dir": { type: "string" },
      file: { type: "string" },
      port: { type: "string" },
      now: { type: "string" },
      "sparq-bin": { type: "string" },
      "policy-engine": { type: "string" },
      open: { type: "boolean" },
      id: { type: "string" },
      input: { type: "string" },
      token: { type: "string" },
      "provider-config": { type: "string" },
      "provider-fixtures": { type: "boolean" },
    },
    strict: true,
  });
  const stateDir = resolve(values.state ?? ".awp-dashboard");
  const agentsDir = resolve(values["agents-dir"] ?? join(stateDir, "demo-agents"));
  const fixedNow = values.now;
  if (fixedNow && Number.isNaN(Date.parse(fixedNow)))
    throw new Error("--now must be an ISO instant");
  // Two clocks: the REAL clock dates history and records and judges freshness; the optional
  // synthetic clock (--now) only drives scheduling (previews, demo agents, demo busy periods).
  const realNow = () => new Date();
  const schedulingNow = () => (fixedNow ? new Date(fixedNow) : new Date());
  const store = new SettingsStore(stateDir, realNow);
  const print = (v: unknown) => io.stdout(`${JSON.stringify(v, null, 2)}\n`);

  switch (command) {
    case "init": {
      const s = store.init();
      print({
        state: stateDir,
        revision: s.revision,
        note: "private: directory 0700, settings 0600",
      });
      return 0;
    }
    case "import-inventory": {
      if (!values.file) throw new Error("--file is required");
      // Read-only: the snapshot is parsed and validated; nothing is written next to it.
      const snap = parseSnapshot(JSON.parse(readFileSync(resolve(values.file), "utf8")));
      store.init();
      let report: ReturnType<typeof applySnapshot> | undefined;
      const s = store.update(
        store.read().revision,
        "inventory import",
        "Imported the account inventory",
        `${snap.accounts.length} accounts from a sanitised snapshot`,
        (d) => {
          report = applySnapshot(d, snap, realNow().toISOString());
        },
      );
      // Counts only: account details stay in the private state.
      print({
        revision: s.revision,
        imported: report?.imported,
        updated: report?.updated,
        skipped: report?.skipped.length,
        historicEvidenceForUnlistedAddresses: report?.evidenceForUnknownAddresses,
        note: "Statuses are inventory records, not live checks; nothing was connected.",
      });
      return 0;
    }
    case "demo-setup":
      return demoSetup({
        stateDir,
        agentsDir,
        store,
        realNow,
        schedulingNow,
        fixedNow,
        values,
        print,
        io,
      });
    case "actions":
      return actionsCommand(
        sub,
        {
          id: values.id,
          input: values.input,
          token: values.token,
          providerConfig: values["provider-config"],
          providerFixtures: values["provider-fixtures"],
        },
        { store, stateDir, agentsDir, realNow, schedulingNow, print, readStdin },
      );
    case "demo-provider-fixtures": {
      const s = addFixtureProviderCalendars(store, realNow().toISOString());
      print({
        revision: s.revision,
        added:
          "2 demo accounts, 4 fixture calendars (Google primary + shared, Outlook primary + secondary), counting for availability",
        note: "Synthetic. Use serve/actions with --provider-fixtures. The agent runtime cannot read provider calendars, so its applied availability stays blocked.",
      });
      return 0;
    }
    case "label-demo-clock": {
      const r = store.labelSyntheticClockTimes();
      print({
        revision: r.revision,
        labelledHistoryEntries: r.history,
        labelledRecords: r.records,
        note:
          r.history + r.records > 0
            ? "Times from the demo clock were kept and labelled; the migration is in the history."
            : "Nothing to label.",
      });
      return 0;
    }
    case "status": {
      const s = store.read();
      const ev = evaluateCalendars(s, agentsDir);
      print({
        state: stateDir,
        revision: s.revision,
        connections: s.connections.length,
        calendars: s.calendars.length,
        availability: ev.status,
        managedAgents: s.managedAgents,
        hostedTriageEnabled: s.triage.hostedEnabled,
      });
      return 0;
    }
    case "serve": {
      const port = Number.parseInt(values.port ?? String(DEFAULT_PORT), 10);
      if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw new Error("--port must be 1024–65535");
      const actionProviders = providerEnvironment({
        configPath: values["provider-config"] ?? process.env.AWP_PROVIDER_CONFIG,
        fixtures: values["provider-fixtures"],
      });
      const d = createDashboardApp({
        stateDir,
        agentsDir,
        port,
        actions: actionProviders,
        now: realNow,
        ...(fixedNow ? { schedulingNow } : {}),
        env: process.env,
        log: (line) => io.stderr(`${line}\n`),
      });
      const server = await listenDashboard(d, port);
      const link = () => `http://127.0.0.1:${port}/#code=${d.issueBootstrapCode()}`;
      io.stderr(
        `dashboard: listening on 127.0.0.1:${port} only; hosted triage ${d.hostedConfigured ? "key configured (off until you turn it on)" : "not configured"}\n`,
      );
      // The link signs in once (10 minutes). Treat it like a password until it is used: with
      // --open it goes straight to the default browser instead of the terminal.
      const give = (first: boolean) => {
        const url = link();
        if (values.open && openInBrowser(url)) {
          io.stdout(
            "Opened a one-time sign-in link in your default browser. Press Enter for another.\n",
          );
          return;
        }
        io.stdout(
          `${first ? "Open this one-time sign-in link (valid 10 minutes, single use; press Enter for a new one). Do not share or paste it elsewhere:\n" : ""}${url}\n`,
        );
      };
      give(true);
      process.stdin.on("data", () => give(false));
      const stop = () => {
        process.stdin.pause();
        server.close(() => process.exit(0));
        server.closeAllConnections();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      return await new Promise<number>(() => undefined);
    }
    default:
      io.stdout(`${USAGE}\n`);
      return command === undefined || command === "help" ? 0 : 2;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Hand a loopback URL to the platform's browser opener (no shell). False if unavailable. */
function openInBrowser(url: string): boolean {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/#code=[A-Za-z0-9_-]+$/.test(url)) return false;
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
  if (!opener) return false;
  try {
    const child = spawn(opener, [url], { stdio: "ignore", detached: true, shell: false });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function demoSetup(ctx: {
  stateDir: string;
  agentsDir: string;
  store: SettingsStore;
  realNow: () => Date;
  schedulingNow: () => Date;
  fixedNow: string | undefined;
  values: { "sparq-bin"?: string; "policy-engine"?: string };
  print: (v: unknown) => void;
  io: Io;
}): Promise<number> {
  const { agentsDir, store, realNow, schedulingNow, values } = ctx;
  const engine = values["policy-engine"] ?? (values["sparq-bin"] ? "sparq" : undefined);
  if (!engine)
    throw new Error("demo-setup needs --sparq-bin PATH (SPARQ) or --policy-engine solid-odrl");
  if (engine === "sparq" && !values["sparq-bin"])
    throw new Error("--policy-engine sparq needs --sparq-bin");
  store.init();
  if (store.read().managedAgents.length > 0 || store.read().calendars.length > 0)
    throw new Error("demo-setup runs once, on settings without agents or calendars");
  ensurePrivateDir(agentsDir);
  const ownerKeys = join(ctx.stateDir, "demo-owner-keys");
  ensurePrivateDir(ownerKeys);
  const cards = join(ctx.stateDir, "demo-cards");
  ensurePrivateDir(cards);
  const common = ["--dir", agentsDir, ...(ctx.fixedNow ? ["--now", ctx.fixedNow] : [])];
  const run = async (args: string[]) => {
    let out = "";
    const code = await pilot([...args, ...common], { stdout: (s) => (out += s) });
    if (code !== 0) throw new Error(`awp-pilot ${args[0]} failed (${code})`);
    return out;
  };
  const kids: Record<string, { partyKid: string; actorKid: string }> = {};
  for (const [name, a] of Object.entries(DEMO)) {
    if (existsSync(join(agentsDir, name)))
      throw new Error(`${name} already exists in the agents directory; not overwritten`);
    const peer = name === DEMO_OWNER ? DEMO[DEMO_PEER] : DEMO[DEMO_OWNER];
    const init = JSON.parse(
      await run([
        "init",
        "--name",
        name,
        "--party",
        a.party,
        "--actor",
        a.actor,
        "--email",
        a.email,
        "--timezone",
        a.tz,
        "--known-party",
        peer.party,
        `--policy-engine=${engine}`,
        ...(values["sparq-bin"] ? [`--sparq-bin=${resolve(values["sparq-bin"])}`] : []),
        "--owner-dir",
        ownerKeys,
      ]),
    ) as { partyKid: string; actorKid: string };
    kids[name] = { partyKid: init.partyKid, actorKid: init.actorKid };
    // Initialise the agent's synthetic calendar explicitly (the runtime would otherwise create
    // it on first start). The dashboard treats a MISSING calendar as unavailable — it cannot
    // tell "new" from "lost" — so it must exist before the calendar is offered as available.
    SyntheticCalendar.open(join(agentsDir, name, "calendar.json"), {
      timeZone: a.tz,
      workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      busy: [],
      holds: {},
    });
    writeFileSync(join(cards, `${name}.card.json`), await run(["card", "--name", name]), {
      mode: 0o600,
    });
  }
  for (const [who, other] of [
    [DEMO_OWNER, DEMO_PEER],
    [DEMO_PEER, DEMO_OWNER],
  ] as const)
    await run([
      "pin",
      "--name",
      who,
      "--card",
      join(cards, `${other}.card.json`),
      `--party-kid=${kids[other]?.partyKid}`,
      `--actor-kid=${kids[other]?.actorKid}`,
    ]);

  // Records are dated by the real clock; the demo busy periods sit on the scheduling clock.
  const at = realNow().toISOString();
  const day = schedulingNow().toISOString().slice(0, 10);
  const next = (d: number, time: string) => {
    const t = new Date(`${day}T${time}:00Z`);
    t.setUTCDate(t.getUTCDate() + d);
    return t.toISOString().replace(".000Z", "Z");
  };
  const demoConnection = (
    id: string,
    label: string,
    channel: string,
    provider: string,
    identifiers: string[],
  ): Connection => ({
    id,
    label,
    channel,
    provider,
    organisation: "Example Organisation (synthetic)",
    identifiers,
    origin: "demo",
    evidence: [],
    conflicts: [],
    localConnector: { state: "setup-required" },
    restrictions: {
      agentEnabled: false,
      read: false,
      triage: false,
      draft: false,
      hostedTriage: false,
    },
    notes: "Synthetic demo record.",
    updatedAt: at,
    updatedBy: "demo setup",
  });
  const calendars: CalendarSource[] = [
    {
      id: "demo-agent-calendar",
      label: "Demo agent calendar (synthetic holds)",
      kind: "agent-synthetic",
      agent: DEMO_OWNER,
      busy: [],
      enabled: true,
      permissions: { readAvailability: true, createBookings: true },
    },
    {
      id: "demo-team-rota",
      label: "Demo team rota",
      kind: "local-synthetic",
      busy: [
        { start: next(1, "09:00"), end: next(1, "12:00") },
        { start: next(2, "13:00"), end: next(2, "15:00") },
      ],
      enabled: true,
      permissions: { readAvailability: true, createBookings: false },
    },
    {
      id: "demo-provider-calendar",
      label: "Demo provider calendar (not connected)",
      kind: "external",
      provider: "caldav",
      connectionId: "demo-calendar-account",
      busy: [],
      enabled: false,
      permissions: { readAvailability: false, createBookings: false },
    },
  ];
  const s = store.update(
    store.read().revision,
    "demo setup",
    "Created the synthetic demo",
    `agents ${DEMO_OWNER} and ${DEMO_PEER}; 3 demo accounts; 3 calendars`,
    (d: Settings) => {
      d.connections.push(
        demoConnection("demo-mailbox", "Demo mailbox", "email", "gmail", [DEMO[DEMO_OWNER].email]),
        demoConnection("demo-team-chat", "Demo team chat", "slack", "slack", ["#demo-team"]),
        demoConnection("demo-calendar-account", "Demo calendar account", "calendar", "caldav", [
          "calendar.example.org",
        ]),
      );
      d.calendars = calendars;
      d.availability = {
        authoritative: ["demo-agent-calendar", "demo-team-rota"],
        bookingTarget: "demo-agent-calendar",
        timeZone: "Europe/London",
        workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      };
      d.managedAgents = [DEMO_OWNER];
    },
  );
  const applied = applyToAgent(s, agentsDir, DEMO_OWNER, realNow().toISOString());
  ctx.print({
    agentsDir,
    ownerKeys,
    agents: [DEMO_OWNER, DEMO_PEER],
    managed: [DEMO_OWNER],
    revision: s.revision,
    availabilityApplied: { revision: applied.file.revision, blocked: applied.file.blocked ?? null },
    note: "Synthetic only. Owner keys are in their own directory; the dashboard server never reads them.",
  });
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`awp-dashboard: ${(error as Error).message}\n`);
      process.exit(1);
    },
  );
