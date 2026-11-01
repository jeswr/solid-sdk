// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../ios/App/${path}`, import.meta.url), "utf8");

describe("iOS secure store guardrails", () => {
  const plugin = read("App/SuiteSecureStorePlugin.swift");
  const keys = read("App/SecureStoreKeys.swift");
  const persistence = read("App/SecureStorePersistence.swift");
  const pbxproj = read("App.xcodeproj/project.pbxproj");

  test("registers the complete local plugin behind the existing bridge guard", () => {
    expect(plugin).toContain('jsName = "SuiteSecureStore"');
    for (const method of ["status", "get", "set", "remove", "clear", "cancel"]) {
      expect(plugin).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`,
      );
    }
    const main = read("App/MainViewController.swift");
    expect(main).toContain("let secureStore = SuiteSecureStorePlugin()");
    expect(main).toContain("bridge.registerPluginInstance(secureStore)");
    expect(main).toContain("BridgeOriginGuard(");
    expect(main).toContain("bridge?.plugin(withName: name) != nil");
    expect(plugin).toContain("call.reject(code, code)");
    expect(plugin.match(/call\.reject\(/g)).toHaveLength(1);
    expect(plugin).toContain("DispatchQueue(label:");
    expect(plugin).toContain("SuiteOrigin(url: bridge?.config.serverURL)");
    expect(plugin).not.toMatch(/call\.(?:getString|options).*namespace/);
  });

  test("pins device-bound Keychain storage and Secure Enclave user-presence flags", () => {
    expect(persistence).toContain('prefix = "org.jeswr.suite.securestore."');
    expect(keys).toContain("kSecClassGenericPassword");
    expect(keys).toContain("kSecAttrAccessibleWhenUnlockedThisDeviceOnly");
    expect(keys).toContain("kSecAttrSynchronizable as String: false");
    expect(keys).toContain("kSecAttrKeySizeInBits as String: 256");
    expect(keys).toContain("kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave");
    expect(keys).toContain("kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom");
    expect(keys).toContain("kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly");
    expect(keys).toContain("[.privateKeyUsage, .userPresence]");
    expect(keys).not.toMatch(/biometryCurrentSet|biometryAny|kSecAttrAccessibleAlways/);
    expect(keys).toContain('Data("\u005c(service).\u005c(keyId)".utf8)');
    expect(keys).toContain("Self.random(16)");
    expect(keys).toContain("SecureEnclave.isAvailable");
  });

  test("pins ECIES wrapping and AES-GCM associated data", () => {
    expect(keys).toMatch(
      /SecKeyCreateEncryptedData\(publicKey, \.eciesEncryptionCofactorVariableIVX963SHA256AESGCM,/,
    );
    expect(keys).toMatch(
      /SecKeyCreateDecryptedData\(key, \.eciesEncryptionCofactorVariableIVX963SHA256AESGCM,/,
    );
    const state = read("App/SecureStoreState.swift");
    expect(state).toContain('Data("SSS1".utf8)');
    expect(state).toContain("bytes.count >> 8");
    expect(state).toMatch(
      /append\(namespace\)\s+append\(key\)\s+data\.append\(mode\)\s+append\(keyId\)/,
    );
    expect(state).toContain("record.namespace == namespace, record.key == key");
    expect(state).toContain("AES.GCM.Nonce()");
    expect(state).toMatch(/AES\.GCM\.seal\([\s\S]*?authenticating: aad\)/);
    expect(state).toMatch(/AES\.GCM\.open\([\s\S]*?authenticating: aad\)/);
  });

  test("uses fresh contexts without reuse and localised native prompt text", () => {
    expect(keys).toContain("SecureStoreAuthenticationSession(isForeground: isForeground)");
    expect(keys).toContain("let context: LAContext? = LAContext()");
    expect(keys).toContain("touchIDAuthenticationAllowableReuseDuration = 0");
    expect(keys).toContain("evaluateAccessControl(accessControl, operation: .useKeyKeyExchange,");
    expect(keys).not.toContain(".useKeyDecrypt");
    expect(keys).toContain("kSecUseAuthenticationContext as String] = context");
    expect(keys).toContain("self.context?.invalidate()");
    expect(keys).toContain("DispatchQueue.main.async");
    expect(keys).toContain("guard self.isForeground()");
    expect(keys).toContain('NSLocalizedString("Unlock Solid Suite"');
    expect(read("App/en.lproj/Localizable.strings")).toContain(
      '"Unlock Solid Suite" = "Unlock Solid Suite";',
    );
    expect(plugin).toContain("windowScene?.activationState == .foregroundActive");
    expect(plugin).not.toMatch(/call\.(?:getString|options).*prompt/);
  });

  test("pins atomic protected files and install-marker prefix cleanup before serving calls", () => {
    expect(plugin).toContain(".applicationSupportDirectory");
    expect(persistence).toContain('appendingPathComponent("securestore", isDirectory: true)');
    expect(persistence).toContain('appendingPathComponent("\u005c(namespace).bin")');
    expect(persistence).toContain(
      "try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])",
    );
    expect(persistence).toContain("values.isExcludedFromBackup = true");
    expect(persistence).toContain("kSecMatchLimit as String: kSecMatchLimitAll");
    expect(persistence).toContain("wipeClass(kSecClassGenericPassword, field: kSecAttrService)");
    expect(persistence).toContain("wipeClass(kSecClassKey, field: kSecAttrApplicationTag)");
    expect(persistence).toContain("identifier?.hasPrefix(Self.prefix) == true");
    expect(persistence.indexOf("try keys.wipe()")).toBeLessThan(
      persistence.indexOf("try fm.moveItem(at: pending, to: marker)"),
    );
    const store = read("App/SecureStore.swift");
    expect(store.indexOf("try installation.prepare()")).toBeLessThan(
      store.indexOf("self.writer = try writer()"),
    );
    expect(store.indexOf("try writer.write(data)")).toBeLessThan(store.indexOf("state = next"));
    expect(plugin).toContain('"available": false');
  });

  test("cancels on lifecycle, KVO signals and commits while forwarding Capacitor's delegate", () => {
    expect(plugin).toContain("UIScene.didEnterBackgroundNotification");
    expect(plugin).toContain("UIApplication.didEnterBackgroundNotification");
    expect(plugin).toContain("UIScene.didDisconnectNotification");
    expect(plugin).toContain("@objc private func backgrounded() { cancelReads() }");
    expect(plugin).toMatch(
      /func navigationChanged\(\) \{\s+cancellation\.documentChanged\(\)\s+queue\.async/,
    );
    expect(plugin).toContain("func navigationCommitted() { navigationChanged() }");
    expect(plugin).toMatch(
      /private func cancelReads\(key: String\? = nil\) \{\s+cancellation\.cancel\(key: key\)\s+queue\.async/,
    );
    expect(plugin).toMatch(
      /DispatchQueue\.main\.async \{\s+(?:\/\/[^\n]*\s+)*cancellation\.deliver\(ticket, result\)/,
    );
    expect(plugin).toContain("store.teardown()");
    expect(plugin).toContain("webView.observe(\\.url, options: [.new])");
    expect(plugin).toContain("webView.observe(\\.isLoading, options: [.new])");
    expect(plugin).toContain("if change.newValue == true { navigated() }");
    const proxy = plugin.slice(plugin.indexOf("final class SecureStoreNavigationGuard:"));
    expect(proxy).toContain("NSObject, WKNavigationDelegate");
    expect(proxy).toContain("private weak var inner: (NSObject & WKNavigationDelegate)?");
    expect(proxy).toContain(
      "return super.responds(to: selector) || (inner?.responds(to: selector) ?? false)",
    );
    expect(proxy).toContain("override func forwardingTarget(for selector: Selector!) -> Any?");
    expect(proxy).toContain("return inner?.responds(to: selector) == true ? inner : nil");
    expect(proxy).toMatch(
      /func webView\(_ webView: WKWebView, didCommit navigation: WKNavigation!\) \{\s+committed\(\)\s+inner\?\.webView\?\(webView, didCommit: navigation\)/,
    );
    const main = read("App/MainViewController.swift");
    expect(main).toContain("private var navigationGuard: SecureStoreNavigationGuard?");
    expect(main).toContain("SecureStoreNavigationGuard(inner: handler)");
    expect(main).toContain("secureStore?.navigationCommitted()");
    expect(main).toContain("webView.navigationDelegate = navigation");
    expect(main).toContain("navigationGuard = navigation");
    expect(main).toContain("private var navigationObserver: SecureStoreNavigationObserver?");
    expect(main).toContain("SecureStoreNavigationObserver(webView: webView)");
    expect(main).toContain("secureStore?.navigationChanged()");
    expect(main).toContain("UIDelegateOriginGuard(inner: handler, allowed: allowed)");
    expect(main).toContain("bridge.webView?.uiDelegate = ui");
    const store = read("App/SecureStore.swift");
    expect(store).toContain("guard self.operations.contains(id) else { return }");
    expect(store).toContain("operations.cancel(key: key)");
    expect(store).toContain("operation.authentication.invalidate()");
  });

  test("binds read tickets to the document generation and rechecks before bridge delivery", () => {
    const store = read("App/SecureStore.swift");
    expect(store).toContain("let documentGeneration: UInt64");
    expect(store).toContain("private var documentGeneration: UInt64 = 0");
    expect(store).toContain("documentGeneration: documentGeneration)");
    expect(store).toMatch(
      /func documentChanged\(\) \{\s+lock\.lock\(\)\s+defer \{ lock\.unlock\(\) \}[\s\S]*?documentGeneration &\+= 1/,
    );
    expect(store).toContain("ticket.documentGeneration == documentGeneration");
    expect(store).toContain(
      "completion(isCurrent(ticket) ? result : .failure(SecureStoreFailure.cancelled))",
    );
    const get = plugin.slice(plugin.indexOf("@objc func get("), plugin.indexOf("@objc func set("));
    expect(get).toContain("let ticket = cancellation.ticket(key: key)");
    expect(get.indexOf("let ticket =")).toBeLessThan(get.indexOf("queue.async"));
    expect(get).toContain("self.store().get(key: key, ticket: ticket)");
    expect(get).toMatch(
      /DispatchQueue\.main\.async \{\s+(?:\/\/[^\n]*\s+)*cancellation\.deliver\(ticket, result\)/,
    );
    expect(get.indexOf("cancellation.deliver(ticket, result)")).toBeLessThan(
      get.indexOf("call.resolve("),
    );
  });

  test("localises the Face ID usage description and includes both strings resources", () => {
    expect(read("App/Info.plist")).toMatch(
      /<key>NSFaceIDUsageDescription<\/key>\s*<string>Unlock Solid Suite to access your saved session\.<\/string>/,
    );
    expect(read("App/en.lproj/InfoPlist.strings")).toContain(
      '"NSFaceIDUsageDescription" = "Unlock Solid Suite to access your saved session.";',
    );
    const resources = pbxproj.match(
      /504EC3021FED79650016851F \/\* Resources \*\/ = \{[\s\S]*?\n\t\t\};/,
    )?.[0];
    for (const file of ["InfoPlist.strings", "Localizable.strings"]) {
      expect(pbxproj).toContain(`path = en.lproj/${file};`);
      expect(pbxproj).toContain(`name = ${file};`);
      expect(resources).toContain(`${file} in Resources */,`);
    }
  });

  test.each([
    ["SuiteSecureStorePlugin.swift", false],
    ["SecureStore.swift", false],
    ["SecureStoreState.swift", false],
    ["SecureStoreKeys.swift", false],
    ["SecureStorePersistence.swift", false],
    ["SecureStoreTests.swift", true],
    ["SecureStorePersistenceTests.swift", true],
  ] as const)("adds %s to its Xcode target with unique ids", (file, isTest) => {
    const escaped = file.replaceAll(".", "\\.");
    const ref = pbxproj.match(
      new RegExp(`([A-F0-9]{24}) /\\* ${escaped} \\*/ = \\{isa = PBXFileReference;`),
    )?.[1];
    expect(ref).toBeDefined();
    const build = pbxproj.match(
      new RegExp(
        `([A-F0-9]{24}) /\\* ${escaped} in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ${ref}`,
      ),
    )?.[1];
    expect(build).toBeDefined();
    const target = isTest ? "9BD353B04D1AF808D3D99950" : "504EC3001FED79650016851F";
    const phase = pbxproj.match(
      new RegExp(`${target} /\\* Sources \\*/ = \\{[\\s\\S]*?\\n\\t\\t\\};`),
    )?.[0];
    expect(phase).toContain(`${build} /* ${file} in Sources */,`);
    expect(pbxproj).toContain(`${ref} /* ${file} */,`);
    const source = read(`${isTest ? "AppTests" : "App"}/${file}`);
    expect(source.startsWith("// AUTHORED-BY GPT-5.6 Codex\n")).toBe(true);
    if (isTest) expect(source).toContain("@testable import App");
    const definitions = [...pbxproj.matchAll(/^\s*([A-F0-9]{24})(?: \/\*[^\n]*?\*\/)? = \{/gm)].map(
      (match) => match[1],
    );
    // TargetAttributes repeats target ids inside the project object; top-level ids stay unique.
    expect(definitions.filter((id) => id === ref)).toHaveLength(1);
    expect(definitions.filter((id) => id === build)).toHaveLength(1);
  });
});
