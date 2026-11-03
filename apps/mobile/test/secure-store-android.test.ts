// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../android/app/src/main/${path}`, import.meta.url), "utf8");
const java = (name: string) => read(`java/org/jeswr/suite/${name}.java`);

describe("Android secure store guardrails", () => {
  test("registers the local plugin behind the existing guarded bridge", () => {
    expect(java("MainActivity")).toContain("registerPlugin(SuiteSecureStorePlugin.class)");
    expect(java("SuiteSecureStorePlugin")).toContain('@CapacitorPlugin(name = "SuiteSecureStore")');
    expect(java("SuiteSecureStorePlugin")).toContain("bridge.getServerUrl()");
    expect(java("SuiteSecureStorePlugin")).toContain("SecureStoreValidation.namespace(origin)");
    expect(java("MainActivity")).toContain("WebViewFeature.WEB_MESSAGE_LISTENER");
    expect(java("SuiteWebViewClient")).toContain("onPageCommitVisible");
    expect(java("SuiteWebViewClient")).toContain(".mainFrameNavigation()");
  });

  test("takes read tickets inside the origin-checked listener before Capacitor dispatch", () => {
    const activity = java("MainActivity");
    const install = activity.indexOf("new SuiteMessageHandler(bridge, webView)");
    expect(install).toBeGreaterThan(-1);
    for (const guard of [
      'WebViewCompat.removeWebMessageListener(webView, "androidBridge")',
      "bridge.getAllowedOriginRules().clear()",
      "NavigationPolicy.appUrl(bridge.getServerUrl(), bridge.getLocalUrl())",
      "bridge.getAllowedOriginRules().add(appUrl)",
    ]) {
      expect(activity.indexOf(guard)).toBeGreaterThan(-1);
      expect(activity.indexOf(guard)).toBeLessThan(install);
    }
    expect(activity.indexOf("webView.removeJavascriptInterface(name)")).toBeGreaterThan(install);
    expect(activity.indexOf("webView.loadUrl(bridge.getAppUrl())")).toBeGreaterThan(install);

    const handler = java("SuiteMessageHandler");
    expect(handler).toContain("extends MessageHandler");
    expect(handler).toContain("super(bridge, webView, null)");
    expect(handler).toContain('"get".equals(message.getString("methodName"))');
    const admit = handler.indexOf(
      '.admitRead(message.getString("callbackId"), options.opt("key"))',
    );
    expect(admit).toBeGreaterThan(handler.indexOf("if (handle == null) return"));
    expect(admit).toBeLessThan(handler.indexOf("super.postMessage(json)"));

    // The superclass owns frame/origin checks and WebMessage replies. Pin the installed source
    // contract: admission relies on its synchronous virtual call, before taskHandler dispatch.
    const capacitor = readFileSync(
      new URL(
        "../node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java",
        import.meta.url,
      ),
      "utf8",
    );
    expect(capacitor).toMatch(/if \(isMainFrame\) \{\s+postMessage\(message.getData\(\)\)/);
    expect(capacitor).toContain(
      'WebViewCompat.addWebMessageListener(webView, "androidBridge", bridge.getAllowedOriginRules(), capListener)',
    );
    expect(capacitor).toContain('String callbackId = postData.getString("callbackId")');
  });

  test("consumes admission FIFO tickets and cancels stale reads before storage work", () => {
    const plugin = java("SuiteSecureStorePlugin");
    const get = plugin.slice(
      plugin.indexOf("@PluginMethod public void get("),
      plugin.indexOf("@PluginMethod public void set("),
    );
    expect(get).toContain("ticket = operations.takeReadTicket(call.getCallbackId(), key)");
    expect(get).not.toContain("operations.ticket(");
    expect(get).toContain("operations.get(this::store, ticket,");
    expect(get.indexOf("operations.takeReadTicket(")).toBeLessThan(
      get.indexOf("operations.get(this::store, ticket,"),
    );
    expect(plugin).toContain("operations.admitRead(callbackId, key)");
    expect(plugin).toContain("void mainFrameNavigation() { operations.navigation(); }");

    const operations = java("SecureStoreOperations");
    expect(operations).toContain("synchronized void admitRead(String callbackId, Object rawKey)");
    expect(operations).toContain(".addLast(ticket(key))");
    expect(operations).toContain("Ticket ticket = tickets.removeFirst()");
    expect(operations).toContain("if (tickets.isEmpty()) admittedReads.remove(callbackId)");
    expect(operations).toContain(
      'if (!ticket.key.equals(key)) throw new SecureStoreException("cancelled")',
    );
    expect(operations).toContain("synchronized void navigation() { cancel(); }");
    expect(operations).toContain("generation++");
    const read = operations.slice(operations.indexOf("void get(StoreLoader store,"));
    expect(read).toContain("serial.execute(");
    expect(read.indexOf("check(ticket)")).toBeLessThan(read.indexOf("store.load()"));
  });

  test("pins the biometric permission, key generation and credential fallback", () => {
    expect(read("AndroidManifest.xml")).toContain(
      '<uses-permission android:name="android.permission.USE_BIOMETRIC" />',
    );
    const keys = java("SecureStoreKeys");
    expect(keys).toContain(
      'KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")',
    );
    expect(keys).toContain(
      'KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")',
    );
    expect(keys).toContain("setKeySize(gated ? 3072 : 256)");
    expect(keys).toContain("setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)");
    expect(keys).toContain("setDigests(KeyProperties.DIGEST_SHA256)");
    expect(keys).toContain("setUserAuthenticationRequired(true)");
    expect(keys).toContain(
      "setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL)",
    );
    expect(keys).toContain("setInvalidatedByBiometricEnrollment(false)");
    expect(keys).toContain("KeyProperties.BLOCK_MODE_GCM");
    expect(keys).toContain("setRandomizedEncryptionRequired(true)");
    expect(keys).toContain("setIsStrongBoxBacked(strongBox)");
    expect(keys).toContain("if (!strongBox || !strongBoxUnsupported(e)) throw e;");
    expect(keys).toContain("e instanceof InvalidAlgorithmParameterException");
    expect(keys).toContain("generate(alias, gated, false)");
    expect(keys).toContain("info.getSecurityLevel()");
    expect(keys).toContain("Build.VERSION.SDK_INT < 30");
    const prompt = java("SecureStorePrompt");
    expect(prompt).toContain("import android.hardware.biometrics.BiometricPrompt;");
    expect(prompt).toContain("new BiometricPrompt.CryptoObject((Cipher) cryptoObject)");
    expect(prompt).toContain(
      "setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL)",
    );
    expect(prompt).not.toContain("setNegativeButton");
    expect(read("res/values/strings.xml")).toContain(
      '<string name="secure_store_unlock">Unlock Solid Suite</string>',
    );
  });

  test("pins OAEP parameters on wrapping, unwrapping and the private-key rotation probe", () => {
    const cipher = java("SecureStoreCipher");
    expect(cipher).toContain(
      '"SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT',
    );
    expect(cipher).toContain("rsa.init(Cipher.ENCRYPT_MODE, publicKey, OAEP)");
    expect(cipher).toContain("cipher.init(Cipher.DECRYPT_MODE, key, OAEP)");
    expect(cipher).toContain("if (gated) decryptCipher(material.decryption)");
    expect(cipher).toContain("new GCMParameterSpec(128,");
    expect(java("SecureStoreKeys")).toContain(
      "cause instanceof KeyPermanentlyInvalidatedException",
    );
  });

  test("uses checked file persistence and keeps all secure-store sources free of preference storage", () => {
    expect(java("SuiteSecureStorePlugin")).toContain('getNoBackupFilesDir(), "securestore"');
    const file = java("SecureStoreFile");
    expect(file).toContain("new FileOutputStream(file)");
    expect(file).toContain("out.getFD().sync()");
    expect(file).toContain("out.close()");
    expect(file).toContain("from.renameTo(to)");
    expect(file).toContain("if (!io.rename(temporary, file)) throw new IOException");
    const names = readdirSync(
      new URL("../android/app/src/main/java/org/jeswr/suite", import.meta.url),
    );
    for (const name of names.filter((name) => /SecureStore.*\.java$/.test(name))) {
      const source = java(name.slice(0, -5));
      expect(source).not.toMatch(/AtomicFile|SharedPreferences/);
    }
  });

  test("retains backup and device-transfer exclusions", () => {
    const manifest = read("AndroidManifest.xml");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    const rules = read("res/xml/data_extraction_rules.xml");
    for (const section of ["cloud-backup", "device-transfer"]) {
      const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1];
      for (const domain of ["root", "file", "database", "sharedpref", "external"]) {
        expect(body).toContain(`<exclude domain="${domain}" />`);
      }
    }
  });
});
