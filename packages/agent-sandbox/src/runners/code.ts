// AUTHORED-BY Claude Opus 5.5
// The code box: agent-written JavaScript runs inside QuickJS compiled to WebAssembly. The box
// has no network, no files, no timers and no host objects; its ONLY way out is `tools.<name>`,
// and every such call goes through the same gate as any other agent call. CPU time, memory,
// stack and the number of tool calls are capped. Each run gets a fresh WebAssembly module, so
// nothing survives between runs.
import variantModule from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSSyncVariant,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten-core";
import type { Sandbox } from "../gate.js";
import type { Args, CallResult, Json } from "../types.js";

// The variant's declarations are CommonJS-shaped; at run time ESM gives the variant itself.
const variant = ((variantModule as unknown as { default?: QuickJSSyncVariant }).default ??
  variantModule) as QuickJSSyncVariant;

/** Limits for one run. */
export interface CodeOptions {
  /** Wall-clock limit for the whole run, including waiting for tools (default 10 s). */
  readonly timeoutMs?: number;
  /** CPU limit for the script itself between tool calls (default 1 s). */
  readonly cpuMs?: number;
  /** Memory limit in bytes (default 32 MiB). */
  readonly memoryBytes?: number;
  /** Maximum tool calls (default 50). */
  readonly maxCalls?: number;
  /** Called before each tool call (e.g. to move a demo clock on). */
  readonly onCall?: () => void;
  /** Called with each line the script logs, in order. */
  readonly onLog?: (line: string) => void;
  /** Called with each tool call once it has its result, in order. */
  readonly onResult?: (call: CodeCall) => void;
}

/** One tool call the script made. */
export interface CodeCall {
  readonly tool: string;
  readonly args: Json;
  readonly result: CallResult | { readonly status: "refused"; readonly message: string };
}

/** What happened. */
export interface CodeRun {
  readonly ok: boolean;
  readonly logs: readonly string[];
  readonly calls: readonly CodeCall[];
  readonly error?: string;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Run a script in the code box against a sandbox's visible tools. */
export async function runCode(
  sandbox: Sandbox,
  code: string,
  options: CodeOptions = {},
): Promise<CodeRun> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxCalls = options.maxCalls ?? 50;
  const logs: string[] = [];
  const calls: CodeCall[] = [];
  let started = 0;
  const names = sandbox
    .tools()
    .map((t) => t.name)
    .filter((n) => IDENT.test(n));

  const quickjs = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(options.memoryBytes ?? 32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const cpu = () =>
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + (options.cpuMs ?? 1000)));
  cpu();
  const ctx = runtime.newContext();
  const pending = new Set<QuickJSDeferredPromise>();
  let finished = false;
  const record = (call: CodeCall) => {
    calls.push(call);
    options.onResult?.(call);
  };

  const logFn = ctx.newFunction("log", (...handles: QuickJSHandle[]) => {
    if (logs.length < 200) {
      const line = handles
        .map((h) => String(ctx.dump(h)))
        .join(" ")
        .slice(0, 2000);
      logs.push(line);
      options.onLog?.(line);
    }
  });
  ctx.setProp(ctx.global, "log", logFn);
  logFn.dispose();

  const callFn = ctx.newFunction(
    "__call",
    (nameHandle: QuickJSHandle, argsHandle: QuickJSHandle) => {
      const name = ctx.getString(nameHandle);
      const text = ctx.getString(argsHandle);
      const deferred = ctx.newPromise();
      pending.add(deferred);
      const settle = (value: unknown) => {
        if (finished || !ctx.alive) return;
        const h = ctx.newString(JSON.stringify(value));
        deferred.resolve(h);
        h.dispose();
        pending.delete(deferred);
        cpu();
        runtime.executePendingJobs();
      };
      void (async () => {
        let args: unknown;
        try {
          args = JSON.parse(text);
        } catch {
          args = undefined;
        }
        // A call that arrives after the script was stopped never reaches the sandbox.
        if (finished) return;
        // Count a call when it starts, so calls made together cannot overshoot the cap.
        if (started >= maxCalls) {
          const result = {
            status: "refused" as const,
            message: `The code box allows at most ${maxCalls} tool calls.`,
          };
          // Log the first refusal only, so a flood of calls cannot grow the host's log.
          if (started++ === maxCalls) record({ tool: name, args: null, result });
          return settle(result);
        }
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          const result = {
            status: "refused" as const,
            message: "Tool arguments must be an object.",
          };
          record({ tool: name, args: null, result });
          return settle(result);
        }
        started += 1;
        options.onCall?.();
        const result = await sandbox.call({ tool: name, args: args as Args });
        record({ tool: name, args: args as Json, result });
        settle(result);
      })();
      return deferred.handle;
    },
  );
  ctx.setProp(ctx.global, "__call", callFn);
  callFn.dispose();

  // The only bridge: a frozen `tools` object of the tools the agent may see.
  // The raw bridge is captured in a closure and removed, so code reaches only the listed tools.
  const prelude = `(() => { const call = globalThis.__call; delete globalThis.__call; globalThis.tools = Object.freeze(Object.fromEntries(${JSON.stringify(names)}.map((n) => [n, async (a) => JSON.parse(await call(n, JSON.stringify(a === undefined ? {} : a)))]))); })();`;
  const body = `(async () => {\n${code}\n})()`;

  let error: string | undefined;
  try {
    ctx.unwrapResult(ctx.evalCode(prelude, "prelude.js")).dispose();
    const promise = ctx.unwrapResult(ctx.evalCode(body, "agent-script.js"));
    // Attach the host's listener first, then run the guest's queued jobs.
    const outcome = ctx.resolvePromise(promise);
    runtime.executePendingJobs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const settled = await Promise.race([outcome, timeout]);
    clearTimeout(timer);
    promise.dispose();
    if (settled === "timeout")
      error = `The script ran past the ${timeoutMs / 1000} s limit and was stopped.`;
    else if (settled.error) {
      const e = ctx.dump(settled.error) as { name?: string; message?: string } | string;
      settled.error.dispose();
      error = typeof e === "object" && e ? `${e.name ?? "Error"}: ${e.message ?? ""}` : String(e);
    } else settled.value.dispose();
  } catch (e) {
    const dumped = e as { name?: string; message?: string };
    error = `${dumped.name ?? "Error"}: ${dumped.message ?? String(e)}`;
  } finally {
    finished = true;
    for (const d of pending) d.dispose();
    try {
      ctx.dispose();
      runtime.dispose();
    } catch {
      // A script stopped mid-flight can leave guest objects alive; the whole module is
      // discarded with this run, so nothing leaks into the next one.
    }
  }
  return { ok: error === undefined, logs, calls, ...(error !== undefined && { error }) };
}
