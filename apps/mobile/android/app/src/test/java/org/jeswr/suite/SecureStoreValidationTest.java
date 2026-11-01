// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import static org.junit.Assert.*;
import org.junit.Test;

public class SecureStoreValidationTest {
    @Test public void keysAreBoundedAsciiAndRejectCoercion() throws Exception {
        for (Object raw : new Object[]{null, 1, true, "", "A", "_a", ":a", "a/b", "a\n", "a b", "é", "a".repeat(129)}) {
            assertEquals("invalid", assertThrows(SecureStoreException.class, () -> SecureStoreValidation.key(raw)).code);
        }
        for (String key : new String[]{"a", "0", "pod-auth:refresh:abc._-", "a".repeat(128)}) assertEquals(key, SecureStoreValidation.key(key));
    }

    @Test public void valueLimitCountsUtf8BytesAndPreservesUnicode() throws Exception {
        for (Object value : new Object[]{null, 1, false, "a".repeat(16385), "💾".repeat(4097), "\ud800", "\udc00", "a\ud800b"}) {
            assertEquals("invalid", assertThrows(SecureStoreException.class, () -> SecureStoreValidation.value(value)).code);
        }
        for (String value : new String[]{"", "\u0000", "a".repeat(16384), "💾".repeat(4096)}) assertEquals(value, SecureStoreValidation.value(value));
    }

    @Test public void versionsAreNonnegativeSafeIntegers() throws Exception {
        for (Object raw : new Object[]{null, "0", true, -1, 0.1, Double.NaN, Double.POSITIVE_INFINITY, Long.MAX_VALUE, 9_007_199_254_740_992d}) {
            assertEquals("invalid", assertThrows(SecureStoreException.class, () -> SecureStoreValidation.version(raw)).code);
        }
        assertEquals(0, SecureStoreValidation.version(0));
        assertEquals(7, SecureStoreValidation.version(7.0));
        assertEquals(SecureStoreValidation.MAX_VERSION, SecureStoreValidation.version(SecureStoreValidation.MAX_VERSION));
        assertEquals("failed", assertThrows(SecureStoreException.class, () -> SecureStoreValidation.next(SecureStoreValidation.MAX_VERSION)).code);
    }

    @Test public void presenceIsAnExplicitBoolean() throws Exception {
        assertTrue(SecureStoreValidation.presence(true));
        assertFalse(SecureStoreValidation.presence(false));
        for (Object raw : new Object[]{null, 1, "true"}) assertThrows(SecureStoreException.class, () -> SecureStoreValidation.presence(raw));
    }

    @Test public void namespaceIsTheHashOfTheConfiguredOriginString() {
        assertEquals("4d15bdf5a6cabec09a37e1ce891726fdb4f9f83ba7c70ac27a86245a414396b9", SecureStoreValidation.namespace("https://suite.example"));
        assertNotEquals(SecureStoreTestSupport.NS, SecureStoreValidation.namespace("https://other.example"));
        assertNotEquals(SecureStoreTestSupport.NS, SecureStoreValidation.namespace("https://suite.example:443"));
    }
}
