#!/usr/bin/env node
// AUTHORED-BY Claude Opus 4.8
/**
 * The Mode-A codegen CLI (design §3.1): `federation-codegen gen` runs the pipeline
 * in-repo and writes the artifacts into a committed, diffable output directory,
 * hash-pinned by `codegen.lock.json`. Every run verifies fetched/read input bytes
 * against the lock and FAILS CLOSED on mismatch; an intentional bump goes through
 * `--update-lock`.
 *
 * Usage:
 *   federation-codegen gen --ontology <ttl> --shapes <ttl> --config <json>
 *                          --out <dir> [--lock <json>] [--update-lock]
 *                          [--allow-unadmitted]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitLockfile, generateModel } from "./generate.js";
function parseArgs(argv) {
    const args = { updateLock: false, allowUnadmitted: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--ontology":
                args.ontology = argv[++i];
                break;
            case "--shapes":
                args.shapes = argv[++i];
                break;
            case "--config":
                args.config = argv[++i];
                break;
            case "--out":
                args.out = argv[++i];
                break;
            case "--lock":
                args.lock = argv[++i];
                break;
            case "--update-lock":
                args.updateLock = true;
                break;
            case "--allow-unadmitted":
                args.allowUnadmitted = true;
                break;
            default:
                throw new Error(`unknown argument: ${a}`);
        }
    }
    return args;
}
function fail(message) {
    process.stderr.write(`federation-codegen: ${message}\n`);
    process.exit(1);
}
function run(argv) {
    const command = argv[0];
    if (command !== "gen")
        fail(`unknown command "${command ?? ""}" (expected: gen)`);
    const args = parseArgs(argv.slice(1));
    if (!args.ontology || !args.shapes || !args.config || !args.out) {
        fail("gen requires --ontology, --shapes, --config, and --out");
    }
    const ontologyTtl = readFileSync(args.ontology, "utf8");
    const shapesTtl = readFileSync(args.shapes, "utf8");
    const config = JSON.parse(readFileSync(args.config, "utf8"));
    const input = { ontologyTtl, shapesTtl, config };
    if (args.allowUnadmitted)
        input.allowUnadmitted = true;
    const lockPath = args.lock ?? join(args.out, "codegen.lock.json");
    const freshLock = emitLockfile(input);
    // Verify against the committed lock (fail closed on input drift) unless updating.
    let existingLock;
    try {
        existingLock = readFileSync(lockPath, "utf8");
    }
    catch {
        existingLock = undefined;
    }
    if (existingLock !== undefined && existingLock !== freshLock && !args.updateLock) {
        fail(`input hashes differ from ${lockPath} — a fetched input changed. ` +
            "Re-run with --update-lock to accept the new inputs (review the diff first).");
    }
    const result = generateModel(input);
    mkdirSync(args.out, { recursive: true });
    for (const [name, content] of Object.entries(result.artifacts)) {
        writeFileSync(join(args.out, name), content);
    }
    writeFileSync(lockPath, freshLock);
    const violations = result.admission.violations.length;
    process.stdout.write(`federation-codegen: generated ${Object.keys(result.artifacts).length} artifact(s) into ${args.out}\n` +
        `  admission: ${result.admission.ok ? "OK" : `${violations} violation(s) (allow-unadmitted)`}\n` +
        `  entities: ${result.manifest.entities.map((e) => e.name).join(", ")}\n`);
}
run(process.argv.slice(2));
//# sourceMappingURL=cli.js.map