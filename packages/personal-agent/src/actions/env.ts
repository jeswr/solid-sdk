/**
 * The environment the personal-agent actions run in. Built by the caller (CLI, MCP server,
 * dashboard server) from TRUSTED operator configuration only: the owner's settings snapshot, the
 * dashboard's own agents directory, the provider environment. Nothing here comes from a request.
 */
import type { Settings } from "../dashboard/model.js";
import type { ProviderEnvironment } from "./providers/common.js";
import type { ActionContext } from "./types.js";

export interface ActionsEnv {
  /** Owner settings (read-only snapshot for this invocation). */
  settings: Settings;
  /** Trusted agents directory (operator configuration, never a browser path). */
  agentsDir: string;
  /** Trusted dashboard state directory (outbound files of executed actions go under it). */
  stateDir: string;
  providers: ProviderEnvironment;
  /** Connection ids that have a provider credential configured (no secrets). */
  configuredConnections: readonly string[];
  /** Wall-clock budget for all provider reads of one availability computation (default 30 s). */
  readBudgetMs?: number;
}

export type Ctx = ActionContext<ActionsEnv>;

export const isoOf = (d: Date) => d.toISOString();
