// AUTHORED-BY Codex GPT-6
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { filesUnder } from "./route-manifest.mjs";

const origins = ["https://localhost", "capacitor://localhost"];
const staticSources = origins.map((origin) => `${origin}/_next/static/`).join(" ");
const hash = (body) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

function inlineBodies(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))]
    .filter((match) => tag !== "script" || !/\bsrc\s*=/i.test(match[1]))
    .map((match) => match[2]);
}

export function assertCspHashes(html) {
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?\s*>/i.exec(
    html,
  )?.[1];
  if (!policy) throw new Error("Missing Content-Security-Policy meta");
  const scripts = /(?:^|;)\s*script-src\s+([^;]+)/.exec(policy)?.[1]?.split(/\s+/) ?? [];
  for (const body of inlineBodies(html, "script")) {
    if (!scripts.includes(hash(body))) throw new Error("Missing inline-script CSP hash");
  }
  if (policy.includes("'self'") || !policy.includes("frame-src 'none'"))
    throw new Error("Unsafe native CSP");
}

export function addCsp(html) {
  if (/http-equiv=["']Content-Security-Policy/i.test(html)) throw new Error("CSP already exists");
  const scriptHashes = [...new Set(inlineBodies(html, "script").map(hash))].join(" ");
  const styleHashes = [...new Set(inlineBodies(html, "style").map(hash))].join(" ");
  const nativeFiles = origins
    .flatMap((origin) =>
      ["_capacitor_file_", "_capacitor_content_"].map((prefix) => `${origin}/${prefix}/`),
    )
    .join(" ");
  const policy = [
    "default-src 'none'",
    `script-src ${staticSources} ${scriptHashes}`,
    "script-src-attr 'none'",
    `worker-src ${staticSources}`,
    `style-src ${staticSources} ${styleHashes}`,
    "style-src-attr 'unsafe-inline'",
    `font-src ${staticSources}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    `connect-src ${origins.join(" ")} https: http: wss: ws:`,
    `img-src ${origins.join(" ")} https: http: data: blob: ${nativeFiles}`,
    `media-src ${origins.join(" ")} https: http: blob: ${nativeFiles}`,
    "form-action 'none'",
  ].join("; ");
  // The policy precedes every script, including next-themes' bootstrap.
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error("Missing HTML head for CSP");
  const result = html.replace(
    /<head(?:\s[^>]*)?>/i,
    (head) => `${head}<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  );
  assertCspHashes(result);
  return result;
}

export async function writeCsp(exportDir) {
  for (const path of await filesUnder(exportDir)) {
    if (!path.endsWith(".html")) continue;
    await writeFile(path, addCsp(await readFile(path, "utf8")));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) await writeCsp(process.argv[2]);
