// Node side of the browser-SDK pages: bundles the page entries (the built library, and the real
// @azure/msal-browser) with esbuild, serves them from the loopback origin registered with the provider, and
// runs a decoy API that browsers are allowed to send credentials to (so its silence means something).
import { build } from "esbuild"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

const directory = fileURLToPath(new URL("./", import.meta.url))
export const bundleDirectory = fileURLToPath(new URL("./.bundle/", import.meta.url))

/** The only paths served (no directory access): the pages and their bundles. */
const files = {
    "/google.html": ["google.html", "text/html; charset=utf-8"],
    "/msal.html": ["msal.html", "text/html; charset=utf-8"],
    "/redirect.html": ["redirect.html", "text/html; charset=utf-8"],
    "/.bundle/google.js": [".bundle/google.js", "text/javascript; charset=utf-8"],
    "/.bundle/msal.js": [".bundle/msal.js", "text/javascript; charset=utf-8"],
    "/.bundle/redirect.js": [".bundle/redirect.js", "text/javascript; charset=utf-8"],
}

let bundling
/** Builds the page bundles once per process (requires `npm run build`: pages import dist/). */
export function bundle() {
    bundling ??= build({
        entryPoints: {google: "google-entry.js", msal: "msal-entry.js", redirect: "redirect-entry.js"},
        absWorkingDir: directory,
        bundle: true, format: "iife", platform: "browser", target: "es2022",
        outdir: bundleDirectory, logLevel: "warning",
    })
    return bundling
}

const loopbackAddresses = {"127.0.0.1": ["127.0.0.1"], "[::1]": ["::1"], "localhost": ["127.0.0.1", "::1"]}

/**
 * Why `origin` cannot be the page origin, or `undefined`: it must be `http` on a loopback host with an
 * explicit port and nothing else — the value registered as the Google JavaScript origin / Entra SPA redirect.
 */
export function pageOriginProblem(origin) {
    let url
    try {
        url = new URL(origin)
    } catch {
        return "origin is not a URL"
    }
    if (url.protocol !== "http:" || loopbackAddresses[url.hostname] === undefined || url.port === "") return "origin must be http on localhost, 127.0.0.1 or [::1] with an explicit port"
    if (url.href !== `${url.origin}/` || origin.replace(/\/$/, "") !== url.origin) return "origin must be a bare origin (no path, query, fragment or credentials)"
    return undefined
}

async function listenAll(handler, hostname, port) {
    const servers = []
    for (const address of loopbackAddresses[hostname]) {
        const server = createServer(handler)
        server.listen(servers.length === 0 ? port : servers[0].address().port, address)
        try {
            await Promise.race([once(server, "listening"), once(server, "error").then(([error]) => { throw error })])
            servers.push(server)
        } catch (error) {
            // `localhost` without an IPv6 loopback only means 127.0.0.1; a taken port is an error.
            if (address === "::1" && hostname === "localhost" && ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(error.code)) continue
            await closeAll(servers)
            throw new Error(`cannot listen on ${address}:${port} (${error.code ?? error.message})`)
        }
    }
    return servers
}

async function closeAll(servers) {
    await Promise.all(servers.map(server => {
        server.closeAllConnections()
        return new Promise(resolve => server.close(() => resolve()))
    }))
}

/**
 * Serves the pages on `origin` (port `0` picks a free port, for tests). Every response is `no-store` and
 * carries no Cross-Origin-Opener-Policy: MSAL's and Google's popups need `window.opener`/BroadcastChannel.
 * @returns {Promise<{origin: string, close(): Promise<void>}>}
 */
export async function startPageServer(origin) {
    const problem = pageOriginProblem(origin)
    if (problem !== undefined) throw new Error(problem)
    await bundle()
    const {hostname, port} = new URL(origin)
    const servers = await listenAll(async (req, res) => {
        const entry = req.method === "GET" || req.method === "HEAD" ? files[new URL(req.url, "http://x").pathname] : undefined
        if (entry === undefined) {
            res.writeHead(404, {"content-type": "text/plain", "cache-control": "no-store"}).end("not found")
            return
        }
        try {
            const body = await readFile(`${directory}${entry[0]}`)
            res.writeHead(200, {"content-type": entry[1], "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer"})
            res.end(req.method === "HEAD" ? undefined : body)
        } catch {
            res.writeHead(500, {"content-type": "text/plain", "cache-control": "no-store"}).end("bundle missing")
        }
    }, hostname, Number(port))
    return {
        origin: `http://${hostname}:${servers[0].address().port}`,
        close: () => closeAll(servers),
    }
}

/**
 * A cross-origin API that challenges every request with `Bearer` and whose CORS policy would let a browser
 * send `Authorization`/`DPoP` to it. `seen` records only whether credentials arrived, including preflights
 * announcing them — so a leak cannot hide behind a failed preflight.
 */
export async function corsDecoy() {
    const seen = []
    const [server] = await listenAll((req, res) => {
        const announced = (req.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map(h => h.trim())
        seen.push({
            preflight: req.method === "OPTIONS",
            credentials: req.headers.authorization !== undefined || req.headers.dpop !== undefined || announced.includes("authorization") || announced.includes("dpop"),
        })
        const cors = {
            "access-control-allow-origin": req.headers.origin ?? "*",
            "access-control-allow-headers": "authorization, dpop, content-type",
            "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE",
            "access-control-expose-headers": "www-authenticate",
            "vary": "origin",
            "cache-control": "no-store",
        }
        if (req.method === "OPTIONS") res.writeHead(204, cors).end()
        else res.writeHead(401, {...cors, "www-authenticate": "Bearer realm=\"decoy\""}).end()
    }, "127.0.0.1", 0)
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        seen,
        close: () => closeAll([server]),
    }
}
