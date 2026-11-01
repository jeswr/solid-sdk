// AUTHORED-BY Codex GPT-6.1-Sol
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCliConfig } from "./cli-config.js";
import { createCliFetch } from "./client-credentials.js";
import { createSolidMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = await loadCliConfig();
  const { podRoot, webId, readOnly } = config;
  const server = createSolidMcpServer({
    podRoot,
    webId,
    readOnly,
    fetch: await createCliFetch(config),
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[solid-mcp] connected (stdio). readOnly=${config.readOnly}\n`);
}

main().catch((error) => {
  // Config/auth errors deliberately contain no values or remote response bodies.
  process.stderr.write(
    `[solid-mcp] ${error instanceof Error ? error.message : "startup failed"}\n`,
  );
  process.exit(1);
});
