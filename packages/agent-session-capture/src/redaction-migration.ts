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
}

/**
 * Owner-run `solid-capture redact-archive [--dry-run]` (sst-5ax.39): re-redact titles and
 * messages stored before every chat save path redacted, and remove the duplicates that
 * replays left beside them. Uses the same MCP configuration and DPoP transport as imports.
 * Returns 1 on any failure without exposing content, credentials or remote errors.
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
    return 0;
  } catch {
    return 1;
  }
}
