// AUTHORED-BY Codex GPT-6
import {
  createFetchPodWriter,
  type ImportFile,
  type ImportReport,
  type NormalisedDoc,
  type PodWriter,
} from "@jeswr/pod-connectors";
import { Store } from "n3";
import type { PodSession } from "../../../../lib/session/pod-session";
import type {
  ConnectionAction,
  ConnectionMode,
  ConnectorConnection,
} from "../../lib/connect/connection-state";
import { withConnectorLock } from "../../lib/connect/import-lock";

/** Read the current checkpoint only after acquiring the reservation, and persist
 * every outcome before releasing it. update must read durable state, not React state. */
export function runSavedImport(
  storage: string,
  id: string,
  mode: ConnectionMode,
  signal: AbortSignal,
  update: (action: ConnectionAction) => ConnectorConnection,
  run: (cursor: string | undefined, connection: ConnectorConnection) => Promise<ImportReport>,
): Promise<ImportReport> {
  return withConnectorLock(storage, id, signal, async () => {
    const connection = update({ type: "start", at: new Date().toISOString(), mode });
    try {
      const result = await run(mode === "live" ? connection.cursor : undefined, connection);
      signal.throwIfAborted();
      update({
        type: "success",
        at: new Date().toISOString(),
        added: result.state?.counts.items ?? result.written.length,
        skipped: result.skipped ?? 0,
        cursor: result.cursor,
      });
      return result;
    } catch (error) {
      update({ type: signal.aborted ? "incomplete" : "error" });
      throw error;
    }
  });
}

export function fetchWithSignal(transport: typeof fetch, signal: AbortSignal): typeof fetch {
  return (input, init) => {
    signal.throwIfAborted();
    const signals = [signal];
    if (input instanceof Request) signals.push(input.signal);
    if (init?.signal) signals.push(init.signal);
    return transport(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

function streamWithSignal(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let stop: () => void;
  const cleanup = () => signal.removeEventListener("abort", stop);
  return new ReadableStream({
    start(controller) {
      stop = () => {
        controller.error(signal.reason);
        void reader.cancel(signal.reason).catch(() => {});
        cleanup();
      };
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    },
    async pull(controller) {
      try {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) {
          cleanup();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    cancel(reason) {
      cleanup();
      return reader.cancel(reason);
    },
  });
}

/** Native file/range streams also abort, including a reader waiting for bytes. */
export function fileWithSignal(file: File, signal: AbortSignal): ImportFile {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    text: async () => {
      signal.throwIfAborted();
      const text = await file.text();
      signal.throwIfAborted();
      return text;
    },
    stream: () => streamWithSignal(file.stream(), signal),
    slice: (start, end) => ({
      stream: () => streamWithSignal(file.slice(start, end).stream(), signal),
    }),
  };
}

/** The same package writer is used by the UI and demo-pod integration tests.
 * Cancellation reaches source requests, document writes and registration. */
export function createImportWriter(
  session: Pick<PodSession, "webId" | "storageUrl" | "fetch">,
  adapterId: string,
  signal: AbortSignal,
  onWrite: (url: string, doc: NormalisedDoc) => void = () => {},
  demoResourceUrls: readonly string[] = [],
): PodWriter {
  const demos = new Set(demoResourceUrls);
  const profile = new URL(session.webId);
  profile.hash = "";
  const writer = createFetchPodWriter({
    adapterId,
    webId: session.webId,
    profileDocumentUrl: profile.href,
    podRoot: session.storageUrl,
    fetch: fetchWithSignal(session.fetch, signal),
  });
  return {
    ...writer,
    async read(slug) {
      const stored = await writer.read(slug);
      // Keep the ETag for replacement, but never merge demo subjects into live data.
      return stored && demos.has(writer.resolve(slug))
        ? { ...stored, dataset: new Store() }
        : stored;
    },
    async write(doc, conditions) {
      signal.throwIfAborted();
      const result = await writer.write(doc, conditions);
      demos.delete(result.url);
      onWrite(result.url, doc);
      return result;
    },
  };
}
