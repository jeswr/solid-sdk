// AUTHORED-BY Codex GPT-6.1-Sol
import type { AgentClient } from "./client";
import { type Collection, collection, isComplete, mapBounded } from "./collections";
import { type DisplayControl, newest, readControl } from "./readers";
import type { AgentVerifier } from "./verify";

/** Archive controls live in the UTC month of their creation time. */
export function archivePartition(client: AgentClient, at: Date): string {
  return `${client.paths.archive}${at.toISOString().slice(0, 7)}/`;
}

/** Cover the 365-day lifetime with a day's margin, plus legacy flat controls. */
export function archiveContainers(client: AgentClient, now: Date): string[] {
  const first = new Date(now.getTime() - 366 * 86400000);
  first.setUTCDate(1);
  first.setUTCHours(0, 0, 0, 0);
  const at = new Date(now);
  at.setUTCDate(1);
  at.setUTCHours(0, 0, 0, 0);
  const containers: string[] = [];
  for (; at >= first; at.setUTCMonth(at.getUTCMonth() - 1))
    containers.push(archivePartition(client, at));
  return [...containers, client.paths.archive];
}

export async function readArchive(
  client: AgentClient,
  verifier: AgentVerifier,
  now: Date,
): Promise<Collection<DisplayControl>> {
  const sources = await mapBounded(archiveContainers(client, now), (container) =>
    readControl(client, verifier, container),
  );
  return collection(newest(sources.flat()), {
    complete: sources.every(isComplete),
    total: sources.reduce((total, rows) => total + rows.total, 0),
    incompleteMessage: "Too many control records to check",
  });
}
