// AUTHORED-BY Codex GPT-6.1-Sol

import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { ChatWriter } from "@jeswr/solid-chat-interop";
import { createChatPodPort, createCliFetch, loadCliConfig } from "@jeswr/solid-mcp";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { readdir } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { homedir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join, resolve } from "path";
import { isIgnored, queueDirectory, readRegular } from "./io.js";
import { digest, parseClaudeTranscript, parseCodexTranscript, record } from "./parsers.js";
import { enqueue, replay } from "./queue.js";

/** Injectable process boundaries; production callers may omit all options. */
export interface CaptureOptions {
  /** Home containing MCP config, Codex sessions and private capture state. */
  home?: string;
  /** Invoking project directory; checked for opt-out even when transcript metadata differs. */
  cwd?: string;
  /** MCP-12 environment overrides. */
  env?: NodeJS.ProcessEnv;
  /** HTTP transport below the shared MCP-12 DPoP implementation. */
  fetch?: ReturnType<typeof createNodeGuardedFetch>;
  /** Claude hook stdin JSON. Never interpreted as transcript message content. */
  stdin?: AsyncIterable<string | Uint8Array>;
  /** May shorten the budget for embedding/tests; cannot extend the 10-second maximum. */
  budgetMs?: number;
}

function timestamp(value: string): number {
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error("Invalid since");
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("Invalid since");
  return result;
}

async function hookInput(input: AsyncIterable<string | Uint8Array>, signal: AbortSignal) {
  let text = "";
  const decoder = new TextDecoder();
  for await (const chunk of input) {
    signal.throwIfAborted();
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(text) > 65536) throw new Error("Hook input exceeds limit");
  }
  return record(JSON.parse(text));
}

async function* rollouts(directory: string, signal: AbortSignal): AsyncGenerator<string> {
  signal.throwIfAborted();
  let entries: import("fs").Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    signal.throwIfAborted();
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* rollouts(path, signal);
    if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) yield path;
  }
}

async function capture(args: string[], options: CaptureOptions, signal: AbortSignal) {
  const home = options.home ?? homedir();
  const cwd = resolve(options.cwd ?? process.cwd());
  const command = args[0];
  if (command !== "claude" && command !== "codex") return;
  let transcript: string | undefined;
  let since = -Infinity;
  let notify: Record<string, unknown> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (command === "claude" && arg === "--transcript" && args[i + 1]) transcript = args[++i];
    else if (command === "codex" && arg === "--since" && args[i + 1])
      since = timestamp(args[++i] as string);
    else if (command === "codex" && i === args.length - 1) {
      notify = record(JSON.parse(arg as string));
      if (notify.type !== "agent-turn-complete" || typeof notify["thread-id"] !== "string")
        throw new Error("Invalid Codex notification");
    } else throw new Error("Invalid capture arguments");
  }
  if (await isIgnored([cwd], signal)) return;
  if (command === "claude" && !transcript) {
    notify = await hookInput(options.stdin ?? process.stdin, signal);
    if (typeof notify.transcript_path !== "string") throw new Error("Missing transcript path");
    transcript = notify.transcript_path;
  }
  const projects = [cwd];
  if (typeof notify.cwd === "string") projects.push(notify.cwd);
  if (await isIgnored(projects, signal)) return;
  const config = await loadCliConfig(options.env ?? process.env, home);
  if (config.readOnly || !config.clientId || !config.webId) return;
  const target = { podRoot: new URL(config.podRoot).href, webId: config.webId };
  const directory = await queueDirectory(home);
  const httpTransport =
    options.fetch ??
    createNodeGuardedFetch({
      allowLoopback: [config.podRoot, config.oidcIssuer, config.tokenUrl].some(
        (value) =>
          value !== undefined &&
          /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(new URL(value).hostname),
      ),
    });
  // Validate storage configuration before queueing anything, without performing a request.
  new ChatWriter(createChatPodPort({ ...config, fetch: httpTransport }));
  // Apply one deadline to token discovery/login and all pod requests, including bodies.
  const transport: ReturnType<typeof createNodeGuardedFetch> = (input, init) => {
    signal.throwIfAborted();
    const request = new Request(input, init);
    return httpTransport(request, {
      signal: AbortSignal.any([request.signal, signal]),
    });
  };
  let writer: Promise<ChatWriter> | undefined;
  const save = async (chat: Parameters<ChatWriter["save"]>[0]) => {
    // Cache failures too: an offline invocation must not attempt a login per rollout.
    writer ??= createCliFetch(config, transport).then(
      (authenticated) => new ChatWriter(createChatPodPort({ ...config, fetch: authenticated })),
    );
    const authenticatedWriter = await writer;
    signal.throwIfAborted();
    return authenticatedWriter.save(chat);
  };
  // Codex backlog recovery cannot depend on finishing a potentially large rollout scan.
  // Claude's current transcript must be queued before network I/O: PreCompact can replace it.
  if (command === "codex") await replay(directory, target, save, signal);
  const files =
    command === "claude"
      ? [resolve(cwd, transcript as string)]
      : rollouts(join(home, ".codex", "sessions"), signal);
  for await (const path of files) {
    signal.throwIfAborted();
    try {
      const text = await readRegular(path, signal);
      const parsed =
        command === "claude" ? parseClaudeTranscript(text, path) : parseCodexTranscript(text, path);
      if (
        command === "codex" &&
        notify["thread-id"] !== undefined &&
        parsed.conversation.conversationId !== digest(["codex", notify["thread-id"]])
      )
        continue;
      if (
        parsed.projectDirectories.length === 0 ||
        (await isIgnored(parsed.projectDirectories, signal))
      )
        continue;
      parsed.projectDirectories = [...new Set([...projects, ...parsed.projectDirectories])];
      parsed.conversation.messages = parsed.conversation.messages.filter(
        (m) => Date.parse(m.createdAt) > since,
      );
      if (parsed.conversation.messages.length === 0) continue;
      const name = await enqueue(directory, { ...parsed, version: 1, target }, signal);
      if (name !== undefined) await replay(directory, target, save, signal, name);
    } catch {
      // Missing/unsafe/malformed sessions never break hooks or prevent other captures.
    }
  }
  if (command === "claude") await replay(directory, target, save, signal);
}

/** Run a hook silently within at most ten seconds; every failure resolves to exit status zero. */
export async function runCapture(args: string[], options: CaptureOptions = {}): Promise<0> {
  const controller = new AbortController();
  const budget = Math.min(10000, Math.max(0, options.budgetMs ?? 10000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((done) => {
    timer = setTimeout(() => {
      controller.abort();
      done();
    }, budget);
  });
  try {
    await Promise.race([capture(args, options, controller.signal), deadline]);
  } catch {
    // In particular, never print exceptions from auth, paths, transcript parsing or remote bodies.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return 0;
}
