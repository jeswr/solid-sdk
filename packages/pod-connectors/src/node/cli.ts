// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5

import { constants, createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { env as nodeEnv, stderr as nodeStderr, stdout as nodeStdout } from "node:process";
import { Readable } from "node:stream";
import { accessModel } from "@jeswr/pod-access/requests-solid";
import type { StorageClient } from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import {
  BANK_CSV_FORMATS,
  type BankStatementOptions,
  createBankStatementsFileAdapter,
  MAX_BANK_ACCOUNT_LABEL_CHARS,
  validateBankOptions,
} from "../bank-statements/file-adapter.js";
import {
  IntegrationAuthError,
  PrivateDestinationError,
  UnreadableCredentialError,
} from "../core/errors.js";
import {
  type FileImportAdapter,
  type ImportFile,
  MAX_FILE_BYTES,
  runFileImport,
} from "../core/file-import.js";
import { createSourceAuth, runImport } from "../core/import-runner.js";
import { createOAuthSourceAuth, getOAuthToken, TOKEN_REQUEST_TIMEOUT_MS } from "../core/oauth.js";
import {
  adapterContainer,
  requirePrivateDestination,
  requiresPrivateDestination,
} from "../core/pod-writer-policy.js";
import { createOwnerOnlyDestinationVerifier } from "../core/private-destination.js";
import { createStoragePodWriter, createWacImportStorage } from "../core/storage-pod-writer.js";
import type { ConnectorState, SourceAuth, TokenSet } from "../core/types.js";
import { fileAdapterById } from "../file-adapters.js";
import { createRegistry } from "../registry.js";
import { ConnectorTokenVault, importVaultKey } from "../vault.js";
import { createVeSyncAdapter } from "../vesync/adapter.js";
import { REQUEST_TIMEOUT_MS } from "../vesync/api.js";
import { VeSyncAuthError } from "../vesync/errors.js";
import { readNodeConfig } from "./config.js";
import { NodeRuntimeError } from "./errors.js";
import { authorizeLoopback } from "./loopback.js";
import { createClientCredentialsFetch } from "./pod-auth.js";
import { type CliConnectorState, createStateStore } from "./state.js";
import { FileVaultStore } from "./vault-store.js";
import {
  createVeSyncSourceAuth,
  readVeSyncCredentials,
  type VeSyncCredentials,
} from "./vesync-auth.js";
import { classifyVeSyncFailure, VeSyncRunFailure } from "./vesync-failure.js";
import { type delay, watchImports } from "./watch.js";

const BANK_ID = "bank-statements";
const BANK_FORMATS = ["auto", ...BANK_CSV_FORMATS] as const;
const USAGE = `Usage: pod-connectors import <id> [--file <path>] [--since] [--vault <dir>] [--watch [minutes]] [--room <label> | --room <sensor-slug>=<label>]
       pod-connectors import ${BANK_ID} --file <path> [--format <format>] [--account-label <text>]

Refresh credentials are encrypted only with --vault and CONNECTOR_VAULT_KEY (canonical base64, 32 bytes).

Bank statement options (${BANK_ID} file imports only):
  --format <${BANK_FORMATS.join("|")}>
      CSV layout. Default auto detects it from the contents, including generic CSV and
      OFX/QFX; a bank format accepts only that bank's CSV (OFX/QFX is still read).
      Headerless HSBC UK exports need --format hsbc-uk.
  --account-label <text>
      A stable name for the account: visible text, at most ${MAX_BANK_ACCOUNT_LABEL_CHARS} characters
      (code points) after control and format characters are removed and it is trimmed.
      Required for hsbc-uk. Only Revolut, HSBC UK, Monzo and Starling CSV exports use it:
      give two accounts of the same bank different labels there. OFX/QFX and generic CSV
      ignore it (the import reports this) and replace one shared document.

Give each value as its own argument: --flag=value and values starting with -- are rejected.
`;

/** Stable process exit codes; library users receive the code without terminating their host. */
export const EXIT_CODES = { success: 0, import: 1, config: 2, auth: 3, cancelled: 130 } as const;

/** Injectable Node host ports. Fixture SourceAuth bypasses interactive source login only. */
export interface CliOptions {
  readonly configPath?: string;
  /** Node-only account port; returns an MD5 hash, never plaintext. */
  readonly vesyncCredentials?: () => Promise<VeSyncCredentials>;
  /** Defaults to CONNECTOR_VAULT_KEY in the Node CLI host only. */
  readonly vaultKey?: string;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
  readonly podTransport?: typeof fetch;
  /** Override the default owner-only destination verifier. */
  readonly verifyPrivateDestination?: (options: {
    url: string;
    storage: StorageClient;
    fetch: typeof fetch;
    ownerWebId: string;
    signal?: AbortSignal;
  }) => Promise<boolean>;
  readonly sourceTransport?: typeof fetch;
  readonly sourceAuth?: SourceAuth;
  readonly openAuthorizationUrl?: (url: string) => void | Promise<void>;
  /**
   * Defaults to true. False never starts loopback login: a missing or unreadable refresh
   * credential exits with the auth code (3) and a reconnect message instead.
   */
  readonly interactiveLogin?: boolean;
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
  vault?: string;
  watch?: number;
  room?: string | Readonly<Record<string, string>>;
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
  let vault: string | undefined;
  let watch: number | undefined;
  let room: string | undefined;
  const rooms: Record<string, string> = {};
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    const value = flags[i + 1];
    const hasValue = !!value && !value.startsWith("--");
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
    else if (flag === "--file" && file === undefined && hasValue) file = flags[++i];
    else if (flag === "--vault" && vault === undefined && hasValue) vault = flags[++i];
    else if (flag === "--format" && format === undefined && hasValue) format = flags[++i];
    else if (flag === "--account-label" && accountLabel === undefined && hasValue)
      accountLabel = flags[++i];
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
  const result = {
    id,
    file,
    since,
    ...(vault !== undefined ? { vault } : {}),
    ...(watch !== undefined ? { watch } : {}),
    ...(room !== undefined ? { room } : Object.keys(rooms).length ? { room: rooms } : {}),
  };
  if (format === undefined && accountLabel === undefined) return result;
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
  return { ...result, bank };
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Split a checkpoint into its API and file cursor slots. A checkpoint written before the
 * file slot existed held one shared cursor: classify it by shape, since only a WHOOP file
 * batch cursor is a `{"file":…}` object. */
function cursorSlots(state: CliConnectorState | undefined): { api?: string; file?: string } {
  const legacyFile = state?.cursor?.startsWith('{"file":') ?? false;
  return {
    api: legacyFile ? undefined : state?.cursor,
    file: state?.fileCursor ?? (legacyFile ? state?.cursor : undefined),
  };
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
    let encodedKey = options.vaultKey;
    if (encodedKey === undefined) {
      encodedKey = nodeEnv.CONNECTOR_VAULT_KEY;
      // Child processes and later diagnostics never inherit the key.
      delete nodeEnv.CONNECTOR_VAULT_KEY;
    }
    if (command.vault && !encodedKey)
      throw new NodeRuntimeError("config", "--vault requires CONNECTOR_VAULT_KEY.");
    if (encodedKey && !command.vault)
      stderr(
        "CONNECTOR_VAULT_KEY supplied without --vault; refresh credentials remain in memory.\n",
      );
    const config = await readNodeConfig(options.configPath);
    const registry = createRegistry(config.connectors);
    const adapter =
      command.id === "vesync"
        ? createVeSyncAdapter({ room: command.room })
        : registry.adapterById(command.id);
    const fileAdapter = command.bank
      ? createBankStatementsFileAdapter(command.bank)
      : fileAdapterById(command.id);
    if ((command.file && !fileAdapter) || (!command.file && !adapter))
      throw new NodeRuntimeError(
        "config",
        "Unknown connector or unsupported import mode; file connectors require --file.",
      );
    const privateImport = requiresPrivateDestination(command.id);
    const file = command.file
      ? await importFile(command.file, fileAdapter as FileImportAdapter)
      : undefined;
    // Every Pod and source request, including checkpoint reads/writes and the import's own
    // Pod writes, refuses to send once the command is cancelled. Token and revocation
    // requests keep their own controller once sent, so a rotated credential is never lost.
    const withSignal =
      (transport: typeof fetch, ownController?: ReadonlySet<string>): typeof fetch =>
      async (input, init) => {
        options.signal?.throwIfAborted();
        if (ownController?.has(String(input instanceof Request ? input.url : input)))
          return transport(
            input,
            init?.signal
              ? init
              : { ...init, signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS) },
          );
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
    const verifier = options.verifyPrivateDestination;
    const createStorage = privateImport && !verifier ? createWacImportStorage : createSolidBackend;
    const storage = createStorage({ fetch: podFetch, root: config.podRoot });
    const podWriter = createStoragePodWriter({
      storage,
      container: adapterContainer(command.id, config.podRoot),
      webId: config.webId,
      verifyPrivateDestination: verifier
        ? (url) =>
            verifier({
              url,
              storage,
              fetch: podFetch,
              ownerWebId: config.webId,
              signal: options.signal,
            })
        : createOwnerOnlyDestinationVerifier({
            podRoot: config.podRoot,
            ownerWebId: config.webId,
            signal: options.signal,
            async openStorage() {
              const root = storage.root;
              const signal = options.signal;
              // ACL links alone are also used by ACP servers. Establish WAC independently.
              if ((await accessModel({ fetch: podFetch, storage: root, signal })) !== "wac")
                throw new PrivateDestinationError(command.id);
              const head = await storage.head(root, { revalidate: true, signal });
              if (
                !(head.links.get("type") ?? []).some(
                  ({ target }) => target === "http://www.w3.org/ns/pim/space#Storage",
                )
              )
                throw new PrivateDestinationError(command.id);
              return storage;
            },
          }),
      typeIndex: {
        profileDocumentUrl: config.profileDocumentUrl,
        storageFor: (url) =>
          createSolidBackend({ fetch: podFetch, root: `${new URL(url).origin}/` }),
      },
      ...(options.signal && { signal: options.signal }),
    });
    // Check before the state store writes its ACL, which can create missing ancestors.
    if (privateImport) await requirePrivateDestination(command.id, podWriter, stateStore.url);
    let previous = await stateStore.read();
    const writeState = async (state: CliConnectorState) => {
      if (privateImport) await requirePrivateDestination(command.id, podWriter, stateStore.url);
      await stateStore.write(state);
    };
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
      const sourceConfig = { ...adapter.oauth, ...config.connectors[command.id] };
      if (sourceConfig.clientSecret) sourceConfig.tokenExchange = "public";
      const tokenUrls = new Set(
        [
          sourceConfig.tokenEndpoint,
          sourceConfig.tokenProxyUrl,
          sourceConfig.revocationEndpoint,
        ].filter((url): url is string => typeof url === "string"),
      );
      const sourceFetch = withSignal(options.sourceTransport ?? globalThis.fetch, tokenUrls);
      let vault: ConnectorTokenVault | undefined;
      if (command.vault && encodedKey) {
        try {
          vault = new ConnectorTokenVault(
            await importVaultKey(encodedKey),
            new FileVaultStore(command.vault),
          );
        } catch {
          throw new NodeRuntimeError("config", "Cannot initialize connector vault.");
        }
      }
      const vaultOptions = {
        vault,
        account: sourceConfig.account ?? "default",
        signal: options.signal,
      };
      const interactive = options.interactiveLogin !== false;
      let token: TokenSet | undefined;
      try {
        token = await getOAuthToken(command.id, sourceConfig, sourceFetch, vaultOptions);
      } catch (error) {
        // An undecryptable record (e.g. a rotated key) would fail every rerun; the code exchange
        // below replaces it without reading it. Revocation still requires an explicit rerun.
        if (!(error instanceof UnreadableCredentialError) || !interactive) throw error;
      }
      if (!token && !interactive)
        throw new IntegrationAuthError(command.id, "reauthorise", "Reconnect this source account.");
      token ??= await authorizeLoopback(command.id, sourceConfig, sourceFetch, {
        ...vaultOptions,
        openAuthorizationUrl:
          options.openAuthorizationUrl ??
          ((url) => stderr(`Open this URL to connect the source:\n${url}\n`)),
        signal: options.signal,
      });
      sourceAuth = vault
        ? createOAuthSourceAuth(adapter, sourceConfig, sourceFetch, { ...vaultOptions, token })
        : (adapter.createSourceAuth?.(sourceConfig, token, sourceFetch) ??
          createSourceAuth(command.id, adapter, token, sourceFetch));
    }
    const execute = async () => {
      let next: ConnectorState | undefined;
      const slots = cursorSlots(previous);
      const pendingWhoopBatch = command.id === "whoop" && slots.api?.startsWith('{"v":1,');
      // File runs always continue their own content-bound batch; API runs resume only with
      // --since or a pending WHOOP batch. Each path sees only its own cursor slot.
      const resume = command.since || pendingWhoopBatch;
      const state = previous && {
        connectedAt: previous.connectedAt,
        ...(previous.lastSync === undefined ? {} : { lastSync: previous.lastSync }),
        cursor: file ? slots.file : resume ? slots.api : undefined,
        lastOutcome: previous.lastOutcome,
        counts: previous.counts,
      };
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
        const report = file
          ? await runFileImport({ ...shared, adapter: fileAdapter as FileImportAdapter, file })
          : await runImport({
              ...shared,
              adapter: adapter as NonNullable<typeof adapter>,
              mode: "live",
              sourceAuth,
            });
        // Warnings are meant to be fixed adapter strings; still never let one carry terminal
        // control sequences or unbounded text to stderr.
        for (const warning of report.warnings ?? [])
          stderr(`${warning.replace(CONTROL_CHARACTERS, "").slice(0, 500)}\n`);
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
        if (error instanceof PrivateDestinationError) throw error;
        if (next) {
          // A full import still preserves the last successful checkpoint on failure.
          await writeState(previous ? { ...previous, lastOutcome: "error" } : next);
        }
        if (error instanceof VeSyncAuthError) throw new NodeRuntimeError("auth", error.message);
        if (error instanceof IntegrationAuthError) throw error;
        throw new NodeRuntimeError(
          "import",
          "Import failed; the last successful checkpoint was retained.",
        );
      }
      if (!next) throw new NodeRuntimeError("import", "Import did not return connector state.");
      const { cursor, ...rest } = next;
      const api = file ? slots.api : cursor;
      const fileCursor = file ? cursor : slots.file;
      await writeState({
        ...rest,
        ...(api === undefined ? {} : { cursor: api }),
        ...(fileCursor === undefined ? {} : { fileCursor }),
      });
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
          : error instanceof IntegrationAuthError
            ? new NodeRuntimeError(
                "auth",
                error.reason === "reauthorise"
                  ? "Reconnect this source account."
                  : "Source authentication failed.",
              )
            : new NodeRuntimeError(
                "import",
                error instanceof PrivateDestinationError ? error.message : "Import failed.",
              );
    stderr(`${failure.message}\n`);
    return EXIT_CODES[failure.kind];
  }
}
