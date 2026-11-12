// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { constants, createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { stderr as nodeStderr, stdout as nodeStdout } from "node:process";
import { Readable } from "node:stream";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  type FileImportAdapter,
  type ImportFile,
  MAX_FILE_BYTES,
  runFileImport,
} from "../core/file-import.js";
import { createSourceAuth, runImport } from "../core/import-runner.js";
import { adapterContainer } from "../core/pod-writer-policy.js";
import { createStoragePodWriter } from "../core/storage-pod-writer.js";
import type { ConnectorState, SourceAuth } from "../core/types.js";
import { fileAdapterById } from "../file-adapters.js";
import { createRegistry } from "../registry.js";
import { createVeSyncAdapter } from "../vesync/adapter.js";
import { REQUEST_TIMEOUT_MS } from "../vesync/api.js";
import { VeSyncAuthError } from "../vesync/errors.js";
import { readNodeConfig } from "./config.js";
import { NodeRuntimeError } from "./errors.js";
import { authorizeLoopback } from "./loopback.js";
import { createClientCredentialsFetch } from "./pod-auth.js";
import { createStateStore } from "./state.js";
import {
  createVeSyncSourceAuth,
  readVeSyncCredentials,
  type VeSyncCredentials,
} from "./vesync-auth.js";
import { classifyVeSyncFailure, VeSyncRunFailure } from "./vesync-failure.js";
import { type delay, watchImports } from "./watch.js";

const USAGE =
  "Usage: pod-connectors import <id> [--file <path>] [--since] [--watch [minutes]] [--room <label> | --room <sensor-slug>=<label>]\n";

/** Stable process exit codes; library users receive the code without terminating their host. */
export const EXIT_CODES = { success: 0, import: 1, config: 2, auth: 3, cancelled: 130 } as const;

/** Injectable Node host ports. Fixture SourceAuth bypasses interactive source login only. */
export interface CliOptions {
  readonly configPath?: string;
  /** Node-only account port; returns an MD5 hash, never plaintext. */
  readonly vesyncCredentials?: () => Promise<VeSyncCredentials>;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
  readonly podTransport?: typeof fetch;
  readonly sourceTransport?: typeof fetch;
  readonly sourceAuth?: SourceAuth;
  readonly openAuthorizationUrl?: (url: string) => void | Promise<void>;
  readonly signal?: AbortSignal;
  /** Fixture seams for `--watch` and VeSync retry delays (abortable sleep, jitter source). */
  readonly sleep?: typeof delay;
  readonly random?: () => number;
}

/** Parse the deliberately small D7 command surface without accepting unknown flags. */
export function parseImportArgs(args: readonly string[]): {
  id: string;
  file?: string;
  since: boolean;
  watch?: number;
  room?: string | Readonly<Record<string, string>>;
} {
  const [command, id, ...flags] = args;
  if (command !== "import" || !id || !/^[a-z0-9-]+$/.test(id))
    throw new NodeRuntimeError("config", USAGE.trim());
  let file: string | undefined;
  let since = false;
  let watch: number | undefined;
  let room: string | undefined;
  const rooms: Record<string, string> = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === "--watch" && watch === undefined) {
      const next = flags[i + 1];
      watch = next && !next.startsWith("--") ? Number(flags[++i]) : 10;
      if (!Number.isFinite(watch) || watch < 5 || watch > 1440)
        throw new NodeRuntimeError("config", "--watch minutes must be between 5 and 1440.");
    } else if (flag === "--room" && flags[i + 1] && !flags[i + 1]?.startsWith("--")) {
      const label = flags[++i] as string;
      const match = /^(vesync-[a-f0-9]{64})=(.*)$/.exec(label);
      if (
        label.length > 400 ||
        Array.from(label).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
        !label.trim()
      )
        throw new NodeRuntimeError("config", "Invalid room label.");
      if (
        match?.[2] &&
        match[2].length <= 256 &&
        match[2].trim() &&
        !room &&
        !rooms[match[1] as string]
      )
        rooms[match[1] as string] = match[2] as string;
      else if (!match && !room && !Object.keys(rooms).length && label.length <= 256) room = label;
      else
        throw new NodeRuntimeError(
          "config",
          "Use one room label or distinct sensor-slug=label mappings.",
        );
    } else if (flag === "--since" && !since) since = true;
    else if (flag === "--file" && !file && flags[i + 1] && !flags[i + 1]?.startsWith("--"))
      file = flags[++i];
    else throw new NodeRuntimeError("config", USAGE.trim());
  }
  if (file && since)
    throw new NodeRuntimeError("config", "--since is only supported for API imports.");
  if (
    (watch !== undefined || room !== undefined || Object.keys(rooms).length) &&
    (id !== "vesync" || file || since)
  )
    throw new NodeRuntimeError(
      "config",
      "--watch and --room require a VeSync API import without --since.",
    );
  return {
    id,
    file,
    since,
    ...(watch !== undefined ? { watch } : {}),
    ...(room !== undefined ? { room } : Object.keys(rooms).length ? { room: rooms } : {}),
  };
}

export async function importFile(path: string, adapter: FileImportAdapter): Promise<ImportFile> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (!adapter.streaming && stat.size > MAX_FILE_BYTES))
        throw new Error("Invalid file");
      if (adapter.streaming) {
        const stream = (start = 0, end = stat.size) => {
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            end < start ||
            end > stat.size
          )
            throw new Error("Invalid file range");
          if (start === end)
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          return Readable.toWeb(
            createReadStream(path, { start, end: end - 1, highWaterMark: 64 * 1024 }),
          ) as ReadableStream<Uint8Array>;
        };
        return {
          name: basename(path),
          type: "",
          size: stat.size,
          stream: () => stream(),
          slice: (start, end) => ({ stream: () => stream(start, end) }),
          async text() {
            if (stat.size > MAX_FILE_BYTES) throw new Error("File exceeds text limit");
            const reader = stream().getReader();
            let size = 0;
            const parts: Buffer[] = [];
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > MAX_FILE_BYTES) throw new Error("File grew past limit");
                parts.push(Buffer.from(value));
              }
            } finally {
              await reader.cancel();
              reader.releaseLock();
            }
            return Buffer.concat(parts).toString("utf8");
          },
        };
      }
      const bytes = await file.readFile();
      if (bytes.length > MAX_FILE_BYTES) throw new Error("File grew past limit");
      return {
        name: basename(path),
        type: "",
        size: bytes.length,
        text: async () => bytes.toString("utf8"),
      };
    } finally {
      await file.close();
    }
  } catch {
    throw new NodeRuntimeError(
      "config",
      `Cannot read export file for ${adapter.metadata.id} within the file size limit.`,
    );
  }
}

/** Execute one import, persisting successful or failed outcomes without printing arbitrary errors. */
export async function runCli(args: readonly string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((message) => nodeStdout.write(message));
  const stderr = options.stderr ?? ((message) => nodeStderr.write(message));
  if (args.length === 1 && args[0] === "--help") {
    stdout(USAGE);
    return EXIT_CODES.success;
  }
  try {
    options.signal?.throwIfAborted();
    const command = parseImportArgs(args);
    const config = await readNodeConfig(options.configPath);
    const registry = createRegistry(config.connectors);
    const adapter =
      command.id === "vesync"
        ? createVeSyncAdapter({ room: command.room })
        : registry.adapterById(command.id);
    const fileAdapter = fileAdapterById(command.id);
    if ((command.file && !fileAdapter) || (!command.file && !adapter))
      throw new NodeRuntimeError(
        "config",
        "Unknown connector or unsupported import mode; file connectors require --file.",
      );
    const file = command.file
      ? await importFile(command.file, fileAdapter as FileImportAdapter)
      : undefined;
    // Every Pod and source request, including checkpoint reads/writes and the import's own
    // Pod writes, refuses to send once the command is cancelled.
    const withSignal =
      (transport: typeof fetch): typeof fetch =>
      async (input, init) => {
        options.signal?.throwIfAborted();
        const effectiveSignal =
          init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const signals = [
          ...new Set([
            ...(options.signal ? [options.signal] : []),
            ...(effectiveSignal ? [effectiveSignal] : []),
            ...(command.id === "vesync" ? [AbortSignal.timeout(REQUEST_TIMEOUT_MS)] : []),
          ]),
        ];
        return transport(input, {
          ...init,
          signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
        });
      };
    const podFetch = await createClientCredentialsFetch(
      config,
      withSignal(options.podTransport ?? globalThis.fetch),
    );
    const stateStore = createStateStore({ ...config, adapterId: command.id, fetch: podFetch });
    let previous = await stateStore.read();
    const storage = createSolidBackend({ fetch: podFetch, root: config.podRoot });
    const podWriter = createStoragePodWriter({
      storage,
      container: adapterContainer(command.id, config.podRoot),
      webId: config.webId,
      typeIndex: {
        profileDocumentUrl: config.profileDocumentUrl,
        storageFor: (url) =>
          createSolidBackend({ fetch: podFetch, root: `${new URL(url).origin}/` }),
      },
      ...(options.signal && { signal: options.signal }),
    });
    let sourceAuth = options.sourceAuth;
    if (command.id === "vesync" && !sourceAuth) {
      const credentials = await (options.vesyncCredentials?.() ??
        readVeSyncCredentials(options.signal));
      sourceAuth = createVeSyncSourceAuth({
        credentials,
        transport: withSignal(options.sourceTransport ?? globalThis.fetch),
        signal: options.signal,
        ...(options.sleep && { sleep: options.sleep }),
        ...(options.random && { random: options.random }),
      });
    }
    if (!file && !sourceAuth) {
      if (!adapter?.oauth)
        throw new NodeRuntimeError("auth", "This connector has no source OAuth configuration.");
      const sourceFetch = withSignal(options.sourceTransport ?? globalThis.fetch);
      const sourceConfig = { ...adapter.oauth, ...config.connectors[command.id] };
      const token = await authorizeLoopback(command.id, sourceConfig, sourceFetch, {
        openAuthorizationUrl:
          options.openAuthorizationUrl ??
          ((url) => stderr(`Open this URL to connect the source:\n${url}\n`)),
        signal: options.signal,
      });
      sourceAuth =
        adapter.createSourceAuth?.(sourceConfig, token, sourceFetch) ??
        createSourceAuth(command.id, adapter, token, sourceFetch);
    }
    const execute = async () => {
      let next: ConnectorState | undefined;
      const state = previous && !command.since ? { ...previous, cursor: undefined } : previous;
      const shared = {
        podWriter,
        ...(command.id === "vesync"
          ? { onProgress: (progress: { label: string }) => stderr(`${progress.label}\n`) }
          : {}),
        state,
        onState: (state: ConnectorState) => {
          next = state;
        },
        ...(options.signal && { signal: options.signal }),
      };
      try {
        if (file)
          await runFileImport({ ...shared, adapter: fileAdapter as FileImportAdapter, file });
        else
          await runImport({
            ...shared,
            adapter: adapter as NonNullable<typeof adapter>,
            mode: "live",
            sourceAuth,
          });
      } catch (error) {
        if (command.id === "vesync" && !options.signal?.aborted) {
          // Classify by cause; a failed checkpoint write only matters if the run was retryable.
          let failure = classifyVeSyncFailure(error);
          if (next)
            try {
              await stateStore.write(previous ? { ...previous, lastOutcome: "error" } : next);
            } catch (stateError) {
              if (failure.retry) failure = classifyVeSyncFailure(stateError);
            }
          throw failure;
        }
        if (next) {
          // A full import still preserves the last successful checkpoint on failure.
          await stateStore.write(previous ? { ...previous, lastOutcome: "error" } : next);
        }
        if (error instanceof VeSyncAuthError) throw new NodeRuntimeError("auth", error.message);
        throw new NodeRuntimeError(
          "import",
          "Import failed; the last successful checkpoint was retained.",
        );
      }
      if (!next) throw new NodeRuntimeError("import", "Import did not return connector state.");
      await stateStore.write(next);
      stdout(
        `Imported ${command.id}: ${next.counts.documents} documents, ${next.counts.items} items, ${next.counts.skipped} skipped.\n`,
      );
    };
    if (command.watch !== undefined) {
      let first = true;
      await watchImports({
        minutes: command.watch,
        signal: options.signal,
        run: async () => {
          try {
            if (!first) previous = await stateStore.read();
            first = false;
            await execute();
          } catch (error) {
            // State rereads and checkpoint writes are classified like import failures.
            throw options.signal?.aborted ? error : classifyVeSyncFailure(error);
          }
        },
        retry: (error) => error instanceof VeSyncRunFailure && error.retry,
        onError: (error) =>
          stderr(
            `${error instanceof NodeRuntimeError ? error.message : "Import failed."} Retrying with backoff.\n`,
          ),
        ...(options.sleep && { sleep: options.sleep }),
        ...(options.random && { random: options.random }),
      });
    } else await execute();
    return EXIT_CODES.success;
  } catch (error) {
    const failure = options.signal?.aborted
      ? new NodeRuntimeError("cancelled", "Import cancelled.")
      : error instanceof VeSyncAuthError
        ? new NodeRuntimeError("auth", error.message)
        : error instanceof NodeRuntimeError
          ? error
          : new NodeRuntimeError("import", "Import failed.");
    stderr(`${failure.message}\n`);
    return EXIT_CODES[failure.kind];
  }
}
