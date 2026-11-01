// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.security.Key;
import java.security.KeyFactory;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import javax.crypto.AEADBadTagException;
import javax.crypto.BadPaddingException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/** JCA record encryption; Keystore access and platform error classification are injected. */
final class SecureStoreCipher implements SecureStore.Crypto {
    interface Keys {
        Material find(String alias) throws Exception;
        Material generate(String alias, boolean gated) throws Exception;
        void delete(String alias) throws Exception;
        SecureStore.Status status() throws Exception;
        default Exception failure(Exception error) { return error; }
    }
    static final class Material {
        final Key encryption, decryption;
        Material(Key encryption, Key decryption) { this.encryption = encryption; this.decryption = decryption; }
    }
    static final OAEPParameterSpec OAEP = new OAEPParameterSpec(
        "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT);
    private final Keys keys;
    private final SecureRandom random;

    SecureStoreCipher(Keys keys) { this(keys, new SecureRandom()); }
    SecureStoreCipher(Keys keys, SecureRandom random) { this.keys = keys; this.random = random; }

    static String alias(String namespace, String keyId, boolean gated) {
        return (gated ? "suite-securestore-gated." : "suite-securestore.") + namespace + "." + keyId;
    }
    private static String alias(SecureStoreCodec.Record record) { return alias(record.namespace, record.keyId, record.gated); }
    @Override public SecureStore.Status status() throws Exception { return keys.status(); }

    @Override public SecureStoreCodec.Record seal(String namespace, String key, byte[] value, boolean gated,
            SecureStoreCodec.Record previous) throws Exception {
        String keyId = previous != null && previous.gated == gated ? previous.keyId : null;
        Material material = null;
        if (keyId != null) {
            String alias = alias(namespace, keyId, gated);
            try {
                material = keys.find(alias);
                if (material == null) throw new SecureStore.Unrecoverable(true);
                // Cipher.init probes invalidation before the public key can wrap a new token.
                if (gated) decryptCipher(material.decryption);
            } catch (Exception e) {
                Exception failure = keys.failure(e);
                if (!(failure instanceof SecureStore.Unrecoverable)) throw failure;
                keys.delete(alias);
                material = null;
            }
        }
        if (material == null) {
            byte[] id = new byte[16]; random.nextBytes(id); keyId = SecureStoreValidation.hex(id);
            material = keys.generate(alias(namespace, keyId, gated), gated);
        }
        byte[] dataKey = null;
        try {
            byte[] wrapped = new byte[0];
            Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
            if (gated) {
                dataKey = new byte[32]; random.nextBytes(dataKey);
                // Re-import the certificate key so wrapping uses a software public-key operation.
                Key publicKey = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(material.encryption.getEncoded()));
                Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPPadding");
                rsa.init(Cipher.ENCRYPT_MODE, publicKey, OAEP);
                wrapped = rsa.doFinal(dataKey);
                byte[] nonce = new byte[12]; random.nextBytes(nonce);
                aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(dataKey, "AES"), new GCMParameterSpec(128, nonce));
            } else {
                // Android Keystore generates the IV; caller-supplied encryption IVs are disabled.
                aes.init(Cipher.ENCRYPT_MODE, material.encryption);
            }
            if (aes.getIV().length != 12) throw new SecureStoreException("failed");
            aes.updateAAD(SecureStoreCodec.associatedData(namespace, key, gated, keyId));
            return new SecureStoreCodec.Record(namespace, key, gated, keyId, aes.getIV(), wrapped, aes.doFinal(value));
        } catch (Exception e) { throw keys.failure(e); }
        finally { if (dataKey != null) Arrays.fill(dataKey, (byte) 0); }
    }

    @Override public Object prepare(SecureStoreCodec.Record record) throws Exception {
        try { return decryptCipher(material(record).decryption); }
        catch (Exception e) { throw keys.failure(e); }
    }

    private static Cipher decryptCipher(Key key) throws Exception {
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, OAEP);
        return cipher;
    }

    private Material material(SecureStoreCodec.Record record) throws Exception {
        Material material = keys.find(alias(record));
        if (material == null) throw new SecureStore.Unrecoverable(true);
        return material;
    }

    @Override public byte[] open(SecureStoreCodec.Record record, Object authorization) throws Exception {
        byte[] dataKey = null;
        try {
            Key key;
            if (record.gated) {
                if (!(authorization instanceof Cipher)) throw new SecureStoreException("failed");
                dataKey = ((Cipher) authorization).doFinal(record.wrappedKey);
                if (dataKey.length != 32) throw new SecureStore.Unrecoverable(false);
                key = new SecretKeySpec(dataKey, "AES");
            } else { key = material(record).decryption; }
            Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
            aes.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, record.nonce));
            aes.updateAAD(SecureStoreCodec.associatedData(record.namespace, record.key, record.gated, record.keyId));
            return aes.doFinal(record.ciphertext);
        } catch (AEADBadTagException e) { throw new SecureStore.Unrecoverable(false); }
        catch (BadPaddingException e) { throw new SecureStore.Unrecoverable(false); }
        catch (Exception e) { throw keys.failure(e); }
        finally { if (dataKey != null) Arrays.fill(dataKey, (byte) 0); }
    }

    @Override public void retire(SecureStoreCodec.Record record) throws Exception { keys.delete(alias(record)); }
}
