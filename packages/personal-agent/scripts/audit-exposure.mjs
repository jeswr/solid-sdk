#!/usr/bin/env node
// Which baseline-audit packages does the BUILT pilot actually load? (requires `npm run build`)
// Registers a module resolve hook, imports the pilot entry points (nothing runs: cli.js only
// executes main when invoked directly), and prints the flagged packages that were resolved.
// Loading a package is exposure to its import-time code, not proof a vulnerable path is used.
import { registerHooks } from "node:module";

const FLAGGED = [
  "fast-uri",
  "ip-address",
  "nanoid",
  "postcss",
  "undici",
  "ajv",
  "express-rate-limit",
  "hono",
  "@hono/node-server",
  "qs",
  "@jeswr/guarded-fetch",
  "@modelcontextprotocol/sdk",
];
const loaded = new Map();
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(decodeURIComponent(r.url));
    if (m && FLAGGED.includes(m[1])) {
      const from = context.parentURL
        ? (/.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(
            decodeURIComponent(context.parentURL),
          )?.[1] ?? "pilot")
        : "entry";
      if (!loaded.has(m[1])) loaded.set(m[1], new Set());
      loaded.get(m[1]).add(from);
    }
    return r;
  },
});
const entries = ["../dist/pilot/index.js", "../dist/pilot/cli.js"];
for (const e of entries) await import(new URL(e, import.meta.url).href);
console.log(
  JSON.stringify(
    {
      entries,
      loaded: Object.fromEntries([...loaded].map(([k, v]) => [k, [...v].sort()])),
      notLoaded: FLAGGED.filter((f) => !loaded.has(f)),
    },
    null,
    2,
  ),
);
