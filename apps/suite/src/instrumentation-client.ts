// AUTHORED-BY Claude Opus 5.5
import { config } from "zod/v4/core";
import { ensureDisposeSymbols } from "./lib/symbol-dispose";

// Next runs this before any application module. Zod checks for JIT support with
// `Function("")` when it builds an object schema; the native export's CSP has no
// 'unsafe-eval', so that probe would raise a script-src violation on launch. Interpreted
// parsing gives the same results without it.
config({ jitless: true });

// Sign-in code uses `using`; older WebViews (Android System WebView 124) lack the
// disposal symbols it needs. Define them before any application module runs.
ensureDisposeSymbols();
