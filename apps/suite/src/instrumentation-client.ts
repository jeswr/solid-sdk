// AUTHORED-BY Claude Opus 5.5
import { config } from "zod/v4/core";

// Next runs this before any application module. Zod checks for JIT support with
// `Function("")` when it builds an object schema; the native export's CSP has no
// 'unsafe-eval', so that probe would raise a script-src violation on launch. Interpreted
// parsing gives the same results without it.
config({ jitless: true });
