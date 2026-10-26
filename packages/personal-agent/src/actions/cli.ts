/**
 * Operator commands for the action catalogue (`awp-dashboard actions …`) and the fixture
 * calendars demo (`awp-dashboard demo-provider-fixtures`). Inputs come from an operator file or
 * stdin; the state and agents directories are operator configuration.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Connection, Settings } from "../dashboard/model.js";
import type { SettingsStore } from "../dashboard/store.js";
import type { ActionsEnv } from "./env.js";
import { createActionRegistry } from "./index.js";
import { createActionsMcpServer } from "./mcp.js";
import { FIXTURE_CALENDARS } from "./providers/fixtures.js";
import { providerEnvironment } from "./providers/setup.js";
import { FilePreparationStore, MemoryPreparationStore } from "./registry.js";
import type { ActionContext, ActionOrigin } from "./types.js";

const MAX_INPUT_BYTES = 1024 * 1024;

export interface ActionsCommandDeps {
  store: SettingsStore;
  stateDir: string;
  agentsDir: string;
  realNow: () => Date;
  schedulingNow: () => Date;
  print: (v: unknown) => void;
  readStdin: () => Promise<string>;
}

export interface ActionsCommandOptions {
  id?: string | undefined;
  input?: string | undefined;
  token?: string | undefined;
  providerConfig?: string | undefined;
  providerFixtures?: boolean | undefined;
}

export async function actionsCommand(
  sub: string | undefined,
  o: ActionsCommandOptions,
  deps: ActionsCommandDeps,
): Promise<number> {
  const { providers, configuredConnections } = providerEnvironment({
    configPath: o.providerConfig ?? process.env.AWP_PROVIDER_CONFIG,
    fixtures: o.providerFixtures,
  });
  const context = (origin: ActionOrigin): ActionContext<ActionsEnv> => ({
    origin,
    now: deps.realNow,
    schedulingNow: deps.schedulingNow,
    env: {
      settings: deps.store.read(),
      agentsDir: deps.agentsDir,
      stateDir: deps.stateDir,
      providers,
      configuredConnections,
    },
  });
  if (sub === "mcp") {
    const server = createActionsMcpServer(createActionRegistry(new MemoryPreparationStore()), () =>
      context("mcp"),
    );
    await server.connect(new StdioServerTransport());
    await new Promise<void>((resolve) => {
      process.stdin.once("end", resolve);
      process.stdin.once("close", resolve);
    });
    await server.close();
    return 0;
  }
  const registry = createActionRegistry(
    new FilePreparationStore(join(deps.stateDir, "action-preparations")),
  );
  switch (sub) {
    case "list":
      deps.print(
        registry.describe().map((d) => ({
          id: d.id,
          title: d.title,
          effect: d.effect,
          phases: d.phases,
          capabilities: d.capabilities,
        })),
      );
      return 0;
    case "describe": {
      const d = registry.describe(context("operator-cli")).find((x) => x.id === o.id);
      if (!d) throw new Error("unknown action (see: actions list)");
      deps.print(d);
      return 0;
    }
    case "prepare": {
      if (!o.id || !o.input) throw new Error("--id and --input FILE|- are required");
      const text = o.input === "-" ? await deps.readStdin() : readFileSync(o.input, "utf8");
      if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new Error("input too large");
      const report = await registry.prepare(o.id, JSON.parse(text), context("operator-cli"));
      deps.print(report);
      return report.status === "ok" ? 0 : 2;
    }
    case "execute": {
      if (!o.token) throw new Error("--token is required (from a previous prepare)");
      const report = await registry.execute(o.token, context("operator-cli"));
      deps.print(report);
      return report.status === "ok" ? 0 : 2;
    }
    default:
      throw new Error(
        "actions list | describe --id ID | prepare --id ID --input FILE|- | execute --token T | mcp",
      );
  }
}

/**
 * Add SYNTHETIC Google and Microsoft demo accounts with fixture calendars (counting for
 * availability) to a state — for a separate demo/preview state used with `--provider-fixtures`.
 * The agent runtime cannot read provider calendars, so its applied availability stays blocked.
 */
export function addFixtureProviderCalendars(store: SettingsStore, at: string): Settings {
  const s = store.read();
  if (s.connections.some((c) => c.id === "demo-google-account"))
    throw new Error("the fixture provider calendars are already present");
  const account = (id: string, label: string, provider: string): Connection => ({
    id,
    label,
    channel: "email",
    provider,
    organisation: "Example Organisation (synthetic)",
    identifiers: [],
    origin: "demo",
    evidence: [],
    conflicts: [],
    localConnector: { state: "setup-required" },
    restrictions: {
      agentEnabled: true,
      read: false,
      triage: false,
      draft: false,
      hostedTriage: false,
    },
    notes: "Synthetic demo account for provider fixtures (no real provider).",
    updatedAt: at,
    updatedBy: "demo setup",
  });
  return store.update(
    s.revision,
    "demo setup",
    "Added fixture provider calendars",
    "Google and Microsoft fixture calendars (synthetic)",
    (d) => {
      d.connections.push(
        account("demo-google-account", "Demo Google account (fixture)", "gmail"),
        account("demo-microsoft-account", "Demo Microsoft account (fixture)", "microsoft_365"),
      );
      for (const f of FIXTURE_CALENDARS) {
        const id = `fixture-${f.provider}-${f.providerCalendarId === "primary" ? "primary" : "secondary"}`;
        d.calendars.push({
          id,
          label: f.label,
          kind: "external",
          provider: f.provider,
          connectionId: f.provider === "google" ? "demo-google-account" : "demo-microsoft-account",
          providerCalendarId: f.providerCalendarId,
          busy: [],
          enabled: true,
          permissions: { readAvailability: true, createBookings: false },
        });
        d.availability.authoritative.push(id);
      }
    },
  );
}
