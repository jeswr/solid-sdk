// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { ChatWriter } from "@jeswr/solid-chat-interop";
import { createChatPodPort, createCliFetch, loadCliConfig } from "@jeswr/solid-mcp";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { homedir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { dirname, resolve } from "path";
import type { CaptureOptions } from "./capture.js";
import { readExportJson } from "./export-file.js";
import { parseChatgptExport, parseClaudeExport } from "./export-parsers.js";
import { isIgnored, queueDirectory } from "./io.js";
import { sequenceConversation } from "./queue.js";

/** Explicit export import boundaries, using the same config and guarded transport as hooks. */
export interface ExportImportOptions
  extends Pick<CaptureOptions, "home" | "cwd" | "env" | "fetch"> {
  /** Cancel file processing and requests; imports are not subject to the hook's ten-second watchdog. */
  signal?: AbortSignal;
}

/** Import ChatGPT ZIP/JSON or Claude.ai JSON via owner-only, create-only ChatWriter writes.
 * Returns 1 on any failure without exposing paths, content, credentials or remote errors.
 * Re-run the same export after a partial upload; stable IDs make retries idempotent.
 */
export async function runExportImport(
  args: string[],
  options: ExportImportOptions = {},
): Promise<0 | 1> {
  try {
    const [command, source] = args;
    if (
      (command !== "chatgpt-export" && command !== "claude-export") ||
      !source ||
      args.length !== 2
    )
      throw new Error("Invalid export arguments");
    const signal = options.signal ?? new AbortController().signal;
    const home = options.home ?? homedir();
    const cwd = resolve(options.cwd ?? process.cwd());
    const path = resolve(cwd, source);
    const projects = [cwd, dirname(path)];
    if (await isIgnored(projects, signal)) throw new Error("Export opted out");
    const text = await readExportJson(path, command === "chatgpt-export", signal);
    const conversations =
      command === "chatgpt-export" ? parseChatgptExport(text) : parseClaudeExport(text);
    const config = await loadCliConfig(options.env ?? process.env, home);
    if (config.readOnly || !config.clientId || !config.webId)
      throw new Error("Export requires writable config");
    const httpTransport =
      options.fetch ??
      createNodeGuardedFetch({
        allowLoopback: [config.podRoot, config.oidcIssuer, config.tokenUrl].some(
          (value) =>
            value !== undefined &&
            /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(new URL(value).hostname),
        ),
      });
    new ChatWriter(createChatPodPort({ ...config, fetch: httpTransport }));
    if (conversations.length === 0) return 0;
    const transport: ReturnType<typeof createNodeGuardedFetch> = (input, init) => {
      signal.throwIfAborted();
      const request = new Request(input, init);
      return httpTransport(request, { signal: AbortSignal.any([request.signal, signal]) });
    };
    const directory = await queueDirectory(home);
    const target = { podRoot: new URL(config.podRoot).href, webId: config.webId };
    const writer = new ChatWriter(
      createChatPodPort({ ...config, fetch: await createCliFetch(config, transport) }),
    );
    for (const conversation of conversations) {
      signal.throwIfAborted();
      if (await isIgnored(projects, signal)) throw new Error("Export opted out");
      const sequenced = await sequenceConversation(directory, target, conversation, signal);
      // ChatWriter serializes its entire argument before writing. Keep that working set
      // bounded even when a single untrusted conversation contains many small messages.
      for (let offset = 0; offset < sequenced.messages.length; offset += 100) {
        signal.throwIfAborted();
        await writer.save({
          ...sequenced,
          messages: sequenced.messages.slice(offset, offset + 100),
        });
      }
    }
    return 0;
  } catch {
    return 1;
  }
}
