// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { constants, createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { stderr as nodeStderr, stdout as nodeStdout } from "node:process";
import { Readable } from "node:stream";
import {
  BANK_CSV_FORMATS,
  type BankStatementOptions,
  createBankStatementsFileAdapter,
  MAX_BANK_ACCOUNT_LABEL_CHARS,
  validateBankOptions,
} from "../bank-statements/file-adapter.js";
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

const BANK_ID = "bank-statements";
const BANK_FORMATS = ["auto", ...BANK_CSV_FORMATS] as const;
const USAGE = `Usage: pod-connectors import <id> [--file <path>] [--since]
       pod-connectors import ${BANK_ID} --file <path> [--format <format>] [--account-label <text>]

Bank statement options (${BANK_ID} file imports only):
  --format <${BANK_FORMATS.join("|")}>
      CSV layout. Default auto detects it from the contents, including generic CSV and
      OFX/QFX; a bank format accepts only that bank's CSV (OFX/QFX is still read).
      Headerless HSBC UK exports need --format hsbc-uk.
  --account-label <text>
      A stable name for the account (visible text, at most ${MAX_BANK_ACCOUNT_LABEL_CHARS} characters).
      Required for hsbc-uk; give two accounts of the same bank different labels.
`;

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
  /** Validated bank-statements adapter options; present only when a bank flag was given. */
  bank?: BankStatementOptions;
} {
  const [command, id, ...flags] = args;
  if (command !== "import" || !id || !/^[a-z0-9-]+$/.test(id))
    throw new NodeRuntimeError("config", USAGE.trim());
  let file: string | undefined;
  let format: string | undefined;
  let accountLabel: string | undefined;
  let since = false;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    const value = flags[i + 1];
    const hasValue = !!value && !value.startsWith("--");
    if (flag === "--since" && !since) since = true;
    else if (flag === "--file" && file === undefined && hasValue) file = flags[++i];
    else if (flag === "--format" && format === undefined && hasValue) format = flags[++i];
    else if (flag === "--account-label" && accountLabel === undefined && hasValue)
      accountLabel = flags[++i];
    else throw new NodeRuntimeError("config", USAGE.trim());
  }
  if (file && since)
    throw new NodeRuntimeError("config", "--since is only supported for API imports.");
  if (format === undefined && accountLabel === undefined) return { id, file, since };
  if (id !== BANK_ID || !file)
    throw new NodeRuntimeError(
      "config",
      `--format and --account-label are only supported for ${BANK_ID} --file imports.`,
    );
  // Never echo the supplied values: an account label can be personal.
  if (format !== undefined && !(BANK_FORMATS as readonly string[]).includes(format))
    throw new NodeRuntimeError("config", `--format must be one of: ${BANK_FORMATS.join(", ")}.`);
  const bank: BankStatementOptions = {
    ...(format !== undefined &&
      format !== "auto" && { csvFormat: format as BankStatementOptions["csvFormat"] }),
    ...(accountLabel !== undefined && { accountLabel }),
  };
  if (bank.csvFormat === "hsbc-uk" && accountLabel === undefined)
    throw new NodeRuntimeError(
      "config",
      "--format hsbc-uk requires --account-label: HSBC UK exports do not name the account.",
    );
  try {
    // The adapter's own validation, so both surfaces accept exactly the same labels.
    validateBankOptions(bank);
  } catch {
    throw new NodeRuntimeError(
      "config",
      `--account-label must contain visible text and at most ${MAX_BANK_ACCOUNT_LABEL_CHARS} characters.`,
    );
  }
  return { id, file, since, bank };
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
    const adapter = registry.adapterById(command.id);
    const fileAdapter = command.bank
      ? createBankStatementsFileAdapter(command.bank)
      : fileAdapterById(command.id);
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
        return transport(input, {
          ...init,
          signal:
            options.signal && init?.signal
              ? AbortSignal.any([options.signal, init.signal])
              : (options.signal ?? init?.signal),
        });
      };
    const podFetch = await createClientCredentialsFetch(
      config,
      withSignal(options.podTransport ?? globalThis.fetch),
    );
    const stateStore = createStateStore({ ...config, adapterId: command.id, fetch: podFetch });
    const previous = await stateStore.read();
    const podWriter = createFetchPodWriter({
      ...config,
      adapterId: command.id,
      fetch: podFetch,
      ...(options.signal && { signal: options.signal }),
    });
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
      ...(options.signal && { signal: options.signal }),
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
