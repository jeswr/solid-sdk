// AUTHORED-BY Claude Opus 5.5
import { readFileSync, writeFileSync } from "node:fs";
import { type MobileEnv, suiteOrigin } from "./config.ts";

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders the bundled offline page for this build's suite origin (no script, no bridge). */
export function renderOfflinePage(template: string, env: MobileEnv): string {
  const page = template.replaceAll("{{SUITE_URL}}", escapeXml(suiteOrigin(env).href));
  if (page.includes("{{")) throw new Error("offline template has an unknown placeholder");
  return page;
}

const APP_BOUND = /(<key>WKAppBoundDomains<\/key>\s*<array>)[\s\S]*?(<\/array>)/;

/** Points the iOS app-bound domain list at this build's suite hostname (DESIGN D2). */
export function withAppBoundDomain(plist: string, env: MobileEnv): string {
  if (!APP_BOUND.test(plist)) throw new Error("Info.plist has no WKAppBoundDomains array");
  const host = escapeXml(suiteOrigin(env).hostname);
  return plist.replace(APP_BOUND, `$1\n\t\t<string>${host}</string>\n\t$2`);
}

/** Writes www/offline.html and the iOS app-bound domain; run before `cap sync`. */
export function prepareNative(root: URL, env: MobileEnv): void {
  const template = readFileSync(new URL("templates/offline.html", root), "utf8");
  writeFileSync(new URL("www/offline.html", root), renderOfflinePage(template, env));
  const plistPath = new URL("ios/App/App/Info.plist", root);
  writeFileSync(plistPath, withAppBoundDomain(readFileSync(plistPath, "utf8"), env));
}
