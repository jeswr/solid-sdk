// AUTHORED-BY Claude Opus 5.5
// Test-only helper shared by the package tests; excluded from the build (tsconfig.build.json).
import { createServer } from "node:http";

const handedOut = new Set<number>();

/**
 * A free port below Linux's ephemeral range (32768-60999). The port is written into a config and bound
 * later by the host, so an OS-assigned ephemeral port could be taken in between by an outgoing
 * connection from a parallel test (seen in CI as EADDRINUSE). Ports are never handed out twice
 * within one test file.
 */
export async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = 20_000 + Math.floor(Math.random() * 12_000);
    if (handedOut.has(port)) continue;
    const s = createServer();
    const bound = await new Promise<boolean>((r) => {
      s.once("error", () => r(false));
      s.listen(port, "127.0.0.1", () => r(true));
    });
    if (bound) {
      await new Promise<void>((r) => s.close(() => r()));
      handedOut.add(port);
      return port;
    }
  }
  throw new Error("No free port found below the ephemeral range");
}
