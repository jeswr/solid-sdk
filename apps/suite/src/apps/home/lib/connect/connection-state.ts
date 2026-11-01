// AUTHORED-BY Codex GPT-6
export type ConnectionMode = "demo" | "live" | "file";
export interface ConnectorConnection {
  connectedAt: string;
  lastSync?: string | undefined;
  cursor?: string | undefined;
  lastOutcome: "ok" | "incomplete" | "error";
  added: number;
  skipped: number;
  mode: ConnectionMode;
  /** Live/file resources and demo resources are disjoint. Optional for v1 records. */
  resourceUrls: string[];
  demoResourceUrls?: string[] | undefined;
}
export type Connections = Readonly<Record<string, ConnectorConnection>>;
export type ConnectionAction =
  | { type: "start"; at: string; mode: ConnectionMode }
  | { type: "written"; url: string }
  | { type: "success"; at: string; added: number; skipped: number; cursor?: string | undefined }
  | { type: "incomplete" | "error" };

export function demoResources(connection: ConnectorConnection): readonly string[] {
  return connection.demoResourceUrls ?? (connection.mode === "demo" ? connection.resourceUrls : []);
}

/** Failed/cancelled runs keep the last successful checkpoint. Start is durable
 * before any writes, so a closed tab leaves an honest incomplete outcome. */
export function connectionReducer(
  current: ConnectorConnection | undefined,
  action: ConnectionAction,
): ConnectorConnection {
  if (action.type === "start")
    return {
      connectedAt: current?.connectedAt ?? action.at,
      lastSync: current?.lastSync,
      cursor: current?.mode === action.mode ? current.cursor : undefined,
      added: current?.added ?? 0,
      skipped: current?.skipped ?? 0,
      resourceUrls:
        current?.mode === "demo" && current.demoResourceUrls === undefined
          ? []
          : (current?.resourceUrls ?? []),
      demoResourceUrls: current ? [...demoResources(current)] : [],
      mode: action.mode,
      lastOutcome: "incomplete",
    };
  if (!current) throw new Error("Start a connection before updating it.");
  if (action.type === "written")
    return {
      ...current,
      resourceUrls:
        current.mode === "demo"
          ? current.resourceUrls.filter((url) => url !== action.url)
          : [...new Set([...current.resourceUrls, action.url])],
      demoResourceUrls:
        current.mode === "demo"
          ? [...new Set([...demoResources(current), action.url])]
          : demoResources(current).filter((url) => url !== action.url),
    };
  if (action.type === "success")
    return {
      ...current,
      lastOutcome: "ok",
      lastSync: action.at,
      added: action.added,
      skipped: action.skipped,
      cursor: action.cursor,
    };
  return { ...current, lastOutcome: action.type };
}
