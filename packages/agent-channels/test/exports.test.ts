// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import * as entry0 from "@jeswr/agent-channels";
import * as entry14 from "@jeswr/agent-channels/a2a";
import * as entry29 from "@jeswr/agent-channels/a2a/send";
import * as entry9 from "@jeswr/agent-channels/bluesky";
import * as entry25 from "@jeswr/agent-channels/bluesky/send";
import * as entry17 from "@jeswr/agent-channels/direct";
import * as entry32 from "@jeswr/agent-channels/direct/send";
import * as entry8 from "@jeswr/agent-channels/discord";
import * as entry24 from "@jeswr/agent-channels/discord/send";
import * as entry2 from "@jeswr/agent-channels/email-mime";
import * as entry18 from "@jeswr/agent-channels/email-mime/send";
import * as entry11 from "@jeswr/agent-channels/github";
import * as entry3 from "@jeswr/agent-channels/gmail";
import * as entry19 from "@jeswr/agent-channels/gmail/send";
import * as entry4 from "@jeswr/agent-channels/graph-mail";
import * as entry20 from "@jeswr/agent-channels/graph-mail/send";
import * as entry5 from "@jeswr/agent-channels/graph-teams";
import * as entry21 from "@jeswr/agent-channels/graph-teams/send";
import * as entry13 from "@jeswr/agent-channels/imessage";
import * as entry28 from "@jeswr/agent-channels/imessage/send";
import * as entry10 from "@jeswr/agent-channels/mastodon";
import * as entry26 from "@jeswr/agent-channels/mastodon/send";
import * as entry6 from "@jeswr/agent-channels/matrix";
import * as entry22 from "@jeswr/agent-channels/matrix/send";
import * as entry15 from "@jeswr/agent-channels/mcp";
import * as entry30 from "@jeswr/agent-channels/mcp/send";
import * as entry16 from "@jeswr/agent-channels/public-http";
import * as entry31 from "@jeswr/agent-channels/public-http/send";
import * as entry7 from "@jeswr/agent-channels/slack";
import * as entry23 from "@jeswr/agent-channels/slack/send";
import * as entry12 from "@jeswr/agent-channels/telegram";
import * as entry27 from "@jeswr/agent-channels/telegram/send";
import * as entry1 from "@jeswr/agent-channels/testing";
import * as entry33 from "@jeswr/agent-channels/testing/send";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { existsSync, readFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { fileURLToPath } from "url";
import { expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const modules: Record<string, object> = {
  ".": entry0,
  "./testing": entry1,
  "./email-mime": entry2,
  "./gmail": entry3,
  "./graph-mail": entry4,
  "./graph-teams": entry5,
  "./matrix": entry6,
  "./slack": entry7,
  "./discord": entry8,
  "./bluesky": entry9,
  "./mastodon": entry10,
  "./github": entry11,
  "./telegram": entry12,
  "./imessage": entry13,
  "./a2a": entry14,
  "./mcp": entry15,
  "./public-http": entry16,
  "./direct": entry17,
  "./email-mime/send": entry18,
  "./gmail/send": entry19,
  "./graph-mail/send": entry20,
  "./graph-teams/send": entry21,
  "./matrix/send": entry22,
  "./slack/send": entry23,
  "./discord/send": entry24,
  "./bluesky/send": entry25,
  "./mastodon/send": entry26,
  "./telegram/send": entry27,
  "./imessage/send": entry28,
  "./a2a/send": entry29,
  "./mcp/send": entry30,
  "./public-http/send": entry31,
  "./direct/send": entry32,
  "./testing/send": entry33,
};
const entries = Object.entries(manifest.exports) as [string, { types: string; default: string }][];

it("declares the root and testing entry points on Node >=24", () => {
  expect(Object.keys(modules)).toEqual(Object.keys(manifest.exports));
  expect(manifest.exports).toHaveProperty(".");
  expect(manifest.exports).toHaveProperty("./testing");
  expect(manifest.type).toBe("module");
  expect(manifest.engines.node).toBe(">=24");
});

it.each(entries)("resolves %s without exposing runtime capabilities", (subpath, target) => {
  expect(existsSync(fileURLToPath(new URL(`../${target.types}`, import.meta.url)))).toBe(true);
  const entry = new URL(`../${target.default}`, import.meta.url);
  const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
  expect(import.meta.resolve(specifier)).toBe(entry.href);
  expect(Object.getOwnPropertyNames(modules[subpath])).toEqual([]);
});
