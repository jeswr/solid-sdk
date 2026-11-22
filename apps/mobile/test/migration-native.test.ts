// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const java = (name: string) =>
  readFileSync(
    new URL(`../android/app/src/main/java/org/jeswr/suite/${name}.java`, import.meta.url),
    "utf8",
  );
const swift = (name: string) =>
  readFileSync(new URL(`../ios/App/App/${name}.swift`, import.meta.url), "utf8");
it("runs Android migration before bridge construction and never registers it as a plugin", () => {
  const main = java("MainActivity");
  expect(main.indexOf("SecureStoreMigrationStartup.prepare(this, config)")).toBeLessThan(
    main.indexOf("super.load()"),
  );
  expect(main).not.toContain("registerPlugin(SecureStoreMigration");
  const startup = java("SecureStoreMigrationStartup");
  expect(startup).toContain("if (config.getServerUrl() != null) return");
  expect(startup).toContain('open("public/build-info.json")');
  expect(startup.indexOf("SecureStoreMigration.origins(info)")).toBeLessThan(
    startup.indexOf('KeyStore.getInstance("AndroidKeyStore")'),
  );
  expect(java("SuiteSecureStorePlugin")).toContain("takeMigrationNotice(PluginCall call)");
  expect(startup).not.toMatch(/@PluginMethod|Log\./);
});
it("runs iOS migration in configuration preparation before Capacitor constructs the bridge", () => {
  const main = swift("MainViewController");
  const config = main.slice(
    main.indexOf("override open func webViewConfiguration"),
    main.indexOf("override open func capacitorDidLoad"),
  );
  expect(config).toContain("SuiteOrigin.isBundled(");
  expect(config).toContain('root.appendingPathComponent("build-info.json")');
  const capacitor = readFileSync(
    new URL(
      "../node_modules/@capacitor/ios/Capacitor/Capacitor/CAPBridgeViewController.swift",
      import.meta.url,
    ),
    "utf8",
  );
  const load = capacitor.slice(
    capacitor.indexOf("override public final func loadView()"),
    capacitor.indexOf("override open func viewDidLoad()"),
  );
  expect(load.indexOf("prepareWebView(")).toBeLessThan(load.indexOf("CapacitorBridge(with:"));
  expect(capacitor).toContain("let webConfig = webViewConfiguration(for: configuration)");
  const plugin = swift("SuiteSecureStorePlugin");
  expect(plugin).toContain(
    'CAPPluginMethod(name: "takeMigrationNotice", returnType: CAPPluginReturnPromise)',
  );
  expect(plugin).not.toContain("func migrate");
});
it("includes the migration and its XCTest in the correct Xcode source phases", () => {
  const project = readFileSync(
    new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url),
    "utf8",
  );
  for (const [file, target] of [
    ["SecureStoreMigration.swift", "504EC3001FED79650016851F"],
    ["SecureStoreMigrationTests.swift", "9BD353B04D1AF808D3D99950"],
  ]) {
    const build = project.match(
      new RegExp(`([A-F0-9]{24}) /\\* ${file} in Sources \\*/ = \\{isa = PBXBuildFile;`),
    )?.[1];
    expect(build).toBeDefined();
    const phase = project.match(
      new RegExp(`${target} /\\* Sources \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};`),
    )?.[0];
    expect(phase).toContain(`${build} /* ${file} in Sources */`);
  }
});
