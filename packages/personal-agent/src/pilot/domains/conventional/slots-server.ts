#!/usr/bin/env node
/**
 * Run the SYNTHETIC local reference scheduling service as its own process (127.0.0.1 only).
 *   node dist/pilot/domains/conventional/slots-server.js --port 0 [--state FILE]
 * Prints one JSON readiness line with the API base, then serves until SIGTERM/SIGINT.
 * Not Calendly; creates no real appointment.
 */
import { parseArgs } from "node:util";
import { SlotsService, SYNTHETIC_NOTICE } from "./slots-service.js";

const { values } = parseArgs({
  options: { port: { type: "string" }, state: { type: "string" } },
  strict: true,
});
const service = new SlotsService(values.state);
const base = await service.listen(Number.parseInt(values.port ?? "0", 10));
process.stdout.write(
  `${JSON.stringify({ ready: true, base, pid: process.pid, notice: SYNTHETIC_NOTICE })}\n`,
);
const stop = () => {
  service.close().then(() => process.exit(0));
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
