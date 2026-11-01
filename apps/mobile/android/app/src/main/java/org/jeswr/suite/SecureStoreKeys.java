// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.security.keystore.UserNotAuthenticatedException;
import java.security.InvalidAlgorithmParameterException;
import java.security.Key;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.ProviderException;
import java.security.spec.AlgorithmParameterSpec;
import java.util.Enumeration;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;

/** Android Keystore adapter. No status or read path generates a key. */
final class SecureStoreKeys implements SecureStoreCipher.Keys {
    private final Context context;
    private final String namespace;
    private final KeyStore store;

    SecureStoreKeys(Context context, String namespace) throws Exception {
        this.context = context; this.namespace = namespace;
        store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    }

    @Override public SecureStoreCipher.Material find(String alias) throws Exception {
        try {
            Key key = store.getKey(alias, null);
            if (key == null) return null;
            if (key instanceof PrivateKey) {
                if (store.getCertificate(alias) == null) throw new SecureStore.Unrecoverable(true);
                return new SecureStoreCipher.Material(store.getCertificate(alias).getPublicKey(), key);
            }
            return new SecureStoreCipher.Material(key, key);
        } catch (Exception e) { throw failure(e); }
    }

    @Override public SecureStoreCipher.Material generate(String alias, boolean gated) throws Exception {
        if (gated && (Build.VERSION.SDK_INT < 30 || !canAuthenticate())) throw new SecureStoreException("unavailable");
        boolean strongBox = Build.VERSION.SDK_INT >= 28 && context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE);
        try { return generate(alias, gated, strongBox); }
        catch (Exception e) {
            if (!strongBox || !strongBoxUnsupported(e)) throw e;
            store.deleteEntry(alias);
            return generate(alias, gated, false);
        }
    }

    /**
     * A device with StrongBox need not support every spec (RSA-3072 in particular), and some
     * reject it at initialize or generate time rather than with StrongBoxUnavailableException.
     * Those failures retry in the TEE with the same key size and authentication requirements.
     */
    static boolean strongBoxUnsupported(Exception e) {
        return (Build.VERSION.SDK_INT >= 28 && e instanceof StrongBoxUnavailableException)
            || e instanceof InvalidAlgorithmParameterException
            || e instanceof ProviderException;
    }

    private SecureStoreCipher.Material generate(String alias, boolean gated, boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setKeySize(gated ? 3072 : 256);
        if (gated) {
            if (Build.VERSION.SDK_INT < 30) throw new SecureStoreException("unavailable");
            builder.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL)
                .setInvalidatedByBiometricEnrollment(false);
        } else {
            builder.setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true);
        }
        if (Build.VERSION.SDK_INT >= 28) builder.setIsStrongBoxBacked(strongBox);
        AlgorithmParameterSpec parameters = builder.build();
        if (gated) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
            generator.initialize(parameters);
            KeyPair pair = generator.generateKeyPair();
            return new SecureStoreCipher.Material(pair.getPublic(), pair.getPrivate());
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(parameters);
        SecretKey key = generator.generateKey();
        return new SecureStoreCipher.Material(key, key);
    }

    @Override public void delete(String alias) throws Exception { store.deleteEntry(alias); }

    private boolean canAuthenticate() {
        if (Build.VERSION.SDK_INT < 30) return false;
        KeyguardManager keyguard = context.getSystemService(KeyguardManager.class);
        BiometricManager manager = context.getSystemService(BiometricManager.class);
        return keyguard != null && keyguard.isDeviceSecure() && manager != null && manager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    @Override public SecureStore.Status status() throws Exception {
        boolean found = false, hardwareBacked = true;
        Enumeration<String> aliases = store.aliases();
        while (aliases.hasMoreElements()) {
            String alias = aliases.nextElement();
            if (!alias.startsWith("suite-securestore." + namespace + ".") &&
                    !alias.startsWith("suite-securestore-gated." + namespace + ".")) continue;
            Key key;
            try { key = store.getKey(alias, null); }
            catch (Exception e) {
                if (failure(e) instanceof SecureStore.Unrecoverable) continue;
                throw e;
            }
            if (key == null) continue;
            KeyInfo info;
            try {
                info = key instanceof SecretKey
                    ? (KeyInfo) SecretKeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec((SecretKey) key, KeyInfo.class)
                    : KeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
            } catch (Exception e) {
                if (failure(e) instanceof SecureStore.Unrecoverable) continue;
                throw e;
            }
            boolean hardware;
            if (Build.VERSION.SDK_INT >= 31) {
                int level = info.getSecurityLevel();
                hardware = level == KeyProperties.SECURITY_LEVEL_STRONGBOX || level == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT;
            } else { hardware = info.isInsideSecureHardware(); }
            found = true; hardwareBacked &= hardware;
        }
        return new SecureStore.Status(true, canAuthenticate(), found && hardwareBacked);
    }

    @Override public Exception failure(Exception error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof KeyPermanentlyInvalidatedException) return new SecureStore.Unrecoverable(true);
            if (cause instanceof UserNotAuthenticatedException) return new SecureStoreException("unavailable");
        }
        return error;
    }
}
