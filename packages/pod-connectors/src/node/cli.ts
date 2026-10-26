// AUTHORED-BY Codex GPT-6.1-Sol
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { stderr as nodeStderr, stdout as nodeStdout } from "node:process";
import {
  type FileImportAdapter,
  type ImportFile,
  MAX_FILE_BYTES,
  runFileImport,
} from "../core/file-import.js";
import { createSourceAuth, runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import type { ConnectorState, SourceAuth } from "../core/types.js";
import { fileAdapterById } from "../file-adapters.js";
import { createRegistry } from "../registry.js";
import { readNodeConfig } from "./config.js";
import { NodeRuntimeError } from "./errors.js";
import { authorizeLoopback } from "./loopback.js";
import { createClientCredentialsFetch } from "./pod-auth.js";
import { createStateStore } from "./state.js";

const USAGE = "Usage: pod-connectors import <id> [--file <path>] [--since]\n";

/** Stable process exit codes; library users receive the code without terminating their host. */
export const EXIT_CODES = { success: 0, import: 1, config: 2, auth: 3, cancelled: 130 } as const;

/** Injectable Node host ports. Fixture SourceAuth bypasses interactive source login only. */
export interface CliOptions {
  readonly configPath?: string;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
  readonly podTransport?: typeof fetch;
  readonly sourceTransport?: typeof fetch;
  readonly sourceAuth?: SourceAuth;
  readonly openAuthorizationUrl?: (url: string) => void | Promise<void>;
  readonly signal?: AbortSignal;
}

/** Parse the deliberately small D7 command surface without accepting unknown flags. */
export function parseImportArgs(args: readonly string[]): {
  id: string;
  file?: string;
  since: boolean;
} {
  const [command, id, ...flags] = args;
  if (command !== "import" || !id || !/^[a-z0-9-]+$/.test(id))
    throw new NodeRuntimeError("config", USAGE.trim());
  let file: string | undefined;
  let since = false;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === "--since" && !since) since = true;
    else if (flag === "--file" && !file && flags[i + 1] && !flags[i + 1]?.startsWith("--"))
      file = flags[++i];
    else throw new NodeRuntimeError("config", USAGE.trim());
  }
  if (file && since)
    throw new NodeRuntimeError("config", "--since is only supported for API imports.");
  return { id, file, since };
}

async function importFile(path: string, adapter: FileImportAdapter): Promise<ImportFile> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("Invalid file");
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
    const adapter = registry.adapterById(command.id);
    const fileAdapter = fileAdapterById(command.id);
    if ((command.file && !fileAdapter) || (!command.file && !adapter))
      throw new NodeRuntimeError(
        "config",
        "Unknown connector or unsupported import mode; file connectors require --file.",
      );
    const file = command.file
      ? await importFile(command.file, fileAdapter as FileImportAdapter)
      : undefined;
    const withSignal =
      (transport: typeof fetch): typeof fetch =>
      (input, init) =>
        transport(input, {
          ...init,
          signal:
            options.signal && init?.signal
              ? AbortSignal.any([options.signal, init.signal])
              : (options.signal ?? init?.signal),
        });
    const podFetch = await createClientCredentialsFetch(
      config,
      withSignal(options.podTransport ?? globalThis.fetch),
    );
    const stateStore = createStateStore({ ...config, adapterId: command.id, fetch: podFetch });
    const previous = await stateStore.read();
    const podWriter = createFetchPodWriter({ ...config, adapterId: command.id, fetch: podFetch });
    let sourceAuth = options.sourceAuth;
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
    let next: ConnectorState | undefined;
    const state = previous && !command.since ? { ...previous, cursor: undefined } : previous;
    const shared = {
      podWriter,
      state,
      onState: (state: ConnectorState) => {
        next = state;
      },
    };
    try {
      if (file) await runFileImport({ ...shared, adapter: fileAdapter as FileImportAdapter, file });
      else
        await runImport({
          ...shared,
          adapter: adapter as NonNullable<typeof adapter>,
          mode: "live",
          sourceAuth,
        });
    } catch {
      if (next) {
        // A full import still preserves the last successful checkpoint on failure.
        await stateStore.write(previous ? { ...previous, lastOutcome: "error" } : next);
      }
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
    return EXIT_CODES.success;
  } catch (error) {
    const failure = options.signal?.aborted
      ? new NodeRuntimeError("cancelled", "Import cancelled.")
      : error instanceof NodeRuntimeError
        ? error
        : new NodeRuntimeError("import", "Import failed.");
    stderr(`${failure.message}\n`);
    return EXIT_CODES[failure.kind];
  }
}
