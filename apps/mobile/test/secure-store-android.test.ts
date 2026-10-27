// AUTHORED-BY GPT-5.6 Codex
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
