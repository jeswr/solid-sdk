// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { Server } from "node:net";
import { dirname } from "node:path";
import { AppRunner } from "@solid/community-server";
import { cssComponentState } from "./component-state.mjs";

// CSS 7.2's ServerInitializer calls listen(port) without a host option. Restrict that
// call inside this disposable child process so neither test server binds publicly.
const listen = Server.prototype.listen;
const listening = [];
Server.prototype.listen = function loopbackListen(...args) {
  if (typeof args[0] !== "number") throw new Error("Expected CSS to listen on a numeric port");
  listening.push(
    new Promise((resolve, reject) => {
      this.once("listening", resolve);
      this.once("error", reject);
    }),
  );
  return Reflect.apply(listen, this, [{ port: args[0], host: "127.0.0.1" }, ...args.slice(1)]);
};

const [config, port, directory] = process.argv.slice(2);
let app;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await app?.stop();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", stop);
try {
  const require = createRequire(import.meta.url);
  const cssDirectory = dirname(require.resolve("@solid/community-server/package.json"));
  app = await new AppRunner().create({
    loaderProperties: {
      moduleState: await cssComponentState(cssDirectory),
      logLevel: process.env.CSS_DEBUG ? "warn" : "error",
    },
    config,
    shorthand: {
      port: Number(port),
      baseUrl: `http://localhost:${port}/`,
      rootFilePath: directory,
      loggingLevel: process.env.CSS_DEBUG ? "warn" : "error",
    },
  });
  await app.start();
  await Promise.all(listening);
  if (!listening.length) throw new Error("CSS did not start an HTTP listener");
  process.send?.({ ready: true });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  process.disconnect?.();
}
