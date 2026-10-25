#!/usr/bin/env node
// Interoperability runner: executes the library against real servers and providers listed in interop/targets/*.json and
// writes a sanitized report (PASS / FAIL / UNTESTED / UNSUPPORTED per target and scenario).
//
//   node interop/run.js --suite local --strict              # local containers (CI): all must pass
//   node interop/run.js --suite live --target github --require github --headed
//   node interop/run.js --list                              # targets, requirements and configuration state
//
// Every selected target is declared in the report before any setup, so a failed setup, adapter or teardown
// yields a FAILED verdict with the affected scenarios recorded — never an empty green report.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { adapterFor } from "./adapters/index.js"
import { loadManifest, resolveTarget, selectTargets } from "./lib/manifest.js"
import { Report } from "./lib/report.js"
import { applyRunConfig } from "./lib/runConfig.js"
import { Cleanups, runSelection } from "./lib/runner.js"

const browsers = ["chromium", "firefox", "webkit"]
let args
try {
    ({values: args} = parseArgs({options: {
        suite: {type: "string", default: "local"},
        target: {type: "string", multiple: true, default: []},
        require: {type: "string", multiple: true, default: []},
        strict: {type: "boolean", default: false},
        "verify-known-incompatible": {type: "boolean", default: false},
        "exercise-unverified": {type: "boolean", default: false},
        headed: {type: "boolean", default: false},
        browser: {type: "string", default: "chromium"},
        "report-dir": {type: "string", default: "interop/reports/latest"},
        "no-stack": {type: "boolean", default: false},
        list: {type: "boolean", default: false},
        config: {type: "string"},
    }}))
    if (!browsers.includes(args.browser)) throw new Error(`Unknown browser ${args.browser} (expected ${browsers.join(", ")})`)
} catch (error) {
    console.error(`[interop] ${error.message}`)
    process.exit(2)
}

const split = values => values.flatMap(v => v.split(",")).map(v => v.trim()).filter(Boolean)
const manifest = await loadManifest()

// Live credentials as one validated JSON document (--config <file> or RA_INTEROP_CONFIG); see interop/lib/runConfig.js.
{
    const source = args.config !== undefined ? readFileSync(args.config, "utf8") : process.env.RA_INTEROP_CONFIG
    if (source !== undefined && source !== "") {
        try {
            const declared = new Set(manifest.targets.flatMap(t => t.env.map(e => e.name)))
            const applied = applyRunConfig(source, declared)
            delete process.env.RA_INTEROP_CONFIG // applied; keep the raw document out of child processes
            process.on("exit", applied.cleanup)
            console.log(`[interop] run configuration: ${applied.variables.length} variable(s), ${applied.files.length} file(s)`)
        } catch (error) {
            console.error(`[interop] ${error.message}`)
            process.exit(2)
        }
    }
}

if (args.list) {
    for (const t of manifest.targets) {
        const {configured, missing} = resolveTarget(t)
        const state = t.blocked ? `blocked: ${t.blocked}` : configured ? "configured" : `missing ${missing.join(", ")}`
        console.log(`${t.id.padEnd(30)} ${t.category.padEnd(6)} ${t.adapter.padEnd(13)} ${state}`)
    }
    process.exit(0)
}

let targets
try {
    targets = selectTargets(manifest, {suite: args.suite, ids: split(args.target)})
} catch (error) {
    console.error(`[interop] ${error.message}`)
    process.exit(2)
}
const required = split(args.require)

// Local HTTPS servers use the harness's disposable test CA, which Node only accepts at start-up: re-run once
// with NODE_EXTRA_CA_CERTS pointing at it (nothing is installed system-wide).
{
    const { services } = await import("./local/stack.js")
    const needsTls = targets.some(t => t.category === "local" && services[t.stack]?.tls)
    const { caCertificate, ensureTestCertificates } = await import("./local/tls.js")
    if (needsTls && process.env.NODE_EXTRA_CA_CERTS !== caCertificate) {
        ensureTestCertificates()
        const { spawnSync } = await import("node:child_process")
        const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {stdio: "inherit", env: {...process.env, NODE_EXTRA_CA_CERTS: caCertificate}})
        process.exit(child.status ?? 1)
    }
}

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
let commit
try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim()
} catch {
    commit = undefined
}
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const report = new Report({
    library: {name: pkg.name, version: pkg.version, commit},
    runtime: {node: process.version, platform: process.platform, arch: process.arch},
    manifest: {schemaVersion: manifest.schemaVersion, census: manifest.census?.date},
    selection: {suite: args.suite, targets: targets.map(t => t.id), required, strict: args.strict, verifyKnownIncompatible: args["verify-known-incompatible"], exerciseUnverified: args["exercise-unverified"], headed: args.headed, browser: args.browser},
})

let interrupted = false
const cleanups = new Cleanups(report)
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
        interrupted = true
        console.error(`[interop] ${signal}: cleaning up`)
        await cleanups.teardown()
        process.exit(130) // the exit handler also removes materialized run-configuration files
    })
}

async function setup(register) {
    const local = targets.filter(t => t.category === "local" && resolveTarget(t).configured && t.blocked === undefined)
    const services = [...new Set(local.map(t => t.stack))]
    if (services.length > 0) {
        const stack = await import("./local/stack.js")
        if (!args["no-stack"]) await stack.startStack(services, {onProject: handle => register(`stack ${handle.project}`, handle.stop)})
        const { forwardIpv6Loopback } = await import("./lib/loopback.js")
        const forwarders = await forwardIpv6Loopback(stack.withRequirements(services).map(name => stack.services[name].port()))
        register("loopback forwarders", forwarders.close)
    }
    // No browser when nothing can run (every target unconfigured, blocked or needing --headed).
    const runnable = targets.some(t => {
        const {configured, config} = resolveTarget(t)
        return configured && t.blocked === undefined && (config.login?.recipe !== "manual" || args.headed || config.storageState !== undefined)
    })
    if (!runnable) return {browser: undefined}
    const playwright = await import("playwright")
    const browser = await playwright[args.browser].launch({headless: !args.headed})
    register("browser", () => browser.close())
    report.meta.runtime.browsers = `${args.browser} ${browser.version()}`
    return {browser}
}

await runSelection({report, targets, adapterFor, setup, cleanups, run: {runId, headed: args.headed, exerciseUnverified: args["exercise-unverified"], interrupted: () => interrupted}})

const options = {required, strict: args.strict, verifyKnownIncompatible: args["verify-known-incompatible"]}
const json = report.toJSON(options)
await mkdir(args["report-dir"], {recursive: true})
await writeFile(`${args["report-dir"]}/report.json`, JSON.stringify(json, null, 2) + "\n")
await writeFile(`${args["report-dir"]}/report.md`, report.toMarkdown(options))
console.log(`\n${Object.entries(json.totals).map(([k, v]) => `${k} ${v}`).join("  ")}`)
console.log(json.verdict.ok ? "Verdict: OK" : `Verdict: FAILED\n- ${json.verdict.problems.join("\n- ")}`)
console.log(`Report: ${args["report-dir"]}/report.md`)
process.exit(json.verdict.ok ? 0 : 1)
