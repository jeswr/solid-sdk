// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers

import { CredentialStore } from "@jeswr/agent-credentials";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach } from "vitest";
import { type ClockTimer, EncryptedRecords, Profiles, Secret, SessionStore } from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
export const SITE = "https://shop.test";
export const NOW = 1700000000000;
export const PASSWORD = "fixture-password-secret";
export const ACCESS = "fixture-access-secret";
export const REFRESH = "fixture-refresh-secret";
export const COOKIE = "fixture-cookie-secret";
export const login = (ref?: string) =>
  new Secret({
    site: SITE,
    title: "Fictional shop",
    username: "alex@example.test",
    password: PASSWORD,
    ...(ref ? { ref } : {}),
  });
export const cookie = () => ({
  name: "sid",
  value: COOKIE,
  domain: "shop.test",
  path: "/",
  secure: true,
  hostOnly: true,
});
export const capture = (account = "alex") =>
  new Secret({ site: SITE, account, cookies: [cookie()], capturedAt: NOW });
export function setup() {
  const dir = mkdtempSync(join(tmpdir(), "agent-vault-"));
  dirs.push(dir);
  const store = new CredentialStore(dir);
  const records = new EncryptedRecords(store);
  const sessions = new SessionStore(records, { now: () => NOW });
  const profiles = new Profiles(store);
  return { dir, store, records, sessions, profiles };
}
export async function account(
  profiles: Profiles,
  id = "alex",
  profile = "personal",
  method = "password",
) {
  await profiles.putProfile({ id: profile, label: profile });
  const a = {
    id,
    site: SITE,
    profile,
    label: id,
    emailDomain: profile === "work" ? "work.test" : "example.test",
  };
  await profiles.putAccount(a);
  await profiles.putRoute({ site: SITE, account: id, profile, method });
  return a;
}
export class FakeClock implements ClockTimer {
  time = NOW;
  id = 0;
  tasks = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  set(callback: () => void, delay: number) {
    const id = ++this.id;
    this.tasks.set(id, { at: this.time + delay, callback });
    return id;
  }
  clear(handle: unknown) {
    this.tasks.delete(handle as number);
  }
  delay() {
    return Math.min(...[...this.tasks.values()].map((t) => t.at - this.time));
  }
  async tick() {
    const first = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
    if (!first) throw new Error("No fake timer");
    this.time = first[1].at;
    this.tasks.delete(first[0]);
    first[1].callback();
    // Drain the injected async work without waiting on wall time or a real process/network.
    for (let i = 0; i < 100; i++) await Promise.resolve();
  }
}
