// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planAutologin } from "./autologin-plan";

interface RedirectStorage {
  REDIRECT_FLOW_KEY: string;
  hasPendingRedirectLogin(): boolean;
  consumePendingRedirectWebId(): string | null;
  WebIdDPoPTokenProvider: new (
    callback: string,
    getCode: () => Promise<string>,
    getWebId: () => Promise<string>,
  ) => { reset(): void };
}

interface SentinelStorage {
  AUTOLOGIN_SENTINEL_KEY: string;
  readAutologinSentinel(): string | null;
}

// Import the production readers from every local auth fork. All apps use the
// same tab storage below, as they do under jeswr.github.io/solid-sdk/<slug>/.
const providers = import.meta.glob<RedirectStorage>(
  "../../../../*/web/src/auth/webid-token-provider.ts",
  { eager: true },
);
const sessions = import.meta.glob<SentinelStorage>(
  "../../../../*/web/src/auth/SessionProvider.tsx",
  {
    eager: true,
  },
);
const authApps = Object.entries(providers).map(([path, provider]) => ({
  slug: path.split("/")[4],
  provider,
  session: sessions[path.replace("webid-token-provider.ts", "SessionProvider.tsx")],
}));
const webId = "https://alice.example/profile/card#me";
let records: Map<string, string>;
let getItem: ReturnType<typeof vi.fn>;

beforeEach(() => {
  records = new Map();
  getItem = vi.fn((key: string) => records.get(key) ?? null);
  vi.stubGlobal("sessionStorage", {
    getItem,
    setItem: (key: string, value: string) => records.set(key, value),
    removeItem: (key: string) => records.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("same-origin app authentication storage", () => {
  it("covers all nine redirect-login apps with unique flow and sentinel keys", () => {
    expect(authApps).toHaveLength(9);
    expect(new Set(authApps.map(({ provider }) => provider.REDIRECT_FLOW_KEY)).size).toBe(9);
    expect(new Set(authApps.map(({ session }) => session.AUTOLOGIN_SENTINEL_KEY)).size).toBe(9);
  });

  for (const { slug, provider, session } of authApps) {
    it(`${slug} ignores legacy keys and every other app's pending login`, () => {
      records.set("pss.autologin.flow", JSON.stringify({ webId }));
      records.set("autologin-attempted", webId);
      for (const other of authApps.filter((app) => app.slug !== slug)) {
        records.set(
          other.provider.REDIRECT_FLOW_KEY,
          JSON.stringify({ webId, state: "other-state", codeVerifier: "other-verifier" }),
        );
        records.set(other.session.AUTOLOGIN_SENTINEL_KEY, webId);
      }
      expect(provider.hasPendingRedirectLogin()).toBe(false);
      expect(provider.consumePendingRedirectWebId()).toBeNull();
      expect(session.readAutologinSentinel()).toBeNull();
      expect(
        planAutologin({
          ready: true,
          hasProvider: true,
          loggedIn: false,
          effectAlreadyRan: false,
          hasPendingRedirect: provider.hasPendingRedirectLogin(),
          pendingRedirectWebId: provider.consumePendingRedirectWebId(),
          hasCodeParams: false,
          hasErrorParams: false,
          fragmentWebId: webId,
          sentinel: session.readAutologinSentinel(),
          webIdsEqual: (a, b) => a === b,
        }),
      ).toEqual({ kind: "begin", webId });
      expect(getItem).not.toHaveBeenCalledWith("pss.autologin.flow");
      expect(getItem).not.toHaveBeenCalledWith("autologin-attempted");

      const ownFlow = JSON.stringify({ webId, state: `${slug}-state` });
      records.set(provider.REDIRECT_FLOW_KEY, ownFlow);
      records.set(session.AUTOLOGIN_SENTINEL_KEY, webId);
      expect(provider.hasPendingRedirectLogin()).toBe(true);
      expect(provider.consumePendingRedirectWebId()).toBe(webId);
      expect(session.readAutologinSentinel()).toBe(webId);
      const beforeReset = new Map(records);
      new provider.WebIdDPoPTokenProvider(
        `https://jeswr.github.io/solid-sdk/${slug}/callback.html`,
        async () => "",
        async () => webId,
      ).reset();
      beforeReset.delete(provider.REDIRECT_FLOW_KEY);
      expect(records).toEqual(beforeReset);
      expect(provider.hasPendingRedirectLogin()).toBe(false);
    });
  }
});

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const deployments: { framework: string; rootDirectory: string; project: string }[] = JSON.parse(
  readFileSync(resolve(workspace, "scripts/vercel-apps.json"), "utf8"),
);
const viteApps = deployments.filter((app) => app.framework === "vite");

describe("all ten Vite apps' persistent browser storage", () => {
  it("keeps session databases, DPoP credentials and remembered-account pointers app-specific", () => {
    expect(viteApps).toHaveLength(10);
    const owners = new Map<string, string>();
    for (const app of viteApps) {
      const authRoot = resolve(workspace, app.rootDirectory, "src/auth");
      const files =
        app.rootDirectory === "apps/access-manager"
          ? ["controller.ts"]
          : ["SessionProvider.tsx", "webid-token-provider.ts"];
      const source = files.map((name) => readFileSync(resolve(authRoot, name), "utf8")).join("\n");
      const keys = new Set(
        [
          ...source.matchAll(
            /"([^"\n]+(?:[:.]sessions|[:.]remembered-account|[:.]recent-accounts))"/g,
          ),
        ].map((match) => match[1]),
      );
      // Docs keeps OAuth/DPoP sessions in memory and has no durable store.
      if (app.rootDirectory !== "apps/pod-docs/web") expect(keys.size).toBeGreaterThanOrEqual(2);
      for (const key of keys) {
        expect(
          owners.get(key),
          `${key} is shared by ${owners.get(key)} and ${app.project}`,
        ).toBeUndefined();
        owners.set(key, app.project);
      }
      expect(source).not.toMatch(/new IndexedDbSessionStore\(\s*\)/);
      expect(source).not.toMatch(/new RememberedAccount\(\s*\)/);
    }
  });

  for (const app of viteApps) {
    const slug = app.project.replace(/^solid-(?:sdk-)?/, "");
    it(`${slug} uses its own theme key before paint and in React`, () => {
      const root = resolve(workspace, app.rootDirectory);
      const main = readFileSync(resolve(root, "src/main.tsx"), "utf8");
      expect(main).toContain(`<ThemeProvider storageKey="${slug}:app-shell-theme">`);
      if (slug === "access-manager") {
        expect(readFileSync(resolve(root, "src/demo/DemoApp.tsx"), "utf8")).toContain(
          `<ThemeProvider storageKey="${slug}:app-shell-theme">`,
        );
      }
      const html = readFileSync(resolve(root, "index.html"), "utf8");
      const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
        .map((match) => match[1])
        .find((source) => source.includes("localStorage"));
      expect(script).toBeDefined();
      const read = vi.fn((key: string) => (key === `${slug}:app-shell-theme` ? "light" : "dark"));
      const toggle = vi.fn();
      const style = { colorScheme: "" };
      runInNewContext(script as string, {
        localStorage: { getItem: read },
        window: { matchMedia: () => ({ matches: true }) },
        document: { documentElement: { classList: { toggle }, style } },
      });
      expect(read).toHaveBeenCalledExactlyOnceWith(`${slug}:app-shell-theme`);
      expect(toggle).toHaveBeenCalledWith("dark", false);
      expect(style.colorScheme).toBe("light");
    });
  }
});
