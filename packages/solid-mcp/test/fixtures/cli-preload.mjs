// AUTHORED-BY Codex GPT-6.1-Sol
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { mockCss } from "./css.mjs";

os.homedir = () => process.env.SOLID_MCP_TEST_HOME;
syncBuiltinESMExports();
const css = mockCss();
globalThis.fetch = process.env.SOLID_MCP_TEST_AUTH_FAIL
  ? async () => new Response("fixture-secret", { status: 401 })
  : css.fetch;
