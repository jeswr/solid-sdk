// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { DEFAULT_SUITE_URL } from "../src/config.ts";
import {
  prepareNative,
  renderOfflinePage,
  withAppBoundDomain,
  withLocalNetworking,
} from "../src/www.ts";

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
    expect(entries).toEqual([["cache-path", "share_out", "share-out/"]]);
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

  test("spends macOS runners only on PRs that touch the mobile projects", () => {
    const pr = workflow.match(/^ {2}pull_request:\n([\s\S]*?)^ {2}push:/m)?.[1] ?? "";
    const push = workflow.match(/^ {2}push:\n([\s\S]*?)^\S/m)?.[1] ?? "";
    expect(pr).toContain('"apps/mobile/**"');
    expect(pr).toContain('"packages/suite-native/**"');
    expect(pr).not.toContain("pnpm-lock.yaml");
    expect(push).toContain("branches: [main]");
    expect(push).toContain('"pnpm-lock.yaml"');
    expect(workflow).toContain("cancel-in-progress: true");
  });

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
