// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.File;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Push-only storage, separate from MOB-P4. Signing private keys are never exported. */
final class PushKeys {
    private static final String WRAP = "org.jeswr.suite.push.wrap", SIGN = "org.jeswr.suite.push.sign";
    private final File file;
    private final KeyStore keystore;
    final PrivateKey privateKey;
    final byte[] publicKey, auth;

    static boolean installed(Context context) { return new File(context.getNoBackupFilesDir(), "push/keys").isFile(); }
    PushKeys(Context context, boolean create) throws Exception {
        File root = new File(context.getNoBackupFilesDir(), "push");
        if (!root.isDirectory() && !root.mkdirs()) throw new java.io.IOException("Cannot create push key store");
        file = new File(root, "keys"); keystore = KeyStore.getInstance("AndroidKeyStore"); keystore.load(null);
        if (!file.exists()) {
            if (!create) throw new java.io.IOException("Push not enabled");
            if (!keystore.containsAlias(WRAP)) {
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(WRAP, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
                generator.generateKey();
            }
            ensureSigningKey();
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC"); generator.initialize(new ECGenParameterSpec("secp256r1"));
            KeyPair pair = generator.generateKeyPair(); byte[] secret = new byte[16]; new SecureRandom().nextBytes(secret);
            Map<String, Object> material = new LinkedHashMap<>();
            material.put("privateKey", PushCrypto.b64(pair.getPrivate().getEncoded()));
            material.put("publicKey", PushCrypto.b64(PushCrypto.point((ECPublicKey) pair.getPublic()))); material.put("auth", PushCrypto.b64(secret));
            Cipher aes = Cipher.getInstance("AES/GCM/NoPadding"); aes.init(Cipher.ENCRYPT_MODE, wrappingKey());
            PushStore.write(file, PushCrypto.concat(aes.getIV(), aes.doFinal(PushCrypto.utf8(PushJson.encode(material)))));
        }
        byte[] wrapped = PushStore.read(file, 4096);
        if (wrapped.length < 28) throw new java.security.GeneralSecurityException("Invalid wrapped push key");
        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.DECRYPT_MODE, wrappingKey(), new GCMParameterSpec(128, Arrays.copyOf(wrapped, 12)));
        Map<String, Object> material = PushJson.object(PushJson.parse(new String(aes.doFinal(Arrays.copyOfRange(wrapped, 12, wrapped.length)), java.nio.charset.StandardCharsets.UTF_8)));
        privateKey = java.security.KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(PushCrypto.unb64(PushJson.string(material.get("privateKey")))));
        publicKey = PushCrypto.unb64(PushJson.string(material.get("publicKey"))); auth = PushCrypto.unb64(PushJson.string(material.get("auth")));
        if (!keystore.containsAlias(SIGN) || auth.length != 16) throw new java.security.GeneralSecurityException("Incomplete push key store");
    }
    private SecretKey wrappingKey() throws Exception { return (SecretKey) keystore.getKey(WRAP, null); }
    private void ensureSigningKey() throws Exception {
        if (keystore.containsAlias(SIGN)) return;
        if (Build.VERSION.SDK_INT >= 28) {
            try { generateSigningKey(true); return; }
            catch (java.security.GeneralSecurityException | java.security.ProviderException e) {
                // StrongBox is optional. Retry AndroidKeyStore's TEE/software provider, still non-exportable.
                if (keystore.containsAlias(SIGN)) keystore.deleteEntry(SIGN);
            }
        }
        generateSigningKey(false);
    }
    private void generateSigningKey(boolean strongBox) throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(SIGN, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256);
        if (Build.VERSION.SDK_INT >= 28) spec.setIsStrongBoxBacked(strongBox);
        generator.initialize(spec.build()); generator.generateKeyPair();
    }
    Map<String, Object> publicSigningKey() throws Exception {
        ECPublicKey key = (ECPublicKey) keystore.getCertificate(SIGN).getPublicKey();
        Map<String, Object> jwk = new LinkedHashMap<>(); jwk.put("kty", "EC"); jwk.put("crv", "P-256");
        jwk.put("x", PushCrypto.b64(PushCrypto.coordinate(key.getW().getAffineX())));
        jwk.put("y", PushCrypto.b64(PushCrypto.coordinate(key.getW().getAffineY()))); return jwk;
    }
    byte[] sign(byte[] bytes) throws java.security.GeneralSecurityException {
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign((PrivateKey) keystore.getKey(SIGN, null)); signature.update(bytes); return signature.sign();
    }
    static void delete(Context context) throws Exception {
        File file = new File(context.getNoBackupFilesDir(), "push/keys");
        if (file.exists() && !file.delete()) throw new java.io.IOException("Cannot delete push keys");
        KeyStore keystore = KeyStore.getInstance("AndroidKeyStore"); keystore.load(null);
        keystore.deleteEntry(WRAP); keystore.deleteEntry(SIGN);
    }
}
