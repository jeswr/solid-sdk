// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import android.app.Activity;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import java.util.concurrent.Executor;
import javax.crypto.Cipher;

/** Framework prompt, with native localisable text and the exact Cipher that unwraps the data key. */
final class SecureStorePrompt implements SecureStoreOperations.Prompt {
    private final Activity activity;
    private final Executor main;
    private final CancellationSignal signal = new CancellationSignal();

    SecureStorePrompt(Activity activity, Executor main) { this.activity = activity; this.main = main; }

    @Override public void start(Object cryptoObject, SecureStoreOperations.Callback callback) {
        if (Build.VERSION.SDK_INT < 30) { callback.failure("unavailable"); return; }
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) { callback.failure("background"); return; }
        if (signal.isCanceled()) { callback.failure("cancelled"); return; }
        BiometricPrompt prompt = new BiometricPrompt.Builder(activity)
            .setTitle(activity.getString(R.string.secure_store_unlock))
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            .build();
        prompt.authenticate(new BiometricPrompt.CryptoObject((Cipher) cryptoObject), signal, main,
            new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    BiometricPrompt.CryptoObject object = result.getCryptoObject();
                    if (object == null || object.getCipher() != cryptoObject) callback.failure("failed");
                    else callback.success(object.getCipher());
                }
                @Override public void onAuthenticationError(int errorCode, CharSequence ignored) {
                    callback.failure(code(errorCode));
                }
            });
    }

    private static String code(int error) {
        switch (error) {
            case BiometricPrompt.BIOMETRIC_ERROR_CANCELED:
            case BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED:
            case BiometricPrompt.BIOMETRIC_ERROR_TIMEOUT:
                return "cancelled";
            case BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT:
            case BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT:
                return "lockout";
            case BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE:
            case BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS:
            case BiometricPrompt.BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL:
            case BiometricPrompt.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                return "unavailable";
            default: return "failed";
        }
    }

    @Override public void cancel() { signal.cancel(); }
}
