// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { DEFAULT_SUITE_URL } from "../src/config.ts";
import { renderOfflinePage, withAppBoundDomain } from "../src/www.ts";

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
    ]) {
      expect(pbxproj).toContain(`${file} in Sources */,`);
    }
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

  test("boots through the guarded view controller", () => {
    expect(read("ios/App/App/SceneDelegate.swift")).toContain("MainViewController()");
    expect(read("ios/App/App/Base.lproj/Main.storyboard")).toContain(
      'customClass="MainViewController"',
    );
    const controller = read("ios/App/App/MainViewController.swift");
    expect(controller).toContain('removeScriptMessageHandler(forName: "bridge")');
    expect(controller).toContain("BridgeOriginGuard(");
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
    expect(activity).toContain("new SuiteWebViewClient(bridge)");
    expect(activity).toContain('"CapacitorCookiesAndroidInterface"');
    expect(activity).toContain('"CapacitorHttpAndroidInterface"');
  });
});
