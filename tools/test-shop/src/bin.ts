#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
// Run the fictional shop standalone: `test-shop [--port N] [--host H]`.

import { startShop } from "./index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg("port") ?? process.env.PORT ?? 8787);
const host = arg("host") ?? "127.0.0.1";
const shop = await startShop({ port, host });
process.stdout.write(`shop.test fixture listening on ${shop.url}\n`);
process.stdout.write("Sign in as alex@example.test / correct-horse\n");
const stop = () => {
  shop.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
