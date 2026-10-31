// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer } from "node:http";
import { configuredRelay } from "./config.js";

const relay = configuredRelay();
const server = createServer(relay.handler);
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    relay.close();
    server.close();
  });
