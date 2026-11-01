// AUTHORED-BY Claude Opus 5.5
import { z } from "zod";

// Zod probes for JIT support with `Function("")`. The native export's CSP has no
// 'unsafe-eval', so the probe would raise a script-src violation on every launch.
// Interpreted parsing gives the same results without the probe.
z.config({ jitless: true });
