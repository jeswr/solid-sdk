// AUTHORED-BY Codex GPT-6
import { connectionsForResource } from "../../state/connectors";
import type { Connections } from "./connection-state";

/** Home may pass its useConnectors snapshot for reactive badges. The one-argument
 * form also works before Connect mounts, using the saved connection records. */
export function isDemoImport(
  url: string,
  connections: Connections = connectionsForResource(url),
): boolean {
  const document = url.slice(0, url.indexOf("#") < 0 ? url.length : url.indexOf("#"));
  return Object.values(connections).some(
    (connection) => connection.mode === "demo" && connection.resourceUrls.includes(document),
  );
}
