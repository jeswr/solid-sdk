// AUTHORED-BY Codex GPT-6.1-Sol
import { readContainerMembers } from "@jeswr/ldp-container";
import {
  type ConnectionRecord,
  connectionsContainer,
  MAX_CONNECTION_BYTES,
  parseConnectionRecord,
  revokeConnectionRecord,
} from "@jeswr/mcp-connections";
import type { PodSession } from "@/lib/session/types";
import { readDocument } from "./read";

export interface AssistantConnection {
  url: string;
  record: ConnectionRecord;
}
export const connectionName = (record: ConnectionRecord) =>
  record.title?.trim() || new URL(record.client).host;
export function connectionStatus(record: ConnectionRecord, now = Date.now()) {
  if (record.revokedAt) return `Disconnected on ${record.revokedAt.toISOString().slice(0, 10)}`;
  return record.expiresAt.getTime() <= now ? "Expired" : "Active";
}
function recordUrl(session: PodSession, url: string) {
  const container = connectionsContainer(session.storageUrl);
  if (!url.startsWith(container) || !/^[a-f0-9]{32}\.ttl$/.test(url.slice(container.length)))
    throw new Error("Invalid connection location");
  return url;
}
export async function listConnections(session: PodSession, signal: AbortSignal) {
  const container = connectionsContainer(session.storageUrl);
  const fetcher: typeof fetch = async () => {
    try {
      const result = await readDocument(session, container, signal);
      return new Response(result.text, { headers: { "content-type": result.contentType } });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        (error.status === 404 || error.status === 410)
      )
        return new Response(null, { status: error.status });
      throw error;
    }
  };
  const members = await readContainerMembers(fetcher, container, {
    scope: session.storageUrl,
    signal,
    maxBytes: 256 * 1024,
    maxQuads: 10000,
  });
  const urls = (members ?? [])
    .map((member) => member.url)
    .filter((url) => {
      try {
        recordUrl(session, url);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
  const rows: AssistantConnection[] = [];
  let unreadable = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (next < Math.min(100, urls.length)) {
        const url = urls[next++] as string;
        try {
          const result = await readDocument(session, url, signal, MAX_CONNECTION_BYTES);
          rows.push({
            url,
            record: await parseConnectionRecord(result.text, result.contentType, url),
          });
        } catch {
          signal.throwIfAborted();
          unreadable++;
        }
      }
    }),
  );
  signal.throwIfAborted();
  rows.sort(
    (a, b) =>
      (b.record.lastUsed ?? b.record.created).getTime() -
        (a.record.lastUsed ?? a.record.created).getTime() || a.url.localeCompare(b.url),
  );
  return { rows, unreadable, truncated: urls.length > 100 };
}
/** Read-modify-write the owner's record, reapplying to fresh bytes once on a conflict. */
export async function disconnectConnection(
  session: PodSession,
  url: string,
  signal: AbortSignal,
  at = new Date(),
) {
  try {
    recordUrl(session, url);
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const current = await readDocument(session, url, signal, MAX_CONNECTION_BYTES);
      const record = await parseConnectionRecord(current.text, current.contentType, url);
      if (record.revokedAt) return;
      if (!current.etag || !/^"[^"\r\n]+"(?![\s\S])/.test(current.etag)) throw new Error();
      const body = await revokeConnectionRecord(current.text, current.contentType, url, at);
      signal.throwIfAborted();
      const response = await session.fetch(url, {
        method: "PUT",
        redirect: "error",
        signal,
        headers: { "content-type": "text/turtle", "if-match": current.etag },
        body,
      });
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
      if (response.redirected || (response.url && response.url !== url)) throw new Error();
      if (response.ok) return;
      if (response.status !== 412) throw new Error();
    }
    throw new Error();
  } catch {
    throw new Error("Couldn't disconnect. Try again.");
  }
}
