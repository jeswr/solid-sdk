// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { transformSync } from "esbuild";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const packagingRoot = join(packageRoot, "packaging");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const sorted = (values) => [...values].sort();
const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);
const secret = (name) => /SECRET|PASSWORD|TOKEN(?!_URL$)|CLIENT_ID$/.test(name);

/** Inspect the loader's actual environment accesses; no parallel environment inventory. */
export function cliEnvironment(
  source = readFileSync(join(packageRoot, "src/cli-config.ts"), "utf8"),
) {
  // The package's TypeScript 7 compiler has no JS compiler API. Use the existing
  // esbuild parser to erase types/comments, then inspect the loader's literal accesses.
  const { code } = transformSync(source, { loader: "ts", legalComments: "none" });
  const names = new Set([...code.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]));
  for (const match of code.matchAll(/\benv\[([^\]]*)\]/g)) {
    const literal = /^"([A-Z][A-Z0-9_]+)"$/.exec(match[1]);
    assert(literal, "Dynamic CLI environment access needs explicit validator support");
    names.add(literal[1]);
  }
  assert(names.size > 0, "No CLI environment settings discovered");
  return sorted(names);
}

/** Query the real built server over MCP, with a transport that cannot access a pod. */
export async function registeredTools() {
  const { createSolidMcpServer } = await import("../dist/index.js");
  let requests = 0;
  const server = createSolidMcpServer({
    podRoot: "https://packaging.invalid/pod/",
    fetch: async () => {
      requests++;
      throw new Error("Packaging validation must never access a pod");
    },
  });
  const client = new Client({ name: "packaging-check", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const tools = [];
    let cursor;
    const seen = new Set();
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor) {
        assert(!seen.has(cursor), "Repeated tools/list cursor");
        seen.add(cursor);
      }
    } while (cursor);
    assert.equal(requests, 0, "Tool discovery accessed a pod");
    assert(tools.length > 0, "Empty server tool list");
    return tools.sort((a, b) => a.name.localeCompare(b.name, "en"));
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function safePath(root, path) {
  assert(typeof path === "string" && path.startsWith("./"), "Source must be relative");
  const target = realpathSync(resolve(root, path));
  const rel = relative(realpathSync(root), target);
  assert(rel && !rel.startsWith("..") && !isAbsolute(rel), "Source escapes marketplace");
  return target;
}

function schemaCheck(ajv, schema, value, label) {
  const validate = ajv.compile(schema);
  assert(validate(value), `${label}: ${ajv.errorsText(validate.errors)}`);
}

const string = { type: "string", minLength: 1 };
function object(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}
const comment = Object.fromEntries([["$comment", string]]);

/** Validate only local artifacts. This function never publishes or starts the CLI. */
export async function validatePackaging(
  root = packagingRoot,
  pkg = json(join(packageRoot, "package.json")),
) {
  const registry = json(join(root, "server.json"));
  const manifest = json(join(root, "mcpb/manifest.json"));
  const app = json(join(root, "chatgpt-app/app.json"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const [file, value] of [
    ["server.schema.json", registry],
    ["mcpb-manifest-v0.3.schema.json", manifest],
  ]) {
    schemaCheck(ajv, json(join(packagingRoot, "schemas", file)), value, file);
  }
  assert(!existsSync(join(packageRoot, "server.json")), "Keep server.json solely in packaging/");
  same(
    pkg.files,
    ["dist", "README.md", "LICENSE", "SKILL.md"],
    "Published files exclude packaging",
  );
  assert.equal(registry.name, "io.github.jeswr/solid-mcp");
  assert.equal(pkg.mcpName, registry.name, "npm mcpName must match the registry name");
  assert.equal(registry.version, pkg.version, "Registry version drift");
  assert.equal(registry.packages.length, 1);
  const npm = registry.packages[0];
  assert.equal(npm.identifier, pkg.name, "Registry package name drift");
  assert.equal(npm.version, pkg.version);
  assert.equal(npm.registryType, "npm");
  assert.equal(npm.runtimeHint, "npx");
  same(npm.transport, { type: "stdio" }, "Registry stdio transport");
  assert.equal(registry.remotes.length, 1);
  const remote = registry.remotes[0];
  assert.equal(remote.type, "streamable-http");
  assert.equal(remote.url, "https://{host}/mcp");
  same(Object.keys(remote.variables), ["host"], "Remote host variable");
  assert.equal(remote.variables.host.isRequired, true);
  assert.match(remote.variables.host.description, /operator.*apps\/mcp-server/i);

  const names = cliEnvironment();
  same(sorted(npm.environmentVariables.map((e) => e.name)), names, "Registry environment drift");
  const { loadCliConfig } = await import("../dist/index.js");
  const home = mkdtempSync(join(tmpdir(), "solid-mcp-config-check-"));
  const minimal = { SOLID_MCP_POD_ROOT: "https://packaging.invalid/pod/" };
  try {
    const defaults = await loadCliConfig(minimal, home);
    assert.equal(defaults.readOnly, true);
    for (const entry of npm.environmentVariables) {
      const env = { ...minimal };
      delete env[entry.name];
      let required = false;
      try {
        await loadCliConfig(env, home);
      } catch {
        required = true;
      }
      assert.equal(entry.isRequired, required, `${entry.name} requiredness drift`);
      assert.equal(entry.isSecret, secret(entry.name), `${entry.name} secret classification`);
      assert(!("value" in entry), "Registry must not embed environment values");
      if (secret(entry.name)) assert(!("default" in entry), "Secret default forbidden");
    }
    const readOnly = npm.environmentVariables.find((e) => e.name === "SOLID_MCP_READONLY");
    assert.equal(readOnly.default, String(defaults.readOnly));

    assert.equal(manifest.manifest_version, "0.3");
    assert.equal(manifest.name, pkg.name.split("/").at(-1), "MCPB name drift");
    assert.equal(manifest.version, pkg.version, "MCPB version drift");
    assert.equal(manifest.compatibility.runtimes.node, pkg.engines.node);
    assert.equal(manifest.server.type, "node");
    assert.equal(manifest.server.entry_point, pkg.bin[manifest.name].replace(/^\.\//, ""));
    assert.equal(manifest.server.mcp_config.command, "node");
    same(manifest.server.mcp_config.args, [`\${__dirname}/${manifest.server.entry_point}`]);
    const config = manifest.user_config;
    same(sorted(Object.keys(config)), sorted(Object.keys(manifest.server.mcp_config.env)));
    const sample = {};
    for (const [name, option] of Object.entries(config)) {
      assert(names.includes(name), `Unknown MCPB setting ${name}`);
      assert.equal(manifest.server.mcp_config.env[name], `\${user_config.${name}}`);
      assert.equal(option.sensitive, secret(name), `${name} sensitive flag`);
      assert(!secret(name) || !("default" in option), "Secret default forbidden");
      if (option.type === "boolean") {
        assert.equal(name, "SOLID_MCP_READONLY");
        assert.equal(option.default, defaults.readOnly);
        sample[name] = String(option.default);
      } else {
        // Empty optional strings are invalid CLI configuration. Require a value instead.
        assert.equal(option.required, true, `${name} must not expand an empty optional string`);
        sample[name] = /ROOT|ISSUER|URL/.test(name) ? minimal.SOLID_MCP_POD_ROOT : "fixture";
      }
    }
    for (const entry of npm.environmentVariables.filter((e) => e.isRequired)) {
      assert.equal(
        config[entry.name]?.required,
        true,
        `Missing required MCPB setting ${entry.name}`,
      );
    }
    const resolved = await loadCliConfig(sample, home);
    assert(
      resolved.clientId && resolved.clientSecret && resolved.oidcIssuer,
      "MCPB must collect a complete issuer-based CSS credential group",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  const tools = await registeredTools();
  const toolNames = tools.map((tool) => tool.name);
  same(
    manifest.tools.map((tool) => tool.name),
    toolNames,
    "MCPB tools/list drift",
  );
  assert.equal(manifest.tools_generated, false);

  const marketplaceRoot = join(root, "claude-plugin");
  const marketplace = json(join(marketplaceRoot, ".claude-plugin/marketplace.json"));
  schemaCheck(
    ajv,
    object({
      name: { const: "solid-suite" },
      owner: object({ name: { const: "Jesse Wright" } }),
      metadata: object({ description: string }),
      plugins: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: object({
          name: { enum: ["solid-pod", "solid-pod-local"] },
          source: { enum: ["./plugins/solid-pod", "./plugins/solid-pod-local"] },
          description: string,
        }),
      },
    }),
    marketplace,
    "marketplace.json",
  );
  same(
    sorted(marketplace.plugins.map((entry) => entry.name)),
    ["solid-pod", "solid-pod-local"],
    "Marketplace must contain both plugins exactly once",
  );
  for (const entry of marketplace.plugins) {
    assert.equal(entry.source, `./plugins/${entry.name}`, "Marketplace source/name mismatch");
    const pluginRoot = safePath(marketplaceRoot, entry.source);
    const plugin = json(join(pluginRoot, ".claude-plugin/plugin.json"));
    schemaCheck(
      ajv,
      object({
        name: { const: entry.name },
        version: { const: pkg.version },
        description: string,
        author: object({ name: { const: "Jesse Wright" } }),
        license: { const: "MIT" },
      }),
      plugin,
      `${entry.name}/plugin.json`,
    );
    const server =
      entry.name === "solid-pod"
        ? object({ type: { const: "http" }, url: { const: `\${SOLID_MCP_URL}` } })
        : object({
            type: { const: "stdio" },
            command: { const: "npx" },
            args: { const: ["-y", pkg.name] },
            env: object({
              SOLID_MCP_POD_ROOT: { const: `\${SOLID_MCP_POD_ROOT}` },
              SOLID_MCP_READONLY: { const: `\${SOLID_MCP_READONLY:-true}` },
            }),
          });
    schemaCheck(
      ajv,
      object({ mcpServers: object({ [entry.name]: server }) }),
      json(join(pluginRoot, ".mcp.json")),
      `${entry.name}/.mcp.json`,
    );
    if (entry.name === "solid-pod-local") {
      assert(!existsSync(join(pluginRoot, "hooks")), "Local plugin must remain stdio-only");
    }
  }
  const pluginRoot = safePath(marketplaceRoot, "./plugins/solid-pod");
  const hooks = json(join(pluginRoot, "hooks/hooks.json"));
  const hook = {
    type: "array",
    minItems: 1,
    maxItems: 1,
    items: object({
      hooks: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        items: object({
          type: { const: "command" },
          command: { const: "solid-capture claude" },
          timeout: { const: 30 },
        }),
      },
    }),
  };
  schemaCheck(
    ajv,
    object({ hooks: object({ SessionEnd: hook, PreCompact: hook }) }),
    hooks,
    "hooks.json",
  );
  assert(existsSync(join(pluginRoot, "skills/README.md")), "Missing skills placeholder");

  schemaCheck(
    ajv,
    object({
      ...comment,
      descriptor_type: { const: "solid-sdk-preparation-only" },
      display_name: string,
      description: string,
      version: { const: pkg.version },
      mcp_server: object({
        transport: { const: remote.type },
        url_template: { const: remote.url },
      }),
      auth: object({
        type: { const: "oauth" },
        dynamic_client_registration: { const: true },
        pkce: object({ required: { const: true }, method: { const: "S256" } }),
      }),
      tools: { type: "array", items: object({ name: string, readOnly: { type: "boolean" } }) },
      privacy_policy_url: { type: "string", format: "uri" },
    }),
    app,
    "app.json (our preparation descriptor)",
  );
  same(
    app.tools.map((tool) => tool.name),
    toolNames,
    "ChatGPT tools/list drift",
  );
  for (const tool of tools) {
    assert.equal(
      typeof tool.annotations?.readOnlyHint,
      "boolean",
      `${tool.name} lacks readOnlyHint`,
    );
    assert.equal(
      app.tools.find((t) => t.name === tool.name).readOnly,
      tool.annotations.readOnlyHint,
      `${tool.name} read-only classification drift`,
    );
  }
  return { tools: toolNames.length, environmentVariables: names.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await validatePackaging();
    console.log(
      `Packaging valid (offline): ${result.tools} tools, ${result.environmentVariables} CLI settings. Prepared only.`,
    );
  } catch (error) {
    console.error(`Packaging validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
