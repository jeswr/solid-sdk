// AUTHORED-BY Codex GPT-6
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkNative } from "./check-native.mjs";
import { writeCsp } from "./csp-hashes.mjs";
import { nativeSettings } from "./native-settings.mjs";
import { checkServerFeatures, filesUnder, writeManifest } from "./route-manifest.mjs";
import { stageCalendarRoutes } from "./stage-native.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Browser instrumentation and its in-memory session never enter the distributable export.
const browserTest = process.argv.includes("--browser-test");
const stage = join(root, ".native-stage", ...(browserTest ? ["browser"] : []));
const www = browserTest ? join(stage, "www") : join(root, "www");
const info = nativeSettings(process.env);
const adaptations = [
  "dev/ routes excluded from the native build graph",
  "native / entry redirects to /drive/my (web has no root page)",
  "demo pod session replaced by the native sign-in placeholder (mobile auth integration pending)",
  "Drive preview interception uses the plain /drive/p/[ref] route on native",
];
await rm(stage, { recursive: true, force: true });
await rm(www, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(root, "src"), join(stage, "src"), {
  recursive: true,
  filter: (path) => path !== join(root, "src/app/dev"),
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
// Do not include seed code even in an unreferenced staged module.
await rm(join(stage, "src/lib/demo-pod"), { recursive: true });
await cp(
  join(root, "src/lib/session/native-session.tsx"),
  join(stage, "src/lib/session/pod-session.tsx"),
);
if (browserTest) {
  await mkdir(join(stage, "src/lib/demo-pod"));
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
await cp(join(root, "public"), join(stage, "public"), {
  recursive: true,
  filter: (path) => path !== join(root, "public/fixtures"),
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
