// AUTHORED-BY Claude Opus 5.5
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { type ChatRedactionReport, ChatWriter } from "@jeswr/solid-chat-interop";
import { createChatPodPort, createCliFetch, loadCliConfig } from "@jeswr/solid-mcp";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { homedir } from "os";
import type { CaptureOptions } from "./capture.js";

export interface RedactionMigrationOptions extends Pick<CaptureOptions, "home" | "env" | "fetch"> {
  /** Receives the content-free counts; defaults to one JSON line on stdout. */
  report?: (report: ChatRedactionReport) => void;
  /** Receives a fixed, content-free warning when the archive is not fully repaired;
   * defaults to one line on stderr. */
  warn?: (message: string) => void;
}

/** Never carries a URL, an ID or remote text. */
export const REDACTION_INCOMPLETE_MESSAGE =
  "redact-archive: the archive is NOT fully redacted. Resources counted in failed or conflicts still hold their original text; run it again.";

/**
 * Owner-run `solid-capture redact-archive [--dry-run]` (sst-5ax.39): re-redact titles and
 * messages stored before every chat save path redacted, and remove the duplicates that
 * replays left beside them. Uses the same MCP configuration and DPoP transport as imports.
 * Returns 1 on any failure, including a run that left a chat unchecked or unfixed
 * (`failed` or `conflicts` above 0: those resources still hold their original text),
 * without exposing content, credentials or remote errors.
 */
export async function runRedactionMigration(
  args: string[],
  options: RedactionMigrationOptions = {},
): Promise<0 | 1> {
  try {
    const [command, ...flags] = args;
    if (
      command !== "redact-archive" ||
      flags.some((flag) => flag !== "--dry-run") ||
      flags.length > 1
    )
      throw new Error("Invalid redaction arguments");
    const dryRun = flags.length === 1;
    const home = options.home ?? homedir();
    const config = await loadCliConfig(options.env ?? process.env, home);
    // A dry run only reads; a real run needs the writable configuration imports use.
    if ((!dryRun && config.readOnly) || !config.clientId || !config.webId)
      throw new Error("Redaction requires owner config");
    const transport =
      options.fetch ??
      createNodeGuardedFetch({
        allowLoopback: [config.podRoot, config.oidcIssuer, config.tokenUrl].some(
          (value) =>
            value !== undefined &&
            /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(new URL(value).hostname),
        ),
      });
    // Validate storage configuration before any request.
    new ChatWriter(createChatPodPort({ ...config, fetch: transport }));
    const writer = new ChatWriter(
      createChatPodPort({ ...config, fetch: await createCliFetch(config, transport) }),
    );
    const report = await writer.migrateRedaction({ dryRun });
    (options.report ?? ((value) => process.stdout.write(`${JSON.stringify(value)}\n`)))(report);
    // The counts are printed either way. A conflict left its resource unredacted, so it is
    // a failure just like an unreadable one: a script must not read exit 0 as a clean archive.
    if (report.failed === 0 && report.conflicts === 0) return 0;
    (options.warn ?? ((text) => process.stderr.write(`${text}\n`)))(REDACTION_INCOMPLETE_MESSAGE);
    return 1;
  } catch {
    return 1;
  }
}
