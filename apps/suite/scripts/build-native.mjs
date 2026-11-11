// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkNative } from "./check-native.mjs";
import { writeCsp } from "./csp-hashes.mjs";
import { nativeSettings } from "./native-settings.mjs";
import { checkServerFeatures, filesUnder, writeManifest } from "./route-manifest.mjs";
import { includeNativeSource, stageCalendarRoutes } from "./stage-native.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Browser instrumentation and its in-memory session never enter the distributable export.
const browserTest = process.argv.includes("--browser-test");
const stage = join(root, ".native-stage", ...(browserTest ? ["browser"] : []));
const www = browserTest ? join(stage, "www") : join(root, "www");
const info = nativeSettings(process.env);
const adaptations = [
  "api/ route handlers excluded; feedback uses the deployed suite or a local download",
  "public/media excluded; the welcome videos are watched on the web suite",
  "dev/ routes excluded from the native build graph",
  ".well-known/ route handlers excluded (the Client ID Document is served by the deployed suite)",
  "native / entry redirects to /drive/my (the web / chooses by session)",
  "app sessions follow the native shell account, with signed-out fallback outside the shell",
  "shell demo account disabled; demo-pod modules replaced by inert stand-ins",
  "Drive preview interception uses the plain /drive/p/[ref] route on native",
];
await rm(stage, { recursive: true, force: true });
await rm(www, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(root, "src"), join(stage, "src"), {
  recursive: true,
  // The Client ID Document is served by the deployed suite (MOB-P3 E7), never by the bundle.
  filter: (path) => includeNativeSource(path, root),
});
await stageCalendarRoutes(join(stage, "src"));
// The web deployment has no / route; the local WebView starts at /.
await writeFile(
  join(stage, "src/app/page.tsx"),
  `// AUTHORED-BY Codex GPT-6
import { redirect } from "next/navigation";
export default function NativeEntry() { redirect("/drive/my/"); }
`,
);
// Do not include seed code even in an unreferenced staged module. The shell still imports these
// two modules for its demo account, which the native build turns off (NEXT_PUBLIC_SUITE_DEMO=0),
// so inert stand-ins keep the imports resolving and fail closed if anything calls them.
await rm(join(stage, "src/lib/demo-pod"), { recursive: true });
await mkdir(join(stage, "src/lib/demo-pod"));
await writeFile(
  join(stage, "src/lib/demo-pod/seed.ts"),
  `// AUTHORED-BY Claude Opus 5.5
export async function buildDemoSeed(_now: number): Promise<never> {
  throw new Error("The native app has no demo pod");
}
`,
);
// The shell's demo account and demo search items, without the seed's names or data.
await writeFile(
  join(stage, "src/shell/session/demo-backend.ts"),
  `// AUTHORED-BY Claude Opus 5.5
import type { SessionBackend, SuiteAccount } from "./types";

export const demoAccount: SuiteAccount = {
  id: "demo",
  webId: "https://demo.invalid/profile/card#me",
  name: "Demo",
  storageUrl: "https://demo.invalid/",
  kind: "demo",
};

const unavailable = () => Promise.reject(new Error("The native app has no demo pod"));

export class DemoBackend implements SessionBackend {
  readonly kind = "demo";
  async restore(): Promise<SuiteAccount | null> {
    return null;
  }
  signIn(): Promise<SuiteAccount> {
    return unavailable();
  }
  async signOut(): Promise<void> {}
  fetchFor(): typeof fetch {
    return unavailable;
  }
  onExpired(): () => void {
    return () => {};
  }
}
`,
);
await writeFile(
  join(stage, "src/shell/search/demo-items.ts"),
  `// AUTHORED-BY Claude Opus 5.5
import type { LocalSearchItem } from "./local-source";
export function demoSearchItems(_seed: readonly unknown[]): LocalSearchItem[] {
  return [];
}
`,
);
await writeFile(
  join(stage, "src/lib/demo-pod/browser.ts"),
  `// AUTHORED-BY Claude Opus 5.5
export class DemoStorageError extends Error {}
interface DemoPodStandIn {
  fetch: typeof globalThis.fetch;
  subscribe(listener: (url: string) => void): () => void;
  snapshot(): { resources: [string, { body: Uint8Array }][] };
}
export async function getDemoPod(): Promise<DemoPodStandIn> {
  throw new Error("The native app has no demo pod");
}
export async function resetDemoPod(): Promise<never> {
  throw new Error("The native app has no demo pod");
}
`,
);
await cp(
  join(root, "src/lib/session/native-session.tsx"),
  join(stage, "src/lib/session/pod-session.tsx"),
);
if (browserTest) {
  await cp(join(root, "src/lib/demo-pod/pod.ts"), join(stage, "src/lib/demo-pod/pod.ts"));
  await cp(
    join(root, "test/native-browser/session.tsx"),
    join(stage, "src/lib/session/pod-session.tsx"),
  );
  await cp(
    join(root, "test/native-browser/probe.tsx"),
    join(stage, "src/lib/native-browser-probe.tsx"),
  );
  const page = join(stage, "src/app/(suite)/drive/f/[ref]/page.tsx");
  await writeFile(
    page,
    `import { NativeRouteProbe } from "@/lib/native-browser-probe";\n${await readFile(page, "utf8")}`.replace(
      "<FolderRefView />",
      "<NativeRouteProbe><FolderRefView /></NativeRouteProbe>",
    ),
  );
}
for (const file of ["next.config.ts", "postcss.config.mjs", "tsconfig.json", "package.json"])
  await cp(join(root, file), join(stage, file));
// tsconfig paths into the app's node_modules (the Yjs singleton) are relative to the config.
const tsconfig = join(stage, "tsconfig.json");
await writeFile(
  tsconfig,
  (await readFile(tsconfig, "utf8")).replaceAll(
    '"./node_modules/',
    `"${relative(stage, root).split(sep).join("/")}/node_modules/`,
  ),
);
await cp(join(root, "public"), join(stage, "public"), {
  recursive: true,
  // Welcome videos stay on the web suite: they would push the bundle past its size budget.
  filter: (path) => path !== join(root, "public/fixtures") && path !== join(root, "public/media"),
});
for (const path of await filesUnder(join(stage, "src/app"))) {
  if (!path.endsWith("/page.tsx")) continue;
  const source = await readFile(path, "utf8");
  // Next statically analyses route config, so native staging writes a literal.
  await writeFile(
    path,
    source.replace(/export const dynamicParams = true;/g, "export const dynamicParams = false;"),
  );
}
const css = join(stage, "src/app/globals.css");
await writeFile(
  css,
  (await readFile(css, "utf8")).replace("../../../../packages/", "../../../../../packages/"),
);
process.env.NEXT_PUBLIC_SUITE_TARGET = info.target;
const { default: config } = await import(pathToFileURL(join(stage, "next.config.ts")).href);
// Check before Next executes server components, and again while generating the manifest.
await checkServerFeatures(join(stage, "src"), config, root);
await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [join(root, "node_modules/next/dist/bin/next"), "build", stage, "--webpack"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUITE_TARGET: info.target,
        NEXT_PUBLIC_APP_BASE_URL: info.appBaseUrl,
        NEXT_PUBLIC_PUBLIC_SUITE_URL: info.publicSuiteUrl,
        NEXT_PUBLIC_CLIENT_ID_URL: info.clientIdUrl,
        NEXT_PUBLIC_PUSH_RELAY_URL: info.pushRelayUrl ?? "",
        // The demo pod is web-only; staging replaces it with inert stand-ins.
        NEXT_PUBLIC_SUITE_DEMO: "0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  child.once("error", reject);
  child.once("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`Native Next build exited ${code}`)),
  );
});
await cp(join(stage, "out"), www, { recursive: true });
await writeFile(join(www, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
await writeManifest({
  appDir: join(stage, "src/app"),
  sourceRoot: join(stage, "src"),
  projectRoot: root,
  exportDir: www,
  config,
  adaptations,
});
await writeCsp(www);
await checkNative(www);
