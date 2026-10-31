// The loopback redirect URI: a real HTTP listener (as registered with the provider) that hands authorization
// responses to the waiting CodeProvider, matched by `state`. It never logs or echoes the response.

import { once } from "node:events";
import { createServer } from "node:http";

/** Hostnames the harness may listen on, and the addresses behind them (`localhost` may resolve to either). */
const loopback = { "127.0.0.1": ["127.0.0.1"], "[::1]": ["::1"], localhost: ["127.0.0.1", "::1"] };
const servers = new Map(); // origin -> Promise<entry>

async function listen(target) {
  const pending = new Map();
  const handler = (req, res) => {
    const url = new URL(req.url, target.origin);
    const state = url.searchParams.get("state");
    const waiter = url.pathname === target.pathname ? pending.get(state) : undefined;
    if (waiter === undefined) {
      res.writeHead(404, { "content-type": "text/plain" }).end("unknown authorization response");
      return;
    }
    pending.delete(state);
    res
      .writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
      .end(
        "<!doctype html><title>Done</title><p>Authorization finished; you may close this window.</p>",
      );
    waiter(url.href);
  };
  const listeners = [];
  for (const address of loopback[target.hostname]) {
    const server = createServer(handler);
    server.listen(Number(target.port), address);
    try {
      await Promise.race([
        once(server, "listening"),
        once(server, "error").then(([error]) => {
          throw error;
        }),
      ]);
      listeners.push(server);
    } catch (error) {
      // `localhost` without IPv6 loopback is fine; anything else (e.g. the port is taken) is not.
      if (
        address === "::1" &&
        target.hostname === "localhost" &&
        ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(error.code)
      )
        continue;
      await Promise.all(listeners.map((l) => new Promise((resolve) => l.close(resolve))));
      throw new Error(
        `cannot listen for the redirect URI on ${address}:${target.port} (${error.code ?? error.message})`,
      );
    }
  }
  return { listeners, pending, users: 0 };
}

/**
 * Why `redirectUri` cannot be the harness's callback listener, or `undefined` when it can: it must be plain
 * `http` on a loopback host with an explicit port (RFC 8252 §7.3), without credentials, query or fragment.
 * This is independent of whether the *server* is reached over insecure HTTP.
 */
export function loopbackRedirectProblem(redirectUri) {
  let target;
  try {
    target = new URL(redirectUri);
  } catch {
    return "redirectUri is not a URL";
  }
  if (target.protocol !== "http:" || loopback[target.hostname] === undefined || target.port === "")
    return "redirectUri must be http on 127.0.0.1, [::1] or localhost with an explicit port";
  if (
    target.username !== "" ||
    target.password !== "" ||
    target.search !== "" ||
    target.hash !== ""
  )
    return "redirectUri must not contain credentials, a query or a fragment";
  return undefined;
}

/** A shared listener per redirect URI origin; `close()` releases it. */
export async function callbackServer(redirectUri) {
  const problem = loopbackRedirectProblem(redirectUri);
  if (problem !== undefined) throw new Error(problem);
  const target = new URL(redirectUri);
  if (!servers.has(target.origin)) {
    const starting = listen(target);
    servers.set(target.origin, starting);
    starting.catch(() => servers.delete(target.origin));
  }
  const entry = await servers.get(target.origin);
  entry.users++;
  const { pending } = entry;
  let released = false;
  return {
    /** Resolves with the full callback URL carrying `state`. */
    wait(state, signal) {
      const { promise, resolve, reject } = Promise.withResolvers();
      if (signal?.aborted) {
        reject(signal.reason);
        return promise;
      }
      const onAbort = () => {
        pending.delete(state);
        reject(signal.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(state, (url) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(url);
      });
      return promise;
    },
    async close() {
      if (released) return;
      released = true;
      if (--entry.users > 0) return;
      servers.delete(target.origin);
      await Promise.all(
        entry.listeners.map((server) => {
          server.closeAllConnections();
          return new Promise((resolve) => server.close(resolve));
        }),
      );
    },
  };
}
