// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePredecessorOrigins } from "@jeswr/suite-native";
import { describe, expect, test, vi } from "vitest";
import { DEFAULT_SUITE_URL } from "../src/config.ts";
import {
  checkBundle,
  prepareNative,
  renderOfflinePage,
  withAppBoundDomain,
  withLocalNetworking,
} from "../src/www.ts";

vi.mock("@jeswr/suite-native", { spy: true });

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("offline page", () => {
  const template = read("templates/offline.html");

  test("links back to the suite origin without any script", () => {
    const page = renderOfflinePage(template, { SUITE_URL: "https://suite.example" });
    expect(page).toContain('href="https://suite.example/"');
    expect(page).not.toMatch(/<script/i);
    expect(page).toContain("default-src 'none'");
  });

  test("rejects unknown placeholders", () => {
    expect(() => renderOfflinePage("{{OTHER}}", {})).toThrow("unknown placeholder");
  });
});

describe("iOS project", () => {
  const plist = read("ios/App/App/Info.plist");
  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");

  test("the committed app-bound domain matches the default suite host", () => {
    expect(withAppBoundDomain(plist, {})).toBe(plist);
    expect(plist).toContain(`<string>${new URL(DEFAULT_SUITE_URL).hostname}</string>`);
  });

  test("the app-bound domain follows SUITE_URL", () => {
    const patched = withAppBoundDomain(plist, { SUITE_URL: "https://suite.example" });
    expect(patched).toMatch(
      /<key>WKAppBoundDomains<\/key>\s*<array>\s*<string>suite\.example<\/string>\s*<\/array>/,
    );
    expect(() => withAppBoundDomain("<plist/>", {})).toThrow("WKAppBoundDomains");
  });

  test("the production plist never permits cleartext or names a loopback domain", () => {
    expect(plist).not.toMatch(/NSAllows(?:LocalNetworking|ArbitraryLoads)|localhost|127\.0\.0\.1/);
    expect(withLocalNetworking(plist, {})).toBe(plist);
  });

  test("the App target guards the processed plist after resources and extension copying", () => {
    const guard = pbxproj.match(
      /([A-F0-9]{24}) \/\* Guard non-Debug ATS \*\/ = \{\s*isa = PBXShellScriptBuildPhase;([\s\S]*?)\n\t\t\};/,
    );
    expect(guard).not.toBeNull();
    const phases = pbxproj.match(
      /504EC3031FED79650016851F \/\* App \*\/ = \{\s*isa = PBXNativeTarget;[\s\S]*?buildPhases = \(([\s\S]*?)\);/,
    )?.[1];
    expect(phases).toContain(`${guard?.[1]} /* Guard non-Debug ATS */`);
    expect(phases?.indexOf("/* Resources */")).toBeLessThan(
      phases?.indexOf("/* Guard non-Debug ATS */") ?? -1,
    );
    expect(phases?.indexOf("/* Embed Foundation Extensions */")).toBeLessThan(
      phases?.indexOf("/* Guard non-Debug ATS */") ?? -1,
    );
    const phase = guard?.[2] ?? "";
    expect(phase).toMatch(
      /inputPaths = \(\s*"\$\(TARGET_BUILD_DIR\)\/\$\(INFOPLIST_PATH\)",\s*\);/,
    );
    expect(phase).toMatch(
      /outputPaths = \(\s*"\$\(DERIVED_FILE_DIR\)\/non-debug-ats-guard\.stamp",\s*\);/,
    );
    expect(phase).toContain("alwaysOutOfDate = 1;");
    expect(phase).toContain("runOnlyForDeploymentPostprocessing = 0;");
    expect(phase).toContain("shellPath = /bin/sh;");
    const script = JSON.parse(phase.match(/shellScript = ("(?:\\.|[^"\\])*");/)?.[1] ?? '""');
    expect(script).toContain('if [ "$CONFIGURATION" != "Debug" ]; then');
    expect(script).toContain('plist="$TARGET_BUILD_DIR/$INFOPLIST_PATH"');
    expect(script).toContain('/usr/bin/plutil -lint "$plist"');
    expect(script).toContain('/usr/libexec/PlistBuddy -c "Print :NSAppTransportSecurity" "$plist"');
    expect(script).toContain("error: NSAppTransportSecurity is forbidden in non-Debug builds");
    expect(script).toContain("exit 1");
    expect(script).toContain('touch "$SCRIPT_OUTPUT_FILE_0"');
    expect(script).not.toMatch(/MOBILE_DEBUG|INFOPLIST_FILE/);
  });

  test.each(["localhost", "127.0.0.1"])("generates reversible debug-only ATS for %s", (host) => {
    const env = { SUITE_URL: `http://${host}:4173`, MOBILE_DEBUG: "1" };
    const generated = withLocalNetworking(plist, env);
    expect(generated).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
    expect(generated).not.toContain("NSAllowsArbitraryLoads");
    expect(withLocalNetworking(generated, env)).toBe(generated);
    expect(withLocalNetworking(generated, {})).toBe(plist);
    expect(
      withLocalNetworking(generated, { SUITE_URL: "https://suite.example", MOBILE_DEBUG: "1" }),
    ).toBe(plist);
    expect(withLocalNetworking(generated, { SUITE_URL: `https://${host}:4173` })).toBe(plist);
    expect(() => withLocalNetworking(plist, { SUITE_URL: `http://${host}:4173` })).toThrow();
  });

  test.each([
    "http://suite.example",
    "http://localhost.evil",
    "http://10.0.2.2",
  ])("rejects debug ATS for %s", (url) => {
    expect(() => withLocalNetworking(plist, { SUITE_URL: url, MOBILE_DEBUG: "1" })).toThrow();
  });

  test("sync preparation writes loopback policy and removes it on a production rebuild", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-www-"));
    try {
      for (const directory of ["templates", "www", "ios/App/App"])
        mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, "templates/offline.html"), read("templates/offline.html"));
      const path = join(root, "ios/App/App/Info.plist");
      writeFileSync(path, plist);
      prepareNative(pathToFileURL(`${root}/`), {
        SUITE_URL: "http://localhost:4173",
        MOBILE_DEBUG: "1",
      });
      const debug = readFileSync(path, "utf8");
      expect(debug).toContain("<string>localhost</string>");
      expect(debug).toContain("NSAllowsLocalNetworking");
      prepareNative(pathToFileURL(`${root}/`), {});
      expect(readFileSync(path, "utf8")).toBe(plist);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("bundled mode removes the app-bound domains reversibly", () => {
    const bundled = withAppBoundDomain(plist, { SUITE_MODE: "bundled" });
    expect(bundled).not.toContain("WKAppBoundDomains</key>");
    expect(bundled).toContain("WKAppBoundDomains: none in bundled mode");
    expect(withAppBoundDomain(bundled, { SUITE_MODE: "bundled" })).toBe(bundled);
    expect(withAppBoundDomain(bundled, {})).toBe(plist);
    expect(() => withAppBoundDomain("<plist/>", { SUITE_MODE: "bundled" })).toThrow(
      "WKAppBoundDomains",
    );
    const debug = withLocalNetworking(plist, {
      SUITE_URL: "http://localhost:4173",
      MOBILE_DEBUG: "1",
    });
    expect(
      withLocalNetworking(debug, {
        SUITE_MODE: "bundled",
        SUITE_URL: "http://localhost:4173",
        MOBILE_DEBUG: "1",
      }),
    ).toBe(plist);
  });

  describe("bundled sync preparation", () => {
    const exportTree = (root: string, info: Record<string, unknown>, skip = "") => {
      const dir = join(root, "export");
      mkdirSync(join(dir, "_next/static"), { recursive: true });
      writeFileSync(join(dir, "build-info.json"), JSON.stringify(info));
      for (const name of ["route-manifest.json", "404.html", "index.html", "_next/static/a.js"])
        if (name !== skip) writeFileSync(join(dir, name), name);
      return dir;
    };
    const good = {
      predecessorOrigins: ["https://suite.example"],
      target: "native",
      clientIdUrl: "https://suite.example/.well-known/solid-client-id-mobile.jsonld",
    };
    const withRoot = (run: (root: string) => void) => {
      const root = mkdtempSync(join(tmpdir(), "mobile-bundled-"));
      try {
        mkdirSync(join(root, "ios/App/App"), { recursive: true });
        writeFileSync(join(root, "ios/App/App/Info.plist"), plist);
        run(root);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };

    test("copies a checked native export into www-bundled and drops app-bound domains", () =>
      withRoot((root) => {
        const dir = exportTree(root, good);
        mkdirSync(join(root, "www-bundled"));
        writeFileSync(join(root, "www-bundled/stale.html"), "stale");
        prepareNative(pathToFileURL(`${root}/`), { SUITE_MODE: "bundled", SUITE_EXPORT_DIR: dir });
        expect(readFileSync(join(root, "www-bundled/_next/static/a.js"), "utf8")).toBe(
          "_next/static/a.js",
        );
        expect(() => readFileSync(join(root, "www-bundled/stale.html"))).toThrow();
        expect(readFileSync(join(root, "ios/App/App/Info.plist"), "utf8")).not.toContain(
          "WKAppBoundDomains</key>",
        );
      }));

    test.each([
      "list",
      "origin",
    ] as const)("refuses a plan rejected by the SDK for %s validation", (reason) =>
      withRoot((root) => {
        const dir = exportTree(root, good);
        vi.mocked(validatePredecessorOrigins).mockReturnValueOnce({ valid: false, reason });
        expect(() => checkBundle(pathToFileURL(`${dir}/`))).toThrow(/^Invalid predecessorOrigins$/);
        expect(validatePredecessorOrigins).toHaveBeenLastCalledWith(good.predecessorOrigins);
      }));

    test("accepts an intentional empty predecessor plan", () =>
      withRoot((root) => {
        const dir = exportTree(root, { ...good, predecessorOrigins: [] });
        expect(() => checkBundle(pathToFileURL(`${dir}/`))).not.toThrow();
      }));

    test.each<[string, Record<string, unknown>, string, string]>([
      ["a web export", { ...good, target: "web" }, "", "native target"],
      ["an http Client ID", { ...good, clientIdUrl: "http://suite.example/id" }, "", "https"],
      ["no Client ID", { target: "native" }, "", "https"],
      ["credentials", { ...good, clientIdUrl: "https://a:b@suite.example/id" }, "", "https"],
      ["no predecessor list", { ...good, predecessorOrigins: undefined }, "", "predecessorOrigins"],
      [
        "hostile predecessor",
        { ...good, predecessorOrigins: ["https://suite.example", "https://localhost"] },
        "",
        "predecessorOrigins",
      ],
      [
        "duplicate predecessors",
        { ...good, predecessorOrigins: ["https://old.example", "https://old.example"] },
        "",
        "Duplicate predecessorOrigins",
      ],
      [
        "an invalid origin after duplicate predecessors",
        {
          ...good,
          predecessorOrigins: ["https://old.example", "https://old.example", "https://localhost"],
        },
        "",
        "Invalid predecessorOrigins",
      ],
      ["no route manifest", good, "route-manifest.json", "route-manifest.json"],
      ["no 404 page", good, "404.html", "404.html"],
    ])("refuses %s", (_, info, skip, message) =>
      withRoot((root) => {
        const dir = exportTree(root, info, skip);
        expect(() => checkBundle(pathToFileURL(`${dir}/`))).toThrow(message);
        expect(() =>
          prepareNative(pathToFileURL(`${root}/`), {
            SUITE_MODE: "bundled",
            SUITE_EXPORT_DIR: dir,
          }),
        ).toThrow(message);
      }));

    test("refuses an export without build-info.json", () =>
      withRoot((root) => {
        mkdirSync(join(root, "empty"));
        expect(() => checkBundle(pathToFileURL(`${join(root, "empty")}/`))).toThrow("build:native");
      }));
  });

  test("the shared scheme includes the UI-test target and its App dependency", () => {
    const target = pbxproj.match(
      /([A-F0-9]{24}) \/\* AppUITests \*\/ = \{\s*isa = PBXNativeTarget;([\s\S]*?)\n\t\t\};/,
    );
    expect(target).not.toBeNull();
    expect(target?.[2]).toContain('productType = "com.apple.product-type.bundle.ui-testing";');
    expect(pbxproj.match(/TEST_TARGET_NAME = App;/g)).toHaveLength(2);
    const dependency = target?.[2]?.match(/dependencies = \(\s*([A-F0-9]{24})/);
    expect(dependency).not.toBeNull();
    expect(pbxproj).toMatch(
      new RegExp(
        `${dependency?.[1]} /\\* PBXTargetDependency \\*/ = \\{\\s*isa = PBXTargetDependency;\\s*target = 504EC3031FED79650016851F`,
      ),
    );
    const scheme = read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme");
    const testAction = scheme.match(/<TestAction\b[\s\S]*?<\/TestAction>/)?.[0];
    expect(testAction).toContain(`BlueprintIdentifier = "${target?.[1]}"`);
    expect(testAction).toContain('BuildableName = "AppUITests.xctest"');
    expect(testAction).toContain('BuildableName = "AppTests.xctest"');
    const ids = [...pbxproj.matchAll(/^\t\t([A-F0-9]{24})(?: \/\*.*?\*\/)? = \{/gm)].map(
      (m) => m[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
    const ui = read("ios/App/AppUITests/FixtureTests.swift");
    expect(ui).toContain("waitForExistence(timeout:");
    expect(ui).toContain("XCTNSPredicateExpectation");
    // A long result can be cut short in the accessibility value; the static-text label is the fallback.
    expect(ui).toContain(`label BEGINSWITH %@`);
    expect(ui).toContain('name: "e2e-result.json"');
    expect(ui).toContain("attachment.lifetime = .keepAlways");
    expect(ui).not.toMatch(/evaluateJavaScript|@testable import/);
    for (const file of ["MainViewController.swift", "BridgeOriginGuard.swift"]) {
      expect(read(`ios/App/App/${file}`)).not.toMatch(/__e2e|AppUITests|launchArguments/);
    }
  });

  test("registers no URL types (ASWebAuthenticationSession receives the callback)", () => {
    expect(plist).not.toContain("CFBundleURLTypes");
  });

  test("UI result timeouts attach step and hierarchy diagnostics without querying a vanished element", () => {
    const ui = read("ios/App/AppUITests/FixtureTests.swift");
    const missing = ui.match(
      /guard XCTWaiter\.wait\(for: \[present\][\s\S]*?throw FixtureFailure[^\n]*/,
    )?.[0];
    const timeout = ui.match(
      /guard XCTWaiter\.wait\(for: \[expectation\][\s\S]*?throw FixtureFailure[^\n]*/,
    )?.[0];
    for (const branch of [missing, timeout]) {
      expect(branch).toBeDefined();
      expect(branch).not.toMatch(/element\.(?:value|label|debugDescription)/);
      expect(branch).toContain("attachDebug(app, page: page, done: done, step: step,");
      expect(branch?.indexOf("attachDebug(")).toBeLessThan(
        branch?.indexOf("throw FixtureFailure") ?? -1,
      );
    }
    expect(ui).toContain("let hasWebView = app.webViews.count > 0");
    expect(ui).toContain("app.debugDescription");
    for (const step of [
      "initial fixture",
      "before foreign navigation",
      "after foreign navigation",
      "after reactivation",
    ])
      expect(ui).toContain(`step: "${step}"`);
    expect(ui).toMatch(
      /guard foreground\(\), element\.exists else \{ return nil \}[\s\S]*?element\.value/,
    );
    expect(ui).toContain(
      "if state == .runningBackground || state == .runningBackgroundSuspended { app.activate() }",
    );
    expect(ui).toContain("return state == .runningForeground");
  });

  test("targets iOS 16 and compiles the local plugins", () => {
    expect(pbxproj).not.toMatch(/IPHONEOS_DEPLOYMENT_TARGET = 15/);
    expect(pbxproj).toMatch(/IPHONEOS_DEPLOYMENT_TARGET = 16\.0/);
    for (const file of [
      "MainViewController.swift",
      "SuiteAuthSessionPlugin.swift",
      "SuiteNavigationPlugin.swift",
      "BridgeOriginGuard.swift",
      "SuiteOrigin.swift",
      "SuiteShareIntakePlugin.swift",
      "SuiteShareStagingPlugin.swift",
      "SuiteSharePlugin.swift",
      "ShareOutStore.swift",
    ]) {
      expect(pbxproj).toContain(`${file} in Sources */,`);
    }
  });

  test("links the staging plugin and Foundation store into the App target", () => {
    const appSources = pbxproj.match(
      /504EC3001FED79650016851F \/\* Sources \*\/ = \{[\s\S]*?\n\t\t\};/,
    )?.[0];
    for (const file of [
      "SuiteShareStagingPlugin.swift",
      "SuiteSharePlugin.swift",
      "ShareOutStore.swift",
    ]) {
      const ref = pbxproj.match(
        new RegExp(
          `([A-F0-9]{24}) /\\* ${file.replaceAll(".", "\\.")} \\*/ = \\{isa = PBXFileReference;`,
        ),
      )?.[1];
      expect(ref).toBeDefined();
      const build = pbxproj.match(
        new RegExp(
          `([A-F0-9]{24}) /\\* ${file.replaceAll(".", "\\.")} in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ${ref}`,
        ),
      )?.[1];
      expect(build).toBeDefined();
      expect(appSources).toContain(`${build} /* ${file} in Sources */,`);
      expect(pbxproj).toContain(`${ref} /* ${file} */,`);
    }
    expect(read("ios/App/App/MainViewController.swift")).toContain(
      "bridge.registerPluginInstance(SuiteShareStagingPlugin())",
    );
    const source = read("ios/App/App/SuiteShareStagingPlugin.swift");
    expect(source).toContain('jsName = "SuiteShareStaging"');
    for (const method of ["begin", "writeChunk", "commit", "abort"]) {
      expect(source).toContain(`CAPPluginMethod(name: "${method}"`);
    }
    expect(source).toContain("self.store().commit(id: id).absoluteString");
    expect(read("ios/App/Shared/ShareOutStore.swift")).not.toMatch(/import (Capacitor|UIKit)/);
  });

  // AUTHORED-BY Claude Opus 5.5
  test("registers the iOS PDF handoff, which previews read-only and deletes the file on close", () => {
    expect(read("ios/App/App/MainViewController.swift")).toContain(
      "bridge.registerPluginInstance(SuiteFilesPlugin())",
    );
    const source = read("ios/App/App/SuiteFilesPlugin.swift");
    expect(source).toContain('jsName = "SuiteFiles"');
    for (const method of ["pdfBegin", "pdfChunk", "pdfOpen", "pdfClear"]) {
      expect(source).toContain(`CAPPluginMethod(name: "${method}"`);
    }
    expect(source).toContain("QLPreviewController.canPreview(file as NSURL)");
    // Sign-out closes the viewer this plugin presented and empties the store (sst-8wx.18).
    expect(source).toMatch(
      /func pdfClear\(_ call: CAPPluginCall\) \{\s*queue\.async \{[\s\S]*?store\(\)\.clear\(\)[\s\S]*?DispatchQueue\.main\.async \{[\s\S]*?self\.close\(viewer\)/,
    );
    expect(source).toMatch(
      /isBeingPresented, let coordinator = viewer\.transitionCoordinator[\s\S]*?presentingViewController\?\.dismiss\(animated: false\)/,
    );
    expect(source).toMatch(/editingModeFor previewItem[^}]*\.disabled/);
    expect(source).toMatch(/previewControllerDidDismiss[\s\S]*release\(file\)/);
    // A stale caller's refusal must not clear the live preview; expiry uses the monotonic clock.
    expect(source).not.toMatch(/func reject[^}]*clear\(\)/);
    expect(source).toContain("UIApplication.willEnterForegroundNotification");
    expect(read("ios/App/App/PdfPreviewStore.swift")).not.toContain("Date()");
    const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
    for (const file of [
      "PdfPreviewStore.swift",
      "SuiteFilesPlugin.swift",
      "PdfPreviewStoreTests.swift",
    ])
      expect(pbxproj).toContain(`/* ${file} in Sources */`);
  });

  test("replaces @capacitor/share on iOS so only committed staged files can be shared", () => {
    const main = read("ios/App/App/MainViewController.swift");
    // Registered after the staging plugin, and after Capacitor's own plugins have loaded.
    expect(main.indexOf("registerPluginInstance(SuiteSharePlugin())")).toBeGreaterThan(
      main.indexOf("registerPluginInstance(SuiteShareStagingPlugin())"),
    );
    const source = read("ios/App/App/SuiteSharePlugin.swift");
    expect(source).toContain('jsName = "Share"');
    expect(source).toContain("committed: SuiteShareStagingPlugin.committedFile");
    expect(source).toContain('parsed.scheme == "https"');
    // Capacitor falls back to NSClassFromString for unknown plugin ids, so the upstream class must
    // not be linked at all.
    const spm = read("ios/App/CapApp-SPM/Package.swift");
    expect(spm).toContain("CapacitorApp");
    expect(spm).not.toContain("CapacitorShare");
  });

  test("embeds a Share Extension that shares the App Group with the app", () => {
    expect(pbxproj).toContain('productType = "com.apple.product-type.app-extension";');
    expect(pbxproj).toContain("ShareExtension.appex in Embed Foundation Extensions");
    expect(pbxproj).toContain("PRODUCT_BUNDLE_IDENTIFIER = org.jeswr.suite.share;");
    expect(pbxproj.match(/ShareStore\.swift in Sources \*\/,/g)).toHaveLength(2);
    expect(pbxproj).toContain("CODE_SIGN_ENTITLEMENTS = App/App.entitlements;");
    expect(pbxproj).toContain(
      "CODE_SIGN_ENTITLEMENTS = ShareExtension/ShareExtension.entitlements;",
    );
    for (const path of [
      "ios/App/App/App.entitlements",
      "ios/App/ShareExtension/ShareExtension.entitlements",
    ]) {
      expect(read(path)).toContain("<string>group.org.jeswr.suite</string>");
    }
    const info = read("ios/App/ShareExtension/Info.plist");
    expect(info).toContain("<string>com.apple.share-services</string>");
    expect(info).not.toContain("TRUEPREDICATE");
  });

  test("the shared App scheme runs the hosted XCTest bundle", () => {
    const target = pbxproj.match(
      /([A-F0-9]{24}) \/\* AppTests \*\/ = \{\s*isa = PBXNativeTarget;[\s\S]*?productType = "com\.apple\.product-type\.bundle\.unit-test";\s*\};/,
    );
    expect(target).not.toBeNull();
    expect(pbxproj).toContain("PRODUCT_BUNDLE_IDENTIFIER = org.jeswr.suite.tests;");
    expect(pbxproj).toContain('BUNDLE_LOADER = "$(TEST_HOST)";');
    expect(pbxproj).toContain(
      'TEST_HOST = "$(BUILT_PRODUCTS_DIR)/App.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/App";',
    );
    for (const file of [
      "SuiteOriginTests.swift",
      "SuiteAuthSessionPluginTests.swift",
      "BridgeOriginGuardTests.swift",
      "ShareStoreTests.swift",
    ]) {
      expect(pbxproj).toContain(`${file} in Sources */,`);
      expect(read(`ios/App/AppTests/${file}`)).toContain("@testable import App");
    }
    const scheme = read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme");
    const testAction = scheme.match(/<TestAction\b[\s\S]*?<\/TestAction>/)?.[0];
    expect(testAction).toMatch(/<TestableReference\s+skipped = "NO"/);
    expect(testAction).toContain(`BlueprintIdentifier = "${target?.[1]}"`);
    expect(testAction).toContain('BuildableName = "AppTests.xctest"');
    for (const action of ["BuildAction", "LaunchAction"]) {
      expect(scheme.match(new RegExp(`<${action}\\b[\\s\\S]*?</${action}>`))?.[0]).toContain(
        'BuildableName = "App.app"',
      );
    }
  });

  test("boots through the guarded view controller", () => {
    expect(read("ios/App/App/SceneDelegate.swift")).toContain("MainViewController()");
    expect(read("ios/App/App/Base.lproj/Main.storyboard")).toContain(
      'customClass="MainViewController"',
    );
    const controller = read("ios/App/App/MainViewController.swift");
    expect(controller).toContain('removeScriptMessageHandler(forName: "bridge")');
    expect(controller).toContain("BridgeOriginGuard(");
    // Unregistered plugin ids would make Capacitor replace a live plugin with a fresh instance.
    expect(controller).toContain("bridge?.plugin(withName: name) != nil");
    expect(read("ios/App/App/BridgeOriginGuard.swift")).toContain("Self.admits(body: message.body");
    expect(controller).toContain("registerPluginInstance(SuiteShareIntakePlugin())");
    expect(read("ios/App/App/BridgeOriginGuard.swift")).toContain("message.frameInfo.isMainFrame");
    expect(controller).toContain("UIDelegateOriginGuard(");
    expect(read("ios/App/App/BridgeOriginGuard.swift")).toContain(
      "runJavaScriptTextInputPanelWithPrompt",
    );
  });
});

describe("release builds ignore the debug opt-in", () => {
  // MOBILE_DEBUG=1 turns on webContentsDebuggingEnabled in the generated config; native code
  // switches inspection back off unless the build itself is a debug build (sst-8wx.17).
  test("Android disables WebView debugging unless the app is debuggable", () => {
    const activity = read("android/app/src/main/java/org/jeswr/suite/MainActivity.java");
    const load = activity.slice(activity.indexOf("protected void load()"));
    const guard =
      "if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) {\n" +
      "            WebView.setWebContentsDebuggingEnabled(false);\n        }";
    expect(load).toContain(guard);
    // After Capacitor applies the config, and before any early return.
    expect(load.indexOf("super.load();")).toBeLessThan(load.indexOf(guard));
    expect(load.indexOf(guard)).toBeLessThan(load.indexOf("usesProxyInjection()"));
  });

  test("iOS Release builds are never inspectable", () => {
    const controller = read("ios/App/App/MainViewController.swift");
    const didLoad = controller.slice(controller.indexOf("func capacitorDidLoad()"));
    expect(didLoad).toMatch(
      /#if !DEBUG\n(?:\s*\/\/.*\n)*\s*if #available\(iOS 16\.4, \*\) \{\n\s*webView\?\.isInspectable = false\n\s*\}\n\s*#endif/,
    );
    expect(didLoad.indexOf("#if !DEBUG")).toBeLessThan(didLoad.indexOf("registerPluginInstance"));
    // DEBUG is defined for the Debug configurations only, in either flag spelling, and no Release
    // configuration inherits settings from an xcconfig this test cannot see.
    const project = read("ios/App/App.xcodeproj/project.pbxproj");
    const release = [
      ...project.matchAll(/\{\n\t\t\tisa = XCBuildConfiguration;[\s\S]*?name = (\w+);/g),
    ]
      .filter((m) => m[1] === "Release")
      .map((m) => m[0]);
    expect(release.length).toBeGreaterThan(0);
    for (const config of release)
      expect(config).not.toMatch(
        /SWIFT_ACTIVE_COMPILATION_CONDITIONS[^;]*DEBUG|-D\W*DEBUG\b|\bDEBUG=1|baseConfigurationReference/,
      );
  });
});

describe("Android project", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const debugManifest = read("android/app/src/debug/AndroidManifest.xml");

  test("registers staging and exposes only the share-out cache through FileProvider", () => {
    expect(read("android/app/src/main/java/org/jeswr/suite/MainActivity.java")).toContain(
      "registerPlugin(SuiteShareStagingPlugin.class)",
    );
    const paths = read("android/app/src/main/res/xml/file_paths.xml");
    const entries = [...paths.matchAll(/<([a-z-]+)\s+name="([^"]+)"\s+path="([^"]+)"\s*\/>/g)].map(
      (match) => match.slice(1),
    );
    expect(entries).toEqual([
      ["cache-path", "share_out", "share-out/"],
      ["cache-path", "pdf_preview", "pdf-preview/"],
    ]);
    expect(paths).not.toMatch(/<(?:external|root|files)-path/);
    expect(manifest).toContain('android:resource="@xml/file_paths"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Android manifest placeholder is literal.
    expect(manifest).toContain('android:authorities="${applicationId}.fileprovider"');
    const source = read("android/app/src/main/java/org/jeswr/suite/SuiteShareStagingPlugin.java");
    expect(source).toContain('@CapacitorPlugin(name = "SuiteShareStaging")');
    for (const method of ["begin", "writeChunk", "commit", "abort"]) {
      expect(source).toContain(`public void ${method}(PluginCall call)`);
    }
    expect(source).toContain('result.put("uri", Uri.fromFile(file).toString())');
  });

  // AUTHORED-BY Claude Opus 5.5
  test("registers the PDF handoff, which opens a read-only FileProvider URI after a viewer check", () => {
    expect(read("android/app/src/main/java/org/jeswr/suite/MainActivity.java")).toContain(
      "registerPlugin(SuiteFilesPlugin.class)",
    );
    const source = read("android/app/src/main/java/org/jeswr/suite/SuiteFilesPlugin.java");
    expect(source).toContain('@CapacitorPlugin(name = "SuiteFiles")');
    for (const method of ["pdfBegin", "pdfChunk", "pdfOpen", "pdfClear"]) {
      expect(source).toContain(`public void ${method}(PluginCall call)`);
    }
    expect(source).toContain('setDataAndType(uri, "application/pdf")');
    expect(source).toContain("addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)");
    expect(source).not.toContain("FLAG_GRANT_WRITE_URI_PERMISSION");
    expect(source.indexOf("resolveActivity")).toBeLessThan(source.indexOf("startActivity"));
    expect(source).toContain('"pdf-preview"');
    // One store per process, swept on resume, a stale caller's refusal never clears the live
    // preview, and expiry uses the monotonic clock.
    expect(source).toContain("private static PdfPreviewStore store;");
    expect(source).toMatch(/handleOnResume\(\)[\s\S]*sweep\(SystemClock\.elapsedRealtime\(\)\)/);
    expect(source).not.toContain("currentTimeMillis");
    // Only sign-out's pdfClear empties the whole store (sst-8wx.18). It first revokes every
    // viewer grant under pdf-preview/, independently of the delete.
    const clearCall =
      /public void pdfClear\(PluginCall call\) \{\s*boolean revoked = false;\s*try \{[\s\S]*?\.path\(PREVIEW_PATH_NAME\)[\s\S]*?revokeUriPermission\(previews, Intent\.FLAG_GRANT_READ_URI_PERMISSION\);\s*revoked = true;\s*\} catch \(RuntimeException ignored\) \{[\s\S]*?\}\s*try \{\s*store\(\)\.clear\(\);[\s\S]*?if \(revoked\) call\.resolve\(\);\s*else call\.reject\([\s\S]*?\n {4}\}\n/;
    expect(source).toContain('PREVIEW_PATH_NAME = "pdf_preview";');
    expect(read("android/app/src/main/res/xml/file_paths.xml")).toContain(
      '<cache-path name="pdf_preview" path="pdf-preview/" />',
    );
    expect(source).toMatch(clearCall);
    expect(source.replace(clearCall, "")).not.toContain("store().clear()");
    expect(manifest).toMatch(
      /<queries>\s*<intent>\s*<action android:name="android.intent.action.VIEW" \/>\s*<data android:mimeType="application\/pdf" \/>\s*<\/intent>\s*<\/queries>/,
    );
  });

  test("disables backup and cleartext in the main manifest", () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).not.toContain("networkSecurityConfig");
    expect(debugManifest).toContain("network_security_config");
  });

  test("exports only the launcher, the redirect receiver and the share receiver", () => {
    const exported = [
      ...manifest.matchAll(/android:name="([^"]+)"[^>]*?android:exported="true"/gs),
    ].map((m) => m[1]);
    const activities = [
      ...manifest.matchAll(
        /<activity[\s\S]*?android:name="([^"]+)"[\s\S]*?android:exported="(true|false)"/g,
      ),
    ]
      .filter((m) => m[2] === "true")
      .map((m) => m[1]);
    expect(activities.sort()).toEqual([
      ".AuthRedirectActivity",
      ".MainActivity",
      ".ShareReceiverActivity",
    ]);
    expect(exported).not.toContain(".AuthManagementActivity");
  });

  test("the redirect filter matches the scheme only, with no host or path", () => {
    const filter = manifest.match(/<data android:scheme="org\.jeswr\.suite"[^>]*\/>/);
    expect(filter?.[0]).toBe('<data android:scheme="org.jeswr.suite" />');
  });

  test("the share receiver takes SEND intents only and refuses its own providers", () => {
    const receiver = manifest.match(
      /<activity[^>]*?android:name="\.ShareReceiverActivity"[\s\S]*?<\/activity>/,
    );
    expect(receiver?.[0]).toContain('<action android:name="android.intent.action.SEND" />');
    expect(receiver?.[0]).toContain(
      '<action android:name="android.intent.action.SEND_MULTIPLE" />',
    );
    expect(receiver?.[0]).not.toContain("android.intent.action.VIEW");
    const source = read("android/app/src/main/java/org/jeswr/suite/ShareReceiverActivity.java");
    expect(source).toContain("ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())");
    expect(source).toContain("getPackageName().equals(provider.packageName)");
    expect(read("android/app/src/main/java/org/jeswr/suite/MainActivity.java")).toContain(
      "registerPlugin(SuiteShareIntakePlugin.class)",
    );
  });

  test("the main activity refuses the legacy bridge", () => {
    const activity = read("android/app/src/main/java/org/jeswr/suite/MainActivity.java");
    expect(activity).toContain("WebViewFeature.WEB_MESSAGE_LISTENER");
    expect(activity).toContain("WebViewFeature.DOCUMENT_START_SCRIPT");
    expect(activity).toContain("usesProxyInjection()");
    expect(activity).toContain("new SuiteWebViewClient(bridge)");
    expect(activity).toContain('"CapacitorCookiesAndroidInterface"');
    expect(activity).toContain('"CapacitorHttpAndroidInterface"');
  });
});

describe("mobile CI emulator guardrails", () => {
  const workflow = read("../../.github/workflows/mobile.yml");
  const job = workflow.match(/^ {2}android-e2e:\n[\s\S]*?(?=^ {2}[\w-]+:|$(?![\s\S]))/m)?.[0] ?? "";

  test("uses only the approved first-party actions throughout mobile CI", () => {
    const actions = [...workflow.matchAll(/\buses:\s*([^\s#]+)/g)].map((match) => match[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/^(actions\/[\w-]+|pnpm\/action-setup)@/);
  });

  test("boots a hardware-accelerated x86_64 google_apis emulator directly", () => {
    expect(job).toContain("runs-on: ubuntu-latest");
    expect(job).toContain("timeout-minutes: 45");
    expect(job).toContain("java-version: 21");
    expect(job).toContain("node-version: 24");
    expect(job).toContain('KERNEL=="kvm"');
    expect(job).toContain("udevadm trigger --name-match=kvm");
    expect(job).toMatch(/sdkmanager .*system-images;android-(34|35);google_apis;x86_64/);
    expect(job).toContain("avdmanager create avd");
    expect(job).toContain("emulator -avd suite-e2e");
    expect(job).toContain("-accel on");
    expect(job).toContain("sys.boot_completed");
    expect(job).toContain("Android boot timed out");
  });

  test("builds and exercises only the fixture debug APK", () => {
    expect(job).toContain("SUITE_URL: http://localhost:4173");
    expect(job).toContain('MOBILE_DEBUG: "1"');
    expect(job).toContain("pnpm --filter @jeswr/app-mobile run sync:android");
    expect(job).toMatch(/run: \.\/gradlew --no-daemon --stacktrace assembleDebug\s/);
    expect(job).not.toMatch(/assembleRelease|bundleRelease|signingConfig|download-artifact/);
    expect(job).toContain("node apps/mobile/e2e/android-e2e.mjs");
    const driver = read("e2e/android-e2e.mjs");
    expect(driver).toContain("../android/app/build/outputs/apk/debug/app-debug.apk");
    expect(driver).not.toContain("app-release");
    // A rejected physical device never gets logcat collection or a force-stop.
    expect(driver).toContain("if (emulatorVerified) {");
    expect(driver).toContain('() => emulatorVerified && shell("am", "force-stop", APP)');
    expect(job).toContain("if: failure()");
    expect(job).toContain("adb logcat -d -v threadtime");
    expect(job).toContain("name: android-e2e-diagnostics");
    expect(job).toContain("path: apps/mobile/e2e/artifacts/");
  });

  test("secure-store lane inspects real state, attempts both prompts and always preserves the report", () => {
    const driver = read("e2e/android-e2e.mjs");
    expect(driver).toContain("checkSecureStoreFixture(report.fixture)");
    expect(driver).toContain('const directory = "no_backup/securestore"');
    expect(driver).toContain('shell("run-as", APP, "find", directory, "-type", "f")');
    expect(driver).toContain('shell("run-as", APP, "base64", path)');
    expect(driver).toContain("checkSecureStoreFiles(files, report.fixture.secureStore.marker)");
    expect(driver).toContain('shell("locksettings", "set-pin", "1234")');
    expect(driver).toContain('shell("locksettings", "verify", "--old", "1234")');
    expect(driver).toContain('adb(["emu", "finger", "touch", "1"])');
    expect(driver).toContain('for (const path of ["fingerprint", "credential"])');
    expect(driver).toContain("attemptGatedUnwrap(path, io)");
    expect(driver).toContain("checkGatedUnwrap(verdict)");
    expect(driver).toContain("not automatable on this runner");
    expect(driver).toContain("window.__e2eSecureStore.cleanup()");
    const finalCleanup = driver.slice(driver.lastIndexOf("} finally {"));
    expect(finalCleanup).toContain("if (pinInstalled)");
    expect(finalCleanup).toContain("clearEmulatorPin(shell)");
    const unsecured = driver.indexOf("await assertUnsecuredEmulator(shell)");
    const armed = driver.indexOf("pinInstalled = true");
    const mutation = driver.indexOf('shell("locksettings", "set-pin", "1234")');
    expect(unsecured).toBeGreaterThan(-1);
    expect(armed).toBeGreaterThan(unsecured);
    expect(mutation).toBeGreaterThan(armed);
    expect(job).toMatch(
      /- if: always\(\)\n\s+uses: actions\/upload-artifact@v4\n\s+with:\n\s+name: android-e2e-diagnostics/,
    );
    // Production preparation's explicit files stay independent of the remote fixture map.
    expect(read("scripts/prepare-www.ts")).not.toContain("secure-store.js");
  });

  test("bounds boot commands and failure diagnostics so artifacts can still upload", () => {
    const boot = job.match(/ {6}- name: Create and boot the AVD\n[\s\S]*?(?= {6}- )/)?.[0] ?? "";
    expect(boot).toContain("timeout-minutes: 10");
    expect(boot).not.toContain("adb wait-for-device");
    expect(boot).toContain("deadline=$((SECONDS + 420))");
    expect(job).toMatch(/- name: Print the emulator log\n {8}if: failure\(\)/);
    expect(boot).toContain('export ANDROID_AVD_HOME="$RUNNER_TEMP/avd"');
    const shellCalls = boot.split("\n").filter((line) => line.includes("adb shell"));
    expect(shellCalls).toHaveLength(5);
    for (const line of shellCalls) expect(line).toContain("timeout 10 adb shell");
    const diagnostics =
      job.match(/ {6}- name: Collect emulator logcat\n[\s\S]*?(?= {6}- )/)?.[0] ?? "";
    expect(diagnostics).toContain("timeout-minutes: 1");
    expect(diagnostics).toContain("timeout 30 adb logcat -d -v threadtime");
    expect(diagnostics).toContain("|| true");
  });
});

describe("mobile CI iOS fixture guardrails", () => {
  const workflow = read("../../.github/workflows/mobile.yml");
  const job = workflow.match(/^ {2}ios-e2e:\n[\s\S]*?(?=^ {2}[\w-]+:|$(?![\s\S]))/m)?.[0] ?? "";
  const ios = workflow.match(/^ {2}ios:\n[\s\S]*?(?=^ {2}[\w-]+:|$(?![\s\S]))/m)?.[0] ?? "";
  const releaseGuard =
    ios.match(/ {6}- name: Reject fixture ATS in Release builds\n[\s\S]*?(?= {6}- )/)?.[0] ?? "";

  test("keeps fixture debug settings out of the policy build", () => {
    expect(ios).toContain("pnpm --filter @jeswr/app-mobile run sync:ios");
    expect(ios.replace(releaseGuard, "")).not.toMatch(/MOBILE_DEBUG|SUITE_URL|ios-e2e\.mjs/);
    expect(job).toContain("runs-on: macos-15");
    expect(job).toContain("timeout-minutes: 45");
    expect(job).toContain("node-version: 24");
    expect(job).toContain("SUITE_URL: http://localhost:4173");
    expect(job).toContain('MOBILE_DEBUG: "1"');
    expect(job).toContain("pnpm --filter @jeswr/app-mobile run sync:ios");
    expect(job).toContain("node apps/mobile/e2e/ios-e2e.mjs");
    // Lockfile-only PRs that leave the mobile closure unchanged skip it, like the other native jobs.
    expect(job).toContain("needs: scope");
    expect(job).toContain("needs.scope.outputs.run == 'false'");
  });

  test("requires a Release build to reject fixture ATS and restores production preparation", () => {
    expect(releaseGuard).toContain(
      "SUITE_URL=http://localhost:4173 MOBILE_DEBUG=1 pnpm --filter @jeswr/app-mobile run www",
    );
    expect(releaseGuard).not.toContain("cap sync");
    expect(releaseGuard).toContain("if env -u SUITE_URL -u MOBILE_DEBUG xcodebuild");
    expect(releaseGuard).toContain("-configuration Release");
    expect(releaseGuard).toContain(
      '-sdk iphonesimulator -destination "generic/platform=iOS Simulator"',
    );
    expect(releaseGuard).toContain(
      "ENABLE_USER_SCRIPT_SANDBOXING=YES CODE_SIGNING_ALLOWED=NO build",
    );
    expect(releaseGuard).toContain("Release build unexpectedly accepted fixture ATS");
    expect(releaseGuard).toContain("exit 1");
    expect(releaseGuard).toContain(
      'grep -F "error: NSAppTransportSecurity is forbidden in non-Debug builds"',
    );
    expect(releaseGuard).toContain("trap restore_production EXIT");
    expect(releaseGuard).toContain(
      "env -u SUITE_URL -u MOBILE_DEBUG pnpm --filter @jeswr/app-mobile run www",
    );
    expect(ios.indexOf("Simulator compile (no signing)")).toBeLessThan(ios.indexOf(releaseGuard));
    expect(ios.indexOf(releaseGuard)).toBeLessThan(ios.indexOf("XCTest policies"));
  });

  test("mirrors Xcode and iPhone selection, and bounds simulator pre-boot", () => {
    expect(job).toContain("/Applications/Xcode_2[6-9]*.app");
    expect(job).toContain('sudo xcode-select -s "$xcode"');
    expect(job).toContain("com.apple.CoreSimulator.SimRuntime.iOS-");
    expect(job).toContain("com.apple.CoreSimulator.SimDeviceType.iPhone");
    expect(job).toContain("version >= (16,)");
    expect(job).toContain("['simctl', 'bootstatus', udid, '-b']");
    expect(job).toContain("timeout: 240000");
    expect(job).toContain("timeout-minutes: 6");
    expect(job.indexOf("bootstatus")).toBeLessThan(job.indexOf("run sync:ios"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub Actions expression.
    expect(job).toContain("TEST_DESTINATION: ${{ steps.simulator.outputs.destination }}");
  });

  test("uploads the result bundle and artifacts on failure", () => {
    expect(job).toContain("if: failure()");
    expect(job).toContain("uses: actions/upload-artifact@v4");
    expect(job).toContain("name: ios-e2e-diagnostics");
    expect(job).toContain("path: apps/mobile/e2e/artifacts/");
    const driver = read("e2e/ios-e2e.mjs");
    expect(driver).toContain('join(artifacts, "AppUITests.xcresult")');
    expect(driver).toContain('"-only-testing:AppUITests"');
    expect(driver).toMatch(/"-configuration",\s*"Debug"/);
  });
});

describe("bundled-mode wiring (MOB-P3 E4, E5)", () => {
  test("Android serves the local origin before Capacitor and fails closed without a manifest", () => {
    const client = read("android/app/src/main/java/org/jeswr/suite/SuiteWebViewClient.java");
    const intercept = client.slice(
      client.indexOf("public WebResourceResponse shouldInterceptRequest("),
    );
    const serve = intercept.indexOf("bundled.serve(");
    expect(serve).toBeGreaterThan(-1);
    expect(intercept.indexOf("BundledServer.isNativeFilePath(")).toBeLessThan(serve);
    expect(
      intercept.indexOf("return super.shouldInterceptRequest(view, request);"),
    ).toBeGreaterThan(serve);
    expect(client).toContain('getAssets().open("public/route-manifest.json")');
    expect(client).toContain("if (isDocumentRequest(request)) return forbidden();");
    // Capacitor's local server answers http://localhost too; only the exact app origin is served.
    expect(
      intercept.indexOf("isOtherLocalOrigin(request.getUrl())) return forbidden();"),
    ).toBeLessThan(intercept.indexOf("BundledServer.isNativeFilePath("));
    expect(
      intercept.indexOf("isOtherLocalOrigin(request.getUrl())) return forbidden();"),
    ).toBeGreaterThan(-1);
    const activity = read("android/app/src/main/java/org/jeswr/suite/MainActivity.java");
    expect(activity).toMatch(
      /client = new SuiteWebViewClient\(bridge\);\s*\} catch \(RuntimeException e\) \{/,
    );
  });

  test("iOS wraps Capacitor's local scheme handler and blocks device-file navigations first", () => {
    const controller = read("ios/App/App/MainViewController.swift");
    expect(controller).toContain("SuiteBundledWebViewConfiguration.adopting(base)");
    expect(controller).toContain('fatalError("Bundled mode needs public/route-manifest.json")');
    const navigation = read("ios/App/App/SuiteNavigationPlugin.swift");
    expect(navigation.indexOf("isLocalDeviceFile(url")).toBeLessThan(
      navigation.indexOf("navigationAction.targetFrame?.isMainFrame"),
    );
    const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
    for (const file of [
      "RouteResolver.swift",
      "SuiteSchemeHandler.swift",
      "RouteResolverTests.swift",
      "SuiteSchemeHandlerTests.swift",
    ]) {
      expect(pbxproj).toContain(`/* ${file} in Sources */,`);
    }
  });
});
