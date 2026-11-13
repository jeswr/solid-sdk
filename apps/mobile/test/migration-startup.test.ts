// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const java = (name: string) => read(`android/app/src/main/java/org/jeswr/suite/${name}.java`);

it("migrates Android signed assets before bridge construction and refuses startup on failure", () => {
  const activity = java("MainActivity");
  expect(activity.indexOf("SecureStoreMigrationStartup.prepare(this, config)")).toBeLessThan(
    activity.indexOf("super.load()"),
  );
  const startup = java("SecureStoreMigrationStartup");
  expect(startup).toContain('context.getAssets().open("public/build-info.json")');
  expect(startup).toContain("if (config.getServerUrl() != null) return");
  expect(startup.indexOf("SecureStoreMigration.origins(info)")).toBeLessThan(
    startup.indexOf('KeyStore.getInstance("AndroidKeyStore")'),
  );
  expect(startup).toContain('"https".equals(config.getAndroidScheme())');
  expect(startup).toContain('"localhost".equals(config.getHostname())');
  expect(activity).toMatch(
    /SecureStoreMigrationStartup.prepare\(this, config\);[\s\S]*?catch \(Exception e\) \{\s*refuse\(\);\s*return;/,
  );
});

it("migrates iOS while preparing configuration before CapacitorBridge exists", () => {
  const controller = read("ios/App/App/MainViewController.swift");
  const start = controller.indexOf("override open func webViewConfiguration");
  const migrated = controller.indexOf("SecureStoreMigration(support:");
  expect(migrated).toBeGreaterThan(start);
  expect(migrated).toBeLessThan(controller.indexOf("override open func capacitorDidLoad"));
  expect(controller).toContain('root.appendingPathComponent("build-info.json")');
  expect(controller).toContain('fatalError("Secure store migration failed")');
});

it("exposes only a no-argument notice method and includes migration in both Xcode targets", () => {
  const android = java("SuiteSecureStorePlugin");
  expect(android).toContain("@PluginMethod public void takeMigrationNotice(PluginCall call)");
  expect(android).not.toMatch(/@PluginMethod[^\n]*(?:migrate|predecessors|origins)/);
  const ios = read("ios/App/App/SuiteSecureStorePlugin.swift");
  expect(ios).toContain('CAPPluginMethod(name: "takeMigrationNotice"');
  expect(ios).not.toMatch(/CAPPluginMethod\(name: "(?:run|migrate|predecessors|origins)"/);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  for (const name of ["SecureStoreMigration.swift", "SecureStoreMigrationTests.swift"]) {
    const definitions = [
      ...project.matchAll(
        new RegExp(`/\\* ${name.replaceAll(".", "\\.")} \\*/ = \\{isa = PBXFileReference`, "g"),
      ),
    ];
    expect(definitions).toHaveLength(1);
    expect(project).toContain(`${name} in Sources`);
  }
});
