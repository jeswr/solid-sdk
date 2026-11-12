// AUTHORED-BY Codex GPT-6.1-Sol
import { execFileSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { stageMcpb, thirdPartyNotices, zipStage } from "../scripts/build-mcpb.mjs";
import {
  cliEnvironment,
  packageRoot,
  packagingRoot,
  registeredTools,
  validatePackaging,
} from "../scripts/validate-packaging.mjs";

const scratch = [];
function temp() {
  const path = mkdtempSync(join(tmpdir(), "solid-mcp-packaging-test-"));
  scratch.push(path);
  return path;
}
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const path = temp();
  cpSync(packagingRoot, path, {
    recursive: true,
    filter: (file) => file !== join(packagingRoot, "out"),
  });
  return path;
}
const registry = "server.json";
const manifest = "mcpb/manifest.json";
const app = "chatgpt-app/app.json";
const marketplace = "claude-plugin/.claude-plugin/marketplace.json";
const plugin = "claude-plugin/plugins/solid-pod/.claude-plugin/plugin.json";
const mcp = "claude-plugin/plugins/solid-pod/.mcp.json";
const localMcp = "claude-plugin/plugins/solid-pod-local/.mcp.json";
const localPlugin = "claude-plugin/plugins/solid-pod-local/.claude-plugin/plugin.json";
const hooks = "claude-plugin/plugins/solid-pod/hooks/hooks.json";
function edit(root, path, mutate) {
  const file = join(root, path);
  const value = JSON.parse(readFileSync(file, "utf8"));
  mutate(value);
  writeFileSync(file, JSON.stringify(value));
}

// Resolve the documented Claude variable syntax without invoking a client or shell.
function expandEnvironment(value, env) {
  return JSON.parse(
    JSON.stringify(value).replace(/\$\{([A-Z_]+)(?::-([^}]*))?\}/g, (_match, name, fallback) => {
      const resolved = env[name] ?? fallback;
      if (resolved === undefined) throw new Error(`Missing environment variable ${name}`);
      return JSON.stringify(resolved).slice(1, -1);
    }),
  );
}

function runNode(args, cwd, env, input = "") {
  const io = temp();
  writeFileSync(join(io, "stdin"), input);
  const fds = [
    openSync(join(io, "stdin"), "r"),
    openSync(join(io, "stdout"), "w"),
    openSync(join(io, "stderr"), "w"),
  ];
  try {
    // File descriptors also work in sandboxes which deny child-process pipes.
    execFileSync(process.execPath, args, { cwd, env, stdio: fds, timeout: 20_000 });
  } catch (error) {
    throw new Error(`Node child failed: ${readFileSync(join(io, "stderr"), "utf8")}`, {
      cause: error,
    });
  } finally {
    fds.forEach(closeSync);
  }
  return readFileSync(join(io, "stdout"), "utf8");
}

describe("offline packaging validation", () => {
  it("validates the checked-in artifacts through the executable validator", () => {
    expect(runNode([join(packageRoot, "scripts/validate-packaging.mjs")], temp())).toMatch(
      /Packaging valid \(offline\): \d+ tools, \d+ CLI settings/,
    );
  });

  it("extracts env accesses after parsing TypeScript, ignoring comments and refusing computed keys", () => {
    expect(
      cliEnvironment('/* env.FAKE */ const x: string = env.ONE; const y = env["TWO"];'),
    ).toEqual(["ONE", "TWO"]);
    expect(() => cliEnvironment("const x = env[key];")).toThrow(/Dynamic CLI environment/);
    expect(() => cliEnvironment("const x = 1;")).toThrow(/No CLI environment/);
  });

  it.each([
    undefined,
    "io.github.other/solid-mcp",
  ])("rejects npm ownership mcpName %s", async (mcpName) => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    await expect(validatePackaging(packagingRoot, { ...pkg, mcpName })).rejects.toThrow(
      /npm mcpName must match/,
    );
  });

  it("resolves the remote plugin with only SOLID_MCP_URL", () => {
    const config = JSON.parse(readFileSync(join(packagingRoot, mcp), "utf8"));
    const url = "https://operator.example/mcp";
    expect(expandEnvironment(config, { SOLID_MCP_URL: url })).toEqual({
      mcpServers: { "solid-pod": { type: "http", url } },
    });
    expect(() => expandEnvironment(config, {})).toThrow(/SOLID_MCP_URL/);
  });

  it.each([
    "oidcIssuer",
    "tokenUrl",
  ])("loads local %s authentication from a private file with optional env unset", async (endpoint) => {
    const home = temp();
    const directory = join(home, ".config/solid-mcp");
    mkdirSync(directory, { recursive: true });
    const file = {
      podRoot: "https://file.example/pod/",
      webId: "https://owner.example/profile#me",
      clientId: "fixture-id",
      clientSecret: "fixture-secret",
      [endpoint]: "https://issuer.example/",
      readOnly: false,
    };
    writeFileSync(join(directory, "config.json"), JSON.stringify(file), { mode: 0o600 });
    const config = JSON.parse(readFileSync(join(packagingRoot, localMcp), "utf8"));
    const env = { SOLID_MCP_POD_ROOT: "https://shell.example/pod/" };
    const { loadCliConfig } = await import("../dist/index.js");
    const defaults = expandEnvironment(config, env).mcpServers["solid-pod-local"];
    expect(defaults.env).toEqual({ ...env, SOLID_MCP_READONLY: "true" });
    expect(await loadCliConfig(defaults.env, home)).toEqual({
      ...file,
      podRoot: env.SOLID_MCP_POD_ROOT,
      readOnly: true,
    });
    const writable = expandEnvironment(config, { ...env, SOLID_MCP_READONLY: "false" });
    expect((await loadCliConfig(writable.mcpServers["solid-pod-local"].env, home)).readOnly).toBe(
      false,
    );
    expect(() => expandEnvironment(config, {})).toThrow(/SOLID_MCP_POD_ROOT/);
    delete file.clientSecret;
    writeFileSync(join(directory, "config.json"), JSON.stringify(file));
    await expect(loadCliConfig(defaults.env, home)).rejects.toThrow(/Client credentials require/);
  });

  it.each([
    [
      "registry schema required field",
      registry,
      (v) => {
        delete v.description;
      },
      /server.schema/,
    ],
    [
      "registry schema invalid format",
      registry,
      (v) => {
        v.repository.url = "bad url";
      },
      /server.schema/,
    ],
    [
      "registry name",
      registry,
      (v) => {
        v.name = "io.github.other/solid-mcp";
      },
      /solid-mcp/,
    ],
    [
      "registry version",
      registry,
      (v) => {
        v.version = "999.0.0";
      },
      /version drift/,
    ],
    [
      "npm name",
      registry,
      (v) => {
        v.packages[0].identifier = "@other/solid-mcp";
      },
      /name drift/,
    ],
    [
      "npm version",
      registry,
      (v) => {
        v.packages[0].version = "999.0.0";
      },
      /999.0.0/,
    ],
    [
      "npm transport",
      registry,
      (v) => {
        v.packages[0].transport = { type: "sse", url: "https://host/mcp" };
      },
      /stdio/,
    ],
    [
      "npm runtime",
      registry,
      (v) => {
        v.packages[0].runtimeHint = "node";
      },
      /npx/,
    ],
    [
      "missing CLI env",
      registry,
      (v) => {
        v.packages[0].environmentVariables.pop();
      },
      /environment drift/,
    ],
    [
      "extra CLI env",
      registry,
      (v) => {
        v.packages[0].environmentVariables.push({ name: "SOLID_MCP_TOKEN" });
      },
      /environment drift/,
    ],
    [
      "duplicate CLI env",
      registry,
      (v) => {
        v.packages[0].environmentVariables.push(v.packages[0].environmentVariables[0]);
      },
      /environment drift/,
    ],
    [
      "required env",
      registry,
      (v) => {
        v.packages[0].environmentVariables[0].isRequired = false;
      },
      /requiredness drift/,
    ],
    [
      "secret flag",
      registry,
      (v) => {
        v.packages[0].environmentVariables.find((e) => e.name.endsWith("SECRET")).isSecret = false;
      },
      /secret classification/,
    ],
    [
      "secret default",
      registry,
      (v) => {
        v.packages[0].environmentVariables.find((e) => e.name.endsWith("SECRET")).default =
          "fixture";
      },
      /Secret default/,
    ],
    [
      "embedded credential",
      registry,
      (v) => {
        v.packages[0].environmentVariables[0].value = "fixture";
      },
      /embed environment/,
    ],
    [
      "readonly default",
      registry,
      (v) => {
        v.packages[0].environmentVariables.find((e) => e.name.endsWith("READONLY")).default =
          "false";
      },
      /false/,
    ],
    [
      "remote template",
      registry,
      (v) => {
        v.remotes[0].url = "https://elsewhere/mcp";
      },
      /host/,
    ],
    [
      "remote variable",
      registry,
      (v) => {
        v.remotes[0].variables = {};
      },
      /host/,
    ],
    [
      "MCPB schema",
      manifest,
      (v) => {
        v.server.type = "invalid";
      },
      /mcpb-manifest/,
    ],
    [
      "MCPB unknown key",
      manifest,
      (v) => {
        v.extra = true;
      },
      /mcpb-manifest/,
    ],
    [
      "MCPB version",
      manifest,
      (v) => {
        v.version = "999.0.0";
      },
      /MCPB version/,
    ],
    [
      "MCPB name",
      manifest,
      (v) => {
        v.name = "other";
      },
      /MCPB name/,
    ],
    [
      "MCPB Node version",
      manifest,
      (v) => {
        v.compatibility.runtimes.node = ">=18";
      },
      />=24/,
    ],
    [
      "MCPB entry point",
      manifest,
      (v) => {
        v.server.entry_point = "../cli.js";
      },
      /dist\/cli/,
    ],
    [
      "MCPB missing required setting",
      manifest,
      (v) => {
        delete v.user_config.SOLID_MCP_POD_ROOT;
        delete v.server.mcp_config.env.SOLID_MCP_POD_ROOT;
      },
      /Missing required MCPB/,
    ],
    [
      "MCPB unknown setting",
      manifest,
      (v) => {
        v.user_config.EXTRA = { ...v.user_config.SOLID_MCP_POD_ROOT };
        v.server.mcp_config.env.EXTRA = "fixture";
      },
      /Unknown MCPB/,
    ],
    [
      "MCPB optional empty string",
      manifest,
      (v) => {
        v.user_config.SOLID_MCP_CLIENT_ID.required = false;
      },
      /empty optional/,
    ],
    [
      "MCPB missing sensitivity",
      manifest,
      (v) => {
        v.user_config.SOLID_MCP_CLIENT_SECRET.sensitive = false;
      },
      /sensitive flag/,
    ],
    [
      "MCPB secret default",
      manifest,
      (v) => {
        v.user_config.SOLID_MCP_CLIENT_SECRET.default = "fixture";
      },
      /Secret default/,
    ],
    [
      "MCPB read-only default",
      manifest,
      (v) => {
        v.user_config.SOLID_MCP_READONLY.default = false;
      },
      /false/,
    ],
    [
      "MCPB configuration substitution",
      manifest,
      (v) => {
        v.server.mcp_config.env.SOLID_MCP_CLIENT_ID = "fixture";
      },
      /user_config/,
    ],
    [
      "MCPB incomplete auth",
      manifest,
      (v) => {
        delete v.user_config.SOLID_MCP_CLIENT_SECRET;
        delete v.server.mcp_config.env.SOLID_MCP_CLIENT_SECRET;
      },
      /Client credentials require/,
    ],
    [
      "MCPB anonymous fallback",
      manifest,
      (v) => {
        for (const name of [
          "SOLID_MCP_CLIENT_ID",
          "SOLID_MCP_CLIENT_SECRET",
          "SOLID_MCP_OIDC_ISSUER",
        ]) {
          delete v.user_config[name];
          delete v.server.mcp_config.env[name];
        }
      },
      /complete issuer-based CSS credential group/,
    ],
    [
      "MCPB missing tool",
      manifest,
      (v) => {
        v.tools.pop();
      },
      /tools\/list drift/,
    ],
    [
      "MCPB extra tool",
      manifest,
      (v) => {
        v.tools.push({ name: "invented" });
      },
      /tools\/list drift/,
    ],
    [
      "MCPB duplicate tool",
      manifest,
      (v) => {
        v.tools.push(v.tools[0]);
      },
      /tools\/list drift/,
    ],
    [
      "marketplace plugin name",
      marketplace,
      (v) => {
        v.plugins[0].name = "other";
      },
      /marketplace.json/,
    ],
    [
      "marketplace source traversal",
      marketplace,
      (v) => {
        v.plugins[0].source = "../../outside";
      },
      /marketplace.json/,
    ],
    [
      "missing local marketplace plugin",
      marketplace,
      (v) => {
        v.plugins.pop();
      },
      /marketplace.json/,
    ],
    [
      "duplicate marketplace plugin",
      marketplace,
      (v) => {
        v.plugins[1] = v.plugins[0];
      },
      /both plugins exactly once/,
    ],
    [
      "marketplace source mismatch",
      marketplace,
      (v) => {
        v.plugins[1].source = v.plugins[0].source;
      },
      /source\/name mismatch/,
    ],
    [
      "plugin version",
      plugin,
      (v) => {
        v.version = "999.0.0";
      },
      /plugin.json/,
    ],
    [
      "local plugin version",
      localPlugin,
      (v) => {
        v.version = "999.0.0";
      },
      /plugin.json/,
    ],
    [
      "remote plugin URL",
      mcp,
      (v) => {
        v.mcpServers["solid-pod"].url = "http://elsewhere";
      },
      /\.mcp.json/,
    ],
    [
      "remote plugin local server",
      mcp,
      (v) => {
        v.mcpServers["solid-pod-local"] = { type: "stdio", command: "npx" };
      },
      /\.mcp.json/,
    ],
    [
      "remote plugin comment",
      mcp,
      (v) => {
        v.$comment = "unsupported";
      },
      /\.mcp.json/,
    ],
    [
      "local plugin comment",
      localMcp,
      (v) => {
        v.$comment = "unsupported";
      },
      /\.mcp.json/,
    ],
    [
      "local plugin remote server",
      localMcp,
      (v) => {
        v.mcpServers["solid-pod"] = { type: "http", url: `\${SOLID_MCP_URL}` };
      },
      /\.mcp.json/,
    ],
    [
      "local plugin env missing",
      localMcp,
      (v) => {
        delete v.mcpServers["solid-pod-local"].env.SOLID_MCP_READONLY;
      },
      /\.mcp.json/,
    ],
    [
      "local plugin literal secret",
      localMcp,
      (v) => {
        v.mcpServers["solid-pod-local"].env.SOLID_MCP_CLIENT_SECRET = "fixture";
      },
      /\.mcp.json/,
    ],
    ...["SOLID_MCP_CLIENT_SECRET", "SOLID_MCP_OIDC_ISSUER", "SOLID_MCP_TOKEN_URL"].map((name) => [
      `local plugin optional env expansion ${name}`,
      localMcp,
      (v) => {
        v.mcpServers["solid-pod-local"].env[name] = `\${${name}}`;
      },
      /\.mcp.json/,
    ]),
    [
      "local plugin missing readonly default",
      localMcp,
      (v) => {
        v.mcpServers["solid-pod-local"].env.SOLID_MCP_READONLY = `\${SOLID_MCP_READONLY}`;
      },
      /\.mcp.json/,
    ],
    [
      "local plugin writable default",
      localMcp,
      (v) => {
        v.mcpServers["solid-pod-local"].env.SOLID_MCP_READONLY = `\${SOLID_MCP_READONLY:-false}`;
      },
      /\.mcp.json/,
    ],
    [
      "hooks comment",
      hooks,
      (v) => {
        v.$comment = "unsupported";
      },
      /hooks.json/,
    ],
    [
      "hook timeout",
      hooks,
      (v) => {
        v.hooks.SessionEnd[0].hooks[0].timeout = 15;
      },
      /hooks.json/,
    ],
    [
      "hook shell path interpolation",
      hooks,
      (v) => {
        v.hooks.PreCompact[0].hooks[0].command += " --transcript $(cat)";
      },
      /hooks.json/,
    ],
    [
      "hook missing event",
      hooks,
      (v) => {
        delete v.hooks.PreCompact;
      },
      /hooks.json/,
    ],
    [
      "ChatGPT descriptor discriminator",
      app,
      (v) => {
        v.descriptor_type = "openai";
      },
      /app.json/,
    ],
    [
      "ChatGPT token auth",
      app,
      (v) => {
        v.auth.type = "bearer";
      },
      /app.json/,
    ],
    [
      "ChatGPT missing DCR",
      app,
      (v) => {
        v.auth.dynamic_client_registration = false;
      },
      /app.json/,
    ],
    [
      "ChatGPT PKCE downgrade",
      app,
      (v) => {
        v.auth.pkce.method = "plain";
      },
      /app.json/,
    ],
    [
      "ChatGPT tool drift",
      app,
      (v) => {
        v.tools.pop();
      },
      /tools\/list drift/,
    ],
    [
      "ChatGPT write hint",
      app,
      (v) => {
        v.tools.find((t) => t.name === "pod_write").readOnly = true;
      },
      /read-only classification/,
    ],
    [
      "ChatGPT read hint",
      app,
      (v) => {
        v.tools.find((t) => t.name === "search").readOnly = false;
      },
      /read-only classification/,
    ],
    [
      "ChatGPT privacy URL",
      app,
      (v) => {
        v.privacy_policy_url = "not a url";
      },
      /app.json/,
    ],
  ])("rejects %s", async (_label, path, mutate, message) => {
    const root = fixture();
    edit(root, path, mutate);
    await expect(validatePackaging(root)).rejects.toThrow(message);
  });

  it("refuses a missing plugin source", async () => {
    const root = fixture();
    rmSync(join(root, "claude-plugin/plugins/solid-pod"), { recursive: true });
    await expect(validatePackaging(root)).rejects.toThrow(/ENOENT/);
  });
  it("refuses a plugin source symlink escaping the marketplace", async () => {
    const root = fixture();
    const path = join(root, "claude-plugin/plugins/solid-pod");
    rmSync(path, { recursive: true });
    symlinkSync(temp(), path);
    await expect(validatePackaging(root)).rejects.toThrow(/escapes marketplace/);
  });
  it("refuses capture hooks in the stdio-only plugin", async () => {
    const root = fixture();
    mkdirSync(join(root, "claude-plugin/plugins/solid-pod-local/hooks"));
    await expect(validatePackaging(root)).rejects.toThrow(/stdio-only/);
  });
});

describe("third-party bundle notices", () => {
  function input(root, path, pkg, licenses = { LICENSE: "Fixture license text\n" }) {
    const directory = join(root, path);
    mkdirSync(join(directory, "lib"), { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(directory, "lib/package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(directory, "lib/index.js"), "// Fixture bundle input\n");
    for (const [name, text] of Object.entries(licenses)) {
      writeFileSync(join(directory, name), text);
    }
    return `${path}/lib/index.js`;
  }

  it("sorts names, versions and license files, resolves symlinks, and deduplicates packages", () => {
    const root = temp();
    const zed = input(root, "node_modules/zed", { name: "zed", version: "1.0.0", license: "MIT" });
    const old = input(
      root,
      "node_modules/.pnpm/alpha-old/node_modules/alpha",
      { name: "alpha", version: "1.0.0", license: "MIT OR Apache-2.0" },
      { "LICENSE.MIT": "MIT text\n", "LICENSE.Apache": "Apache text\n" },
    );
    const newer = input(
      root,
      "node_modules/alpha",
      { name: "alpha", version: "2.0.0", license: "ISC" },
      { "license.txt": "ISC text" },
    );
    symlinkSync(join(root, "node_modules/alpha"), join(root, "node_modules/alias"));
    const inputs = Object.fromEntries(
      [zed, newer, old, "node_modules/alias/lib/index.js"].map((path) => [path, {}]),
    );
    const notices = thirdPartyNotices({ inputs }, root);
    expect(notices).toBe(
      thirdPartyNotices({ inputs: Object.fromEntries(Object.entries(inputs).reverse()) }, root),
    );
    expect(
      [...notices.matchAll(/^Package: (.+)\nVersion: (.+)$/gm)].map((m) => [m[1], m[2]]),
    ).toEqual([
      ["alpha", "1.0.0"],
      ["alpha", "2.0.0"],
      ["zed", "1.0.0"],
    ]);
    expect(notices).toContain(
      "License: MIT OR Apache-2.0\n\n--- LICENSE.Apache ---\nApache text\n",
    );
    expect(notices).toContain("--- LICENSE.MIT ---\nMIT text\n");
    expect(notices).toContain("--- license.txt ---\nISC text\n");
    expect(notices).not.toContain(root);
  });

  it.each([
    [undefined, { LICENSE: "text" }, /Missing license metadata/],
    ["", { LICENSE: "text" }, /Missing license metadata/],
    ["MIT", {}, /Missing LICENSE text/],
    ["MIT", { LICENSE: " \n" }, /Empty LICENSE text/],
  ])("fails closed for license %s and files %j", (license, files, message) => {
    const root = temp();
    const path = input(
      root,
      "node_modules/example",
      { name: "example", version: "1", license },
      files,
    );
    expect(() => thirdPartyNotices({ inputs: { [path]: {} } }, root)).toThrow(message);
  });

  it("refuses inputs with no named package metadata", () => {
    const root = temp();
    writeFileSync(join(root, "index.js"), "// No package metadata\n");
    expect(() => thirdPartyNotices({ inputs: { "index.js": {} } }, root)).toThrow(
      /No package metadata/,
    );
  });

  it("refuses symlinked license files", () => {
    const root = temp();
    const path = input(
      root,
      "node_modules/example",
      { name: "example", version: "1", license: "MIT" },
      {},
    );
    const target = join(root, "license-text");
    writeFileSync(target, "Fixture license\n");
    symlinkSync(target, join(root, "node_modules/example/LICENSE"));
    expect(() => thirdPartyNotices({ inputs: { [path]: {} } }, root)).toThrow(/regular file/);
  });

  it("refuses conflicting license text for two copies of the same package version", () => {
    const root = temp();
    const pkg = { name: "example", version: "1", license: "MIT" };
    const first = input(root, "node_modules/first", pkg);
    const second = input(root, "node_modules/second", pkg, { LICENSE: "Different license text\n" });
    expect(() => thirdPartyNotices({ inputs: { [first]: {}, [second]: {} } }, root)).toThrow(
      /Conflicting license notices/,
    );
  });
});

describe("self-contained MCPB", () => {
  it("produces deterministic ZIPs across staging paths, file mtimes and time zones, and boots without node_modules", async () => {
    const first = temp();
    const second = temp();
    await stageMcpb(first);
    await stageMcpb(second);
    const oldTimezone = process.env.TZ;
    let bytes;
    try {
      process.env.TZ = "Pacific/Honolulu";
      bytes = zipStage(first);
      process.env.TZ = "Asia/Tokyo";
      expect(Buffer.from(zipStage(second))).toEqual(Buffer.from(bytes));
    } finally {
      if (oldTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = oldTimezone;
    }
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual([
      "LICENSE",
      "README.md",
      "THIRD_PARTY_NOTICES.txt",
      "dist/cli.js",
      "manifest.json",
      "package.json",
    ]);
    const notices = Buffer.from(files["THIRD_PARTY_NOTICES.txt"]).toString();
    for (const name of ["@modelcontextprotocol/sdk", "zod", "n3"]) {
      const pkgDirectory = join(packageRoot, "node_modules", name);
      const pkg = JSON.parse(readFileSync(join(pkgDirectory, "package.json"), "utf8"));
      expect(notices).toContain(
        `Package: ${name}\nVersion: ${pkg.version}\nLicense: ${pkg.license}\n`,
      );
      const license = name === "n3" ? "LICENSE.md" : "LICENSE";
      expect(notices).toContain(readFileSync(join(pkgDirectory, license), "utf8"));
    }
    expect(notices).not.toContain(packageRoot);
    expect(Buffer.from(files["dist/cli.js"]).toString()).not.toContain(packageRoot);
    const isolated = temp();
    for (const [name, data] of Object.entries(files)) {
      mkdirSync(dirname(join(isolated, name)), { recursive: true });
      writeFileSync(join(isolated, name), data);
    }
    const config = JSON.parse(Buffer.from(files["manifest.json"]).toString());
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "bundle-smoke", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "pod_write",
          arguments: {
            url: "https://packaging.invalid/pod/blocked",
            content: "blocked",
            contentType: "text/plain",
          },
        },
      },
    ];
    const output = runNode(
      [join(isolated, config.server.entry_point)],
      isolated,
      { HOME: isolated, NODE_PATH: "", SOLID_MCP_POD_ROOT: "https://packaging.invalid/pod/" },
      `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    );
    // Parsing every stdout line proves that diagnostics never pollute MCP output.
    const replies = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(replies.find((reply) => reply.id === 1).result.serverInfo.name).toBe("@jeswr/solid-mcp");
    expect(
      replies
        .find((reply) => reply.id === 2)
        .result.tools.map((tool) => tool.name)
        .sort(),
    ).toEqual((await registeredTools()).map((tool) => tool.name));
    const refused = replies.find((reply) => reply.id === 3).result;
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/write disabled: server is read-only/);
  });

  it("refuses symlinks in staged archives", () => {
    const stage = temp();
    symlinkSync(join(packageRoot, "package.json"), join(stage, "link"));
    expect(() => zipStage(stage)).toThrow(/regular files/);
  });
});
