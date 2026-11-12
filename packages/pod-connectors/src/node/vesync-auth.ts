// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import { env, stderr, stdin } from "node:process";
import { StringDecoder } from "node:string_decoder";
import { snapshotFetchInput } from "@jeswr/guarded-fetch";
import { readJson } from "../core/budget.js";
import type { SourceAuth } from "../core/types.js";
import {
  BYPASS,
  DETAIL,
  DEVICES,
  LOGIN,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  record,
  text,
  VESYNC_API,
} from "../vesync/api.js";
import { VeSyncAuthError } from "../vesync/errors.js";
import { NodeRuntimeError } from "./errors.js";
import { delay } from "./watch.js";

export interface VeSyncCredentials {
  readonly email: string;
  readonly passwordHash: string;
}
/** Passwords are discarded by callers immediately after hashing. MD5 is mandated by VeSync. */
export function hashVeSyncPassword(password: string): string {
  return createHash("md5").update(password, "utf8").digest("hex");
}
/** Hidden bounded TTY input for both email and password; always restore terminal state. */
export async function hiddenPrompt(label: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!stdin.isTTY || !stderr.isTTY)
    throw new NodeRuntimeError(
      "auth",
      "VeSync needs a terminal prompt or VESYNC_EMAIL / VESYNC_PASSWORD.",
    );
  stderr.write(label);
  const raw = stdin.isRaw;
  const paused = stdin.isPaused();
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let input = "";
    const decoder = new StringDecoder("utf8");
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("error", onError);
      signal?.removeEventListener("abort", cancel);
      stdin.setRawMode(raw);
      if (paused) stdin.pause();
      stderr.write("\n");
    };
    const cancel = () => {
      input = "";
      cleanup();
      reject(new NodeRuntimeError("cancelled", "Import cancelled."));
    };
    const onError = () => {
      input = "";
      cleanup();
      reject(new VeSyncAuthError());
    };
    const onData = (bytes: Buffer) => {
      for (const char of decoder.write(bytes)) {
        if (char === "\x03" || char === "\x04") {
          cancel();
          return;
        }
        if (char === "\r" || char === "\n") {
          const value = input;
          input = "";
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\x7f" || char === "\b") input = Array.from(input).slice(0, -1).join("");
        else if (char >= " " && char !== "\x1b") input += char;
        if (input.length > 1024) {
          input = "";
          cleanup();
          reject(new VeSyncAuthError());
          return;
        }
      }
    };
    stdin.on("data", onData);
    stdin.once("error", onError);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
/** Explicit Node-only exception to the package's environment-free browser API. */
export async function readVeSyncCredentials(signal?: AbortSignal): Promise<VeSyncCredentials> {
  if (signal?.aborted) throw new NodeRuntimeError("cancelled", "Import cancelled.");
  let email = env.VESYNC_EMAIL;
  let password = env.VESYNC_PASSWORD;
  delete env.VESYNC_EMAIL;
  delete env.VESYNC_PASSWORD;
  let passwordHash: string | undefined;
  try {
    // Hash before any prompt/await; the CLI retains only the hash for renewal.
    if (password !== undefined) {
      if (!password || password.length > 1024) throw new VeSyncAuthError();
      passwordHash = hashVeSyncPassword(password);
      password = undefined;
    }
    email ??= await hiddenPrompt("VeSync email (hidden): ", signal);
    if (!text(email)) throw new VeSyncAuthError();
    if (passwordHash === undefined) {
      password = await hiddenPrompt("VeSync password (hidden): ", signal);
      if (!password) throw new VeSyncAuthError();
      passwordHash = hashVeSyncPassword(password);
      password = undefined;
    }
    return { email, passwordHash };
  } finally {
    password = undefined;
    email = undefined;
  }
}
export interface VeSyncAuthOptions {
  readonly credentials: VeSyncCredentials;
  readonly transport: typeof fetch;
  readonly signal?: AbortSignal;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}
/** Memory-only session. A fixed route allowlist prevents credential forwarding or redirects. */
export function createVeSyncSourceAuth(options: VeSyncAuthOptions): SourceAuth {
  const { email, passwordHash } = options.credentials;
  if (!text(email) || !/^[a-f0-9]{32}$/.test(passwordHash)) throw new VeSyncAuthError();
  let token: string | undefined, accountID: string | undefined;
  const sleep = options.sleep ?? delay,
    random = options.random ?? Math.random;
  const base = () => ({
    appVersion: "2.8.6",
    phoneBrand: "SM N9005",
    phoneOS: "Android",
    timeZone: "UTC",
    acceptLanguage: "en",
    traceId: `${Date.now()}`,
    userType: "1",
  });
  async function request(
    path: string,
    payload: object,
    caller: AbortSignal,
    login = false,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      options.signal?.throwIfAborted();
      const signal = AbortSignal.any([
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        caller,
        ...(options.signal ? [options.signal] : []),
      ]);
      let response: Response | undefined;
      let abort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        abort = () => {
          void response?.body?.cancel().catch(() => {});
          reject(new Error("VeSync timeout"));
        };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
      try {
        const answer = await Promise.race([
          (async () => {
            signal.throwIfAborted();
            response = await options.transport(VESYNC_API + path, {
              method: "POST",
              redirect: "error",
              signal,
              headers: { "content-type": "application/json", "user-agent": "okhttp/3.12.1" },
              body: JSON.stringify({ ...base(), ...payload }),
            });
            if (response.status === 401) {
              void response.body?.cancel().catch(() => {});
              return { code: -11000022 };
            }
            if (response.status === 429 || response.status >= 500) {
              void response.body?.cancel().catch(() => {});
              return undefined;
            }
            if (!response.ok) {
              void response.body?.cancel().catch(() => {});
              throw new Error();
            }
            const json = record(
              await readJson(
                response,
                "vesync",
                VESYNC_API + path,
                MAX_RESPONSE_BYTES,
                undefined,
                signal,
              ),
            );
            if (typeof json.code !== "number" || !Number.isSafeInteger(json.code))
              throw new Error();
            return json;
          })(),
          aborted,
        ]);
        if (answer) return answer;
      } catch {
        if (caller.aborted) caller.throwIfAborted();
        if (options.signal?.aborted) options.signal.throwIfAborted();
        // Never retain the source exception, response body, credentials or a cause.
        if (login) throw new VeSyncAuthError();
        throw new NodeRuntimeError("import", "VeSync request failed.");
      } finally {
        signal.removeEventListener("abort", abort);
      }
      if (attempt < 2)
        await sleep(Math.round(1000 * 2 ** attempt * (0.75 + random() * 0.5)), caller);
    }
    throw new NodeRuntimeError(
      "import",
      "VeSync is temporarily unavailable after bounded retries.",
    );
  }
  async function login(caller: AbortSignal) {
    const answer = await request(
      LOGIN,
      { email, password: passwordHash, method: "login", devToken: "", osType: "Android" },
      caller,
      true,
    );
    const result = record(answer.result);
    if (answer.code !== 0 || !text(result.token, 4096) || !text(result.accountID))
      throw new VeSyncAuthError();
    token = result.token as string;
    accountID = result.accountID as string;
  }
  return {
    fetch: async (input, init) => {
      try {
        const snapshot = snapshotFetchInput(input, init);
        const req =
          typeof snapshot.input === "string"
            ? new Request(snapshot.input, snapshot.init)
            : snapshot.input;
        const caller = AbortSignal.any([req.signal, ...(options.signal ? [options.signal] : [])]);
        const url = new URL(req.url);
        const path = url.pathname;
        if (
          url.origin !== VESYNC_API ||
          url.search ||
          url.hash ||
          url.username ||
          url.password ||
          req.method !== "POST" ||
          ![DEVICES, BYPASS, DETAIL].includes(path)
        )
          throw new Error();
        // The adapter supplies a small JSON body; never forward arbitrary headers or URLs.
        if (Number(req.headers.get("content-length")) > 16384) throw new Error();
        // Request bodies may be streams from library callers: bound them using the same reader.
        const payload = record(
          await readJson(
            new Response(req.body),
            "vesync",
            VESYNC_API + path,
            16384,
            undefined,
            AbortSignal.any([
              req.signal,
              AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              ...(options.signal ? [options.signal] : []),
            ]),
          ),
        );
        req.signal.throwIfAborted();
        options.signal?.throwIfAborted();
        if (path !== DEVICES && !text(payload.cid)) throw new Error();
        const body =
          path === DEVICES
            ? { pageNo: 1, pageSize: 50 }
            : path === DETAIL
              ? { cid: payload.cid }
              : {
                  cid: payload.cid,
                  ...(text(payload.uuid) ? { uuid: payload.uuid } : {}),
                  configModule: text(payload.configModule) ?? "WiFi",
                  debugMode: false,
                  deviceRegion: text(payload.deviceRegion) ?? "US",
                  payload: { method: "getPurifierStatus", source: "APP", data: {} },
                };
        // Each call has its own caller signal, including login, renewal, body and retry delays.
        const scoped = createRequestScope(caller);
        return await scoped(body, path);
      } catch (error) {
        if (error instanceof VeSyncAuthError || error instanceof NodeRuntimeError) throw error;
        throw new NodeRuntimeError("import", "VeSync request refused or failed.");
      }
    },
  };
  function createRequestScope(signal: AbortSignal) {
    // The outer request race observes caller cancellation even for injected transports.
    return async (body: object, path: string) => {
      let abort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        abort = () => reject(new NodeRuntimeError("cancelled", "Import cancelled."));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
      try {
        return await Promise.race([
          (async () => {
            if (!token) await login(signal);
            for (let renewal = 0; renewal < 2; renewal++) {
              signal.throwIfAborted();
              const answer = await request(
                path,
                {
                  ...body,
                  token,
                  accountID,
                  method:
                    path === DEVICES ? "devices" : path === BYPASS ? "bypassV2" : "devicedetail",
                },
                signal,
              );
              if (answer.code === -11000022 || answer.code === -11000021) {
                token = undefined;
                accountID = undefined;
                if (renewal) throw new VeSyncAuthError();
                await login(signal);
                continue;
              }
              if (answer.code !== 0)
                throw new NodeRuntimeError("import", "VeSync could not read the purifier.");
              return Response.json(answer);
            }
            throw new VeSyncAuthError();
          })(),
          aborted,
        ]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    };
  }
}
