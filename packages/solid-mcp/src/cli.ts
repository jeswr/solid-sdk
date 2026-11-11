// AUTHORED-BY Codex GPT-6.1-Sol
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCliConfig, parseCliArguments } from "./cli-config.js";
import { createCliFetch } from "./client-credentials.js";
import { setupSharedContext } from "./context-tools.js";
import { createFetchPodPort } from "./pod-port.js";
import { createSolidMcpServer } from "./server.js";

async function main(): Promise<void> {
  const args = parseCliArguments(process.argv.slice(2));
  const config = await loadCliConfig();
  if (args.command === "context-init") {
    if (!config.webId) throw new Error("context-init requires a configured owner WebID");
    const pod = createFetchPodPort({
      ...config,
      readOnly: false,
      fetch: await createCliFetch(config),
    });
    const result = await setupSharedContext(pod, {
      webId: config.webId,
      initialText: args.initialText,
    });
    process.stderr.write(`[solid-mcp] ${JSON.stringify(result)}\n`);
    if (result.status === "error") process.exitCode = 1;
    return;
  }
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
