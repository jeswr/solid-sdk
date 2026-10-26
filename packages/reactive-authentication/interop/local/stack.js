// Starts and removes the disposable local stack (interop/local/compose.yml) under a unique Compose project.
// Only that project's containers, networks and anonymous volumes are removed; nothing global is pruned.
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { connect } from "node:net"
import { fileURLToPath } from "node:url"
import { redact } from "../lib/redact.js"
import { ensureTestCertificates } from "./tls.js"

const directory = fileURLToPath(new URL(".", import.meta.url))

/** Loopback ports (fixed: issuers and WebIDs embed them) and readiness probes per service. */
export const services = {
    css: {
        port: () => Number(process.env.RA_INTEROP_CSS_PORT ?? 39301),
        ready: port => `http://localhost:${port}/.well-known/openid-configuration`,
        // A Solid-OIDC Client Identifier Document for the css-local-client-id target. It must be reachable by CSS
        // itself, so it is published on CSS: this disposable default configuration leaves the server root
        // publicly writable (and readable), which is where it goes — outside the test accounts' pods.
        async provision(port) {
            const id = `http://localhost:${port}/ra-interop-clients/client.jsonld`
            const document = {
                "@context": ["https://www.w3.org/ns/solid/oidc-context.jsonld"],
                client_id: id, client_name: "reactive-authentication interop (local)",
                redirect_uris: ["http://127.0.0.1:39398/callback"], grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"], scope: "openid webid offline_access", token_endpoint_auth_method: "none",
            }
            const response = await fetch(id, {method: "PUT", headers: {"content-type": "application/ld+json"}, body: JSON.stringify(document), signal: AbortSignal.timeout(30_000)})
            await response.body?.cancel()
            if (response.status !== 201 && response.status !== 205) throw new Error(`publishing the client identifier document answered ${response.status}`)
        },
    },
    keycloak: {
        port: () => Number(process.env.RA_INTEROP_KEYCLOAK_PORT ?? 39380),
        ready: port => `http://127.0.0.1:${port}/realms/interop/.well-known/openid-configuration`,
    },
    nextcloud: {
        port: () => 39445,
        tls: true,
        ready: port => `https://localhost:${port}/status.php`,
        // The repository's init.sh (as in its CI), then this harness's hostname and a second disposable account.
        async provision(port, {exec}) {
            const root = `https://localhost:${port}`
            const www = {service: "nextcloud", user: "www-data"}
            await exec({...www, env: {SERVER_ROOT: root}}, ["sh", "/init.sh"])
            const occ = (...args) => exec(www, ["php", "console.php", ...args])
            await occ("config:system:set", "trusted_domains", "4", "--value=localhost")
            await occ("config:system:set", "overwrite.cli.url", `--value=${root}`)
            await occ("config:system:set", "overwriteprotocol", "--value=https")
            await exec({...www, env: {OC_PASS: "bob-local-only-Pw1!"}}, ["php", "console.php", "user:add", "--password-from-env", "bob"])
            // As the repository's run-solid-test-suite.sh does: this image's apache-limits.conf needs an unset variable.
            await exec({service: "nextcloud", user: "root"}, ["rm", "-f", "/etc/apache2/conf-enabled/apache-limits.conf"])
            await exec({service: "nextcloud", user: "root"}, ["service", "apache2", "reload"])
        },
    },
    manas: {
        port: () => 39310,
        requires: ["css"],
        ready: port => `http://localhost:${port}/`,
    },
    php: {
        port: () => 39444,
        tls: true,
        ready: port => `https://localhost:${port}/.well-known/openid-configuration`,
        // One owner-only resource through the server's own API. It accepts these unauthenticated writes (it only
        // evaluates WAC for requests with an Origin header) and answers 500 after storing them (no pubsub server);
        // the GET below confirms the data exists.
        async provision(port) {
            const base = `https://localhost:${port}/storage/private/`
            const acl = "@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n" +
                `<#owner> a acl:Authorization; acl:agent <https://localhost:${port}/profile/card#me>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.\n`
            for (const [path, body, type] of [["data.txt", "private data of the disposable test account", "text/plain"], [".acl", acl, "text/turtle"]]) {
                const response = await fetch(`${base}${path}`, {method: "PUT", headers: {"content-type": type}, body, signal: AbortSignal.timeout(30_000)})
                await response.body?.cancel()
            }
            const check = await fetch(`${base}data.txt`, {signal: AbortSignal.timeout(30_000)})
            await check.body?.cancel()
            if (check.status !== 200) throw new Error(`PHP Solid Server provisioning did not store the test resource (${check.status})`)
        },
    },
    nss: {
        port: () => 39343, // fixed in interop/local/nss/config.json (serverUri)
        ready: port => `http://localhost:${port}/.well-known/openid-configuration`,
        // Disposable accounts through NSS's own registration endpoint (the form its register page posts).
        async provision(port) {
            for (const user of ["alice", "bob"]) {
                const password = `${user}-local-only-Pw1!`
                const response = await fetch(`http://localhost:${port}/api/accounts/new`, {
                    method: "POST",
                    redirect: "manual",
                    signal: AbortSignal.timeout(30_000),
                    body: new URLSearchParams({username: user, password, repeat_password: password, name: user, email: `${user}@interop.test`, acceptToc: "true"}),
                })
                await response.body?.cancel()
                if (response.status !== 302) throw new Error(`NSS account registration for ${user} answered ${response.status}`)
            }
        },
    },
}

/** `names` plus the services they require (e.g. Manas runs inside the CSS network namespace), dependencies first. */
export function withRequirements(names) {
    return [...new Set(names.flatMap(name => [...(services[name]?.requires ?? []), name]))]
}

/** Runs `docker compose` for `project`, killing it after `timeoutMs`. */
function compose(project, args, {quiet = false, timeoutMs = 300_000} = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn("docker", ["compose", "-f", "compose.yml", "-p", project, ...args], {
            cwd: directory,
            env: {...process.env, RA_INTEROP_PROJECT: project},
            stdio: ["ignore", "pipe", "pipe"],
        })
        let output = ""
        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            child.kill("SIGKILL")
        }, timeoutMs)
        child.stdout.on("data", d => { output += d })
        child.stderr.on("data", d => { output += d })
        child.on("error", error => {
            clearTimeout(timer)
            reject(error)
        })
        child.on("close", code => {
            clearTimeout(timer)
            if (code === 0 && !timedOut) return resolve(output)
            const why = timedOut ? `timed out after ${timeoutMs} ms` : `exited with ${code}`
            reject(new Error(`docker compose ${args[0]} ${why}${quiet ? "" : `: ${redact(output).slice(-2000)}`}`))
        })
    })
}

/** Whether nothing listens on 127.0.0.1:port (a TCP connect, protocol-agnostic). */
function portFree(port) {
    return new Promise(resolve => {
        const socket = connect({host: "127.0.0.1", port})
        socket.setTimeout(1000)
        socket.once("connect", () => { socket.destroy(); resolve(false) })
        socket.once("timeout", () => { socket.destroy(); resolve(true) })
        socket.once("error", () => resolve(true))
    })
}

async function waitReady(url, deadline) {
    let last = "no response"
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url, {signal: AbortSignal.timeout(5000)})
            await response.body?.cancel()
            if (response.ok) return
            last = `HTTP ${response.status}`
        } catch (error) {
            last = error.cause?.code ?? error.name
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error(`${url} not ready: ${last}`)
}

/**
 * Starts `names` under a new project. The whole start (image pulls, container creation and readiness) is bounded
 * by `timeoutMs`. `stop()` removes the project and throws if removal fails (the project name is in the message
 * for manual cleanup: `docker compose -p <project> down --volumes`).
 *
 * `onProject({project, stop})` is called as soon as the project exists, so an interrupted start can still be removed.
 *
 * @param {string[]} names services to start
 * @returns {Promise<{project: string, stop(): Promise<void>}>}
 */
export async function startStack(requested, {log = console.log, timeoutMs = 600_000, onProject = () => {}} = {}) {
    const names = withRequirements(requested)
    for (const name of names) {
        if (services[name] === undefined) throw new Error(`Unknown local service ${name}`)
        const port = services[name].port()
        if (!await portFree(port)) throw new Error(`Port ${port} for ${name} is already in use (another stack running? set RA_INTEROP_${name.toUpperCase()}_PORT or use --no-stack for an existing one)`)
    }
    if (names.some(name => services[name].tls)) ensureTestCertificates()
    const project = `ra-interop-${process.pid}-${randomBytes(3).toString("hex")}`
    const deadline = Date.now() + timeoutMs
    let stopped
    const stop = () => stopped ??= (async () => {
        log(`[stack] removing ${project}`)
        try {
            await compose(project, ["down", "--volumes", "--remove-orphans", "--timeout", "5"], {quiet: true, timeoutMs: 120_000})
        } catch (error) {
            throw new Error(`cleanup of Compose project ${project} failed (${error.message}); remove it with: docker compose -p ${project} down --volumes`)
        }
    })()
    onProject({project, stop})
    log(`[stack] starting ${names.join(", ")} as ${project}`)
    try {
        await compose(project, ["up", "--detach", ...names], {timeoutMs: Math.max(1, deadline - Date.now())})
        await Promise.all(names.map(name => waitReady(services[name].ready(services[name].port()), deadline)))
        /** `docker compose exec` in a service container, bounded like every other child process. */
        const exec = ({service, user, env = {}}, command) => compose(project, [
            "exec", "-T", ...(user === undefined ? [] : ["-u", user]), ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), service, ...command,
        ], {timeoutMs: 180_000})
        for (const name of names) await services[name].provision?.(services[name].port(), {exec})
        log(`[stack] ready`)
        return {project, stop}
    } catch (error) {
        const logs = await compose(project, ["logs", "--no-color", "--tail", "40"], {quiet: true, timeoutMs: 30_000}).catch(() => "")
        log(redact(logs))
        await stop().catch(cleanup => log(`[stack] ${cleanup.message}`))
        throw error
    }
}

/** For manual use: `node interop/local/stack.js up css keycloak` keeps the stack until Ctrl-C. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [command, ...names] = process.argv.slice(2)
    if (command !== "up" || names.length === 0) {
        console.error("usage: node interop/local/stack.js up <css|keycloak>...")
        process.exit(2)
    }
    let stack
    const shutdown = async () => {
        await stack?.stop()
        process.exit(0)
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
    await startStack(names, {onProject: handle => { stack = handle }})
    console.log("[stack] press Ctrl-C to stop and remove it")
    setInterval(() => {}, 1 << 30)
}
