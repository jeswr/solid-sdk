// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.security.InvalidAlgorithmParameterException;
import java.security.KeyStoreException;
import java.security.ProviderException;
import org.junit.Test;

public class SecureStoreKeysTest {
    @Test
    public void strongBoxSpecRejectionsRetryInTheTee() {
        assertTrue(SecureStoreKeys.strongBoxUnsupported(new InvalidAlgorithmParameterException("RSA-3072")));
        assertTrue(SecureStoreKeys.strongBoxUnsupported(new ProviderException("generate failed")));
    }

    @Test
    public void otherKeystoreFailuresDoNotRetry() {
        assertFalse(SecureStoreKeys.strongBoxUnsupported(new KeyStoreException("locked")));
        assertFalse(SecureStoreKeys.strongBoxUnsupported(new IllegalStateException("bug")));
    }
}
