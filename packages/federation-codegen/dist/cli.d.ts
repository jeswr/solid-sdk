#!/usr/bin/env node
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
export {};
//# sourceMappingURL=cli.d.ts.map