// AUTHORED-BY Codex GPT-6.1-Sol
/** Internal transport shared by both entries. No static Node/undici runtime imports. */

import { classifyIpLiteral, isLoopbackAddress, isPublicAddress, SsrfError } from "./index.js";
import type { ConnectLookup, ResolveAll } from "./node.js";

type Transport = Pick<
  typeof import("undici"),
  "Agent" | "fetch" | "FormData" | "getGlobalDispatcher"
>;
interface PinOptions {
  readonly url: string;
  readonly entry?: "node";
  readonly hostname: string;
  readonly lookup: ConnectLookup;
  readonly ca?: string | Buffer | Array<string | Buffer>;
}
const UNDICI_SPECIFIER = ["un", "dici"].join("");
let transportModule: Promise<Transport> | undefined;
const defaultFactories = new WeakMap<Transport["Agent"], unknown>();

/** Bun/Deno expose Node compatibility APIs without guaranteeing undici socket semantics. */
export function pinningRuntimeUnavailable(): boolean {
  return (
    (typeof process !== "undefined" && Boolean(process.versions?.bun)) ||
    typeof (globalThis as { Deno?: unknown }).Deno !== "undefined"
  );
}

function configurationRefusal(entry?: "node"): SsrfError {
  if (entry === "node")
    return new SsrfError(
      "DNS pinning in the Node entry cannot preserve an effective environment proxy. Use the root entry with requireDnsPinning: false, or supply pinningFetch to the root entry.",
    );
  return new SsrfError(
    "DNS pinning cannot preserve a configured proxy or non-default global dispatcher (including TLS settings). Explicitly set requireDnsPinning: false or supply pinningFetch.",
  );
}

/**
 * undici has no public default-dispatcher predicate. Recognise only its pristine Agent
 * configuration; unknown shapes fail closed. Inspect both dispatcher API generations,
 * since Node's bundled undici may still use v1. These checks must be revisited on upgrades.
 */
function isDefaultAgent(value: unknown, transport?: Transport): boolean {
  if (!value || typeof value !== "object" || value.constructor?.name !== "Agent") return false;
  const symbols = Object.getOwnPropertySymbols(value);
  const optionsKey = symbols.find((key) => key.description === "options");
  const factoryKey = symbols.find((key) => key.description === "factory");
  if (!optionsKey || !factoryKey) return false;
  const record = value as Record<symbol, unknown>;
  const options = record[optionsKey] as Record<string, unknown> | undefined;
  const factory = record[factoryKey];
  if (!options || typeof factory !== "function" || factory.name !== "defaultFactory") return false;
  if (Object.hasOwn(value, "dispatch")) return false;
  if (transport && value instanceof transport.Agent) {
    if (Object.getPrototypeOf(value) !== transport.Agent.prototype) return false;
    if (!defaultFactories.has(transport.Agent)) {
      const probe = new transport.Agent();
      const key = Object.getOwnPropertySymbols(probe).find(
        (symbol) => symbol.description === "factory",
      );
      defaultFactories.set(
        transport.Agent,
        key && (probe as unknown as Record<symbol, unknown>)[key],
      );
      void probe.close().catch(() => {});
    }
    // A configured factory may itself be called defaultFactory; names alone cannot
    // establish that it is the installed undici version's unconfigured factory.
    if (factory !== defaultFactories.get(transport.Agent)) return false;
  }
  return Reflect.ownKeys(options).every((key) =>
    key === "connect" || key === "tls"
      ? options[key] === undefined
      : key === "maxOrigins" && options[key] === Number.POSITIVE_INFINITY,
  );
}

function dispatcherGlobals(): { legacy: unknown; current: unknown } {
  const globals = globalThis as Record<symbol, unknown>;
  return {
    legacy: globals[Symbol.for("undici.globalDispatcher.1")],
    current: globals[Symbol.for("undici.globalDispatcher.2")],
  };
}

/** Match undici's env-proxy hostname/domain/port exclusions, without opening a proxy. */
function hasEffectiveEnvProxy(url: URL): boolean {
  if (typeof process === "undefined") return false;
  const env = process.env ?? {};
  const enabled =
    env.NODE_USE_ENV_PROXY === "1" ||
    /(?:^|\s|")--use-env-proxy(?=\s|$|")/.test(env.NODE_OPTIONS ?? "") ||
    process.execArgv?.includes("--use-env-proxy");
  if (!enabled) return false;
  const httpProxy = env.http_proxy ?? env.HTTP_PROXY;
  const proxy =
    (url.protocol === "https:" ? (env.https_proxy ?? env.HTTPS_PROXY) || httpProxy : httpProxy) ||
    (env.all_proxy ?? env.ALL_PROXY);
  if (!proxy) return false;

  const noProxy = env.no_proxy ?? env.NO_PROXY ?? "";
  if (noProxy === "*") return false;
  const hostname = url.hostname.toLowerCase();
  const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  return !noProxy.split(/[,\s]/).some((exclusion) => {
    if (!exclusion) return false;
    const parsed = exclusion.match(/^(.+):(\d+)$/);
    if (parsed && Number(parsed[2]) !== port) return false;
    const host = (parsed ? parsed[1] : exclusion)?.replace(/^\*?\./, "").toLowerCase();
    return Boolean(host && (hostname === host || hostname.endsWith(`.${host}`)));
  });
}

/** Check before loading undici too: its initialization can replace the legacy dispatcher. */
function assertCompatibleConfiguration(options: PinOptions, transport?: Transport): void {
  if (pinningRuntimeUnavailable()) {
    throw new SsrfError(
      "DNS pinning is unavailable in Bun/Deno; explicitly set requireDnsPinning: false or supply pinningFetch.",
    );
  }
  if (hasEffectiveEnvProxy(new URL(options.url))) throw configurationRefusal(options.entry);
  // The Node entry has always owned its Agent; global dispatchers are not its policy.
  if (options.entry === "node") return;
  const { legacy, current } = dispatcherGlobals();
  const active = transport?.getGlobalDispatcher();
  if (
    (active !== undefined && !isDefaultAgent(active, transport)) ||
    (current !== undefined && !isDefaultAgent(current, transport))
  ) {
    throw configurationRefusal();
  }
  // undici 8 installs this v1 adapter around the v2 dispatcher. Only accept it while
  // that dispatcher is the inspected default Agent; any changed v1 dispatcher is checked.
  const isAdapter =
    legacy?.constructor?.name === "Dispatcher1Wrapper" &&
    current !== undefined &&
    isDefaultAgent(current, transport);
  if (legacy !== undefined && !isAdapter && !isDefaultAgent(legacy, transport))
    throw configurationRefusal();
}

/** Await module loading and configuration checks before the root guard's authority fence. */
export async function preparePinnedTransport(
  options: PinOptions,
): Promise<typeof globalThis.fetch> {
  assertCompatibleConfiguration(options);
  transportModule ??= import(/* @vite-ignore */ UNDICI_SPECIFIER);
  const transport = await transportModule;
  assertCompatibleConfiguration(options, transport);
  return createPinnedTransport(transport, options);
}

/** No await before fetch: the caller's synchronous authority fence remains adjacent to send. */
export function createPinnedTransport(
  transport: Transport,
  options: PinOptions,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    assertCompatibleConfiguration(options, transport);
    let lookupCalled = false;
    const lookup: ConnectLookup = (hostname, lookupOptions, callback) => {
      // Keep dns.lookup's asynchronous callback contract, including mismatch refusals.
      queueMicrotask(() => {
        if (hostname !== options.hostname) {
          callback(new SsrfError("Pinning refused an unexpected connection hostname."), [], 0);
          return;
        }
        lookupCalled = true;
        options.lookup(hostname, lookupOptions, callback);
      });
    };
    const agent = new transport.Agent({ connect: { lookup: lookup as never, ca: options.ca } });
    try {
      const response = await transport.fetch(
        input as string,
        {
          ...init,
          body: normalizeBody(transport, init?.body),
          redirect: "manual",
          dispatcher: agent,
        } as never,
      );
      if (classifyIpLiteral(options.hostname) === 0 && !lookupCalled) {
        void response.body?.cancel().catch(() => {});
        throw new SsrfError(
          "DNS pinning unavailable: the transport returned without invoking the pinned lookup.",
        );
      }
      return response as unknown as Response;
    } finally {
      void agent.close().catch(() => {});
    }
  }) as typeof globalThis.fetch;
}

/**
 * Node's bundled FormData and npm undici's FormData have different brands. Copy entries
 * into the transport realm, preserving File metadata, duplicate fields, replayability,
 * keepalive and caller headers. undici generates the matching boundary/content-type.
 * Blob, URLSearchParams and byte/stream bodies already share compatible brands.
 */
function normalizeBody(transport: Transport, body: RequestInit["body"]): RequestInit["body"] {
  if (
    body &&
    !(body instanceof transport.FormData) &&
    Object.prototype.toString.call(body) === "[object FormData]"
  ) {
    const normalized = new transport.FormData();
    (body as FormData).forEach((value, name) => {
      normalized.append(name, value);
    });
    return normalized as unknown as BodyInit;
  }
  return body;
}

/** Shared all-record validation and dns.lookup callback contract for both pinning policies. */
export function validatingLookup(
  resolveAll: ResolveAll,
  allowLoopback: boolean,
  requireLoopbackOnly: boolean,
): ConnectLookup {
  return (hostname, lookupOptions, callback) => {
    Promise.resolve()
      .then(() => resolveAll(hostname))
      .then(
        (records) => {
          const addresses = records.map(({ address, family }) => ({ address, family }));
          if (addresses.length === 0) {
            callback(new SsrfError(`Host resolved to no addresses: ${hostname}.`), []);
            return;
          }
          for (const a of addresses) {
            const ok = requireLoopbackOnly
              ? isLoopbackAddress(a.address)
              : isPublicAddress(a.address, allowLoopback);
            if (!ok) {
              const why = requireLoopbackOnly
                ? "is not loopback (http: requires loopback-only)"
                : "is a non-public address";
              callback(
                new SsrfError(
                  `Connection refused — ${hostname} resolves to an address that ${why} (${a.address}).`,
                ),
                [],
              );
              return;
            }
          }
          if (lookupOptions?.all === true) callback(null, addresses);
          else {
            const first = addresses[0];
            if (first) callback(null, first.address, first.family);
          }
        },
        (err: unknown) =>
          callback(
            err instanceof Error ? err : new SsrfError(`Host did not resolve: ${hostname}.`),
            [],
          ),
      );
  };
}
