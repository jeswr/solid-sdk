// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import static org.junit.Assert.*;
import static org.jeswr.suite.SecureStoreTestSupport.*;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.junit.Test;

public class SecureStoreCipherTest {
    private static final class Keys implements SecureStoreCipher.Keys {
        final Map<String, SecureStoreCipher.Material> values = new HashMap<>();
        final List<String> retired = new ArrayList<>();
        int generated;
        Exception failure;
        @Override public SecureStoreCipher.Material find(String alias) throws Exception {
            if (failure != null) throw failure;
            return values.get(alias);
        }
        @Override public SecureStoreCipher.Material generate(String alias, boolean gated) throws Exception {
            generated++;
            SecureStoreCipher.Material material;
            if (gated) {
                KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(3072);
                KeyPair pair = generator.generateKeyPair(); material = new SecureStoreCipher.Material(pair.getPublic(), pair.getPrivate());
            } else {
                KeyGenerator generator = KeyGenerator.getInstance("AES"); generator.init(256);
                SecretKey key = generator.generateKey(); material = new SecureStoreCipher.Material(key, key);
            }
            values.put(alias, material); return material;
        }
        @Override public void delete(String alias) { retired.add(alias); values.remove(alias); }
        @Override public SecureStore.Status status() { return new SecureStore.Status(true, true, false); }
        @Override public Exception failure(Exception error) {
            return error instanceof InvalidKeyException ? new SecureStore.Unrecoverable(true) : error;
        }
    }

    @Test public void aliasesBindTheNamespaceAndMode() {
        assertEquals("suite-securestore." + NS + "." + ID, SecureStoreCipher.alias(NS, ID, false));
        assertEquals("suite-securestore-gated." + NS + "." + ID, SecureStoreCipher.alias(NS, ID, true));
    }

    @Test public void realAesAndOaepRoundTripsNeverPersistPlaintextAndRotationDoesNotPrepareAPrompt() throws Exception {
        Keys keys = new Keys(); SecureStoreCipher cipher = new SecureStoreCipher(keys);
        Memory disk = new Memory(); SecureStore store = new SecureStore(NS, disk, cipher);
        String secret = "refresh-token-secret-💾";
        for (boolean gated : new boolean[]{false, true}) {
            String key = gated ? "gated" : "ungated";
            assertEquals(1, store.set(key, secret, gated, 0));
            SecureStoreCodec.Record record = SecureStoreCodec.record(SecureStoreCodec.state(disk.read()).record(key));
            assertEquals(12, record.nonce.length); assertEquals(secret.getBytes(StandardCharsets.UTF_8).length + 16, record.ciphertext.length);
            assertEquals(gated ? 384 : 0, record.wrappedKey.length);
            assertEquals(secret, get(store, key).value);
            assertFalse(new String(disk.read(), StandardCharsets.UTF_8).contains("refresh-token-secret"));
            assertEquals(2, store.set(key, secret + "-rotated", gated, 1));
            SecureStoreCodec.Record next = SecureStoreCodec.record(SecureStoreCodec.state(disk.read()).record(key));
            assertEquals(record.keyId, next.keyId); assertFalse(java.util.Arrays.equals(record.nonce, next.nonce));
            if (gated) assertFalse(java.util.Arrays.equals(record.wrappedKey, next.wrappedKey));
            assertEquals(secret + "-rotated", get(new SecureStore(NS, disk, cipher), key).value);
        }
        assertEquals(2, keys.generated);
        assertEquals("SHA-256", SecureStoreCipher.OAEP.getDigestAlgorithm());
        assertEquals("SHA-1", ((java.security.spec.MGF1ParameterSpec) SecureStoreCipher.OAEP.getMGFParameters()).getDigestAlgorithm());
    }

    @Test public void aadAndCiphertextTamperingAreUnrecoverable() throws Exception {
        Keys keys = new Keys(); SecureStoreCipher cipher = new SecureStoreCipher(keys);
        SecureStoreCodec.Record record = cipher.seal(NS, "a", "secret".getBytes(StandardCharsets.UTF_8), false, null);
        for (SecureStoreCodec.Record bad : new SecureStoreCodec.Record[]{
            new SecureStoreCodec.Record(NS, "b", false, record.keyId, record.nonce, record.wrappedKey, record.ciphertext),
            new SecureStoreCodec.Record("f".repeat(64), "a", false, record.keyId, record.nonce, record.wrappedKey, record.ciphertext)
        }) {
            // Same key material under the altered location proves the AAD itself prevents relocation.
            keys.values.put(SecureStoreCipher.alias(bad.namespace, bad.keyId, false), keys.values.get(SecureStoreCipher.alias(NS, record.keyId, false)));
            assertFalse(assertThrows(SecureStore.Unrecoverable.class, () -> cipher.open(bad, null)).retire);
        }
        record.ciphertext[0] ^= 1;
        assertFalse(assertThrows(SecureStore.Unrecoverable.class, () -> cipher.open(record, null)).retire);
    }

    @Test public void missingAliasesNeverGenerateOnReadAndRetireOnlyTheAffectedKey() throws Exception {
        Keys keys = new Keys(); SecureStoreCipher cipher = new SecureStoreCipher(keys);
        Memory disk = new Memory(); SecureStore store = new SecureStore(NS, disk, cipher);
        store.set("a", "lost", false, 0); store.set("b", "safe", false, 0);
        String alias = SecureStoreCipher.alias(NS, SecureStoreCodec.record(SecureStoreCodec.state(disk.read()).record("a")).keyId, false);
        keys.values.remove(alias);
        assertNull(get(store, "a").value); assertEquals(List.of(alias), keys.retired);
        assertEquals("safe", get(store, "b").value); assertEquals(2, keys.generated);
        assertNull(get(store, "never-written").value); assertEquals(2, keys.generated);
    }

    @Test public void missingPrivateKeyAndInvalidationProbeRetireThenRotateBeforeWrapping() throws Exception {
        Keys keys = new Keys(); SecureStoreCipher cipher = new SecureStoreCipher(keys);
        SecureStoreCodec.Record first = cipher.seal(NS, "a", new byte[]{1}, true, null);
        String alias = SecureStoreCipher.alias(NS, first.keyId, true);
        SecureStoreCipher.Material old = keys.values.get(alias);
        PrivateKey invalid = new PrivateKey() {
            @Override public String getAlgorithm() { return "RSA"; }
            @Override public String getFormat() { return "PKCS#8"; }
            @Override public byte[] getEncoded() { return new byte[0]; }
        };
        keys.values.put(alias, new SecureStoreCipher.Material(old.encryption, invalid));
        SecureStoreCodec.Record rotated = cipher.seal(NS, "a", new byte[]{2}, true, first);
        assertEquals(List.of(alias), keys.retired); assertNotEquals(first.keyId, rotated.keyId);
        assertArrayEquals(new byte[]{2}, cipher.open(rotated, cipher.prepare(rotated)));
        String nextAlias = SecureStoreCipher.alias(NS, rotated.keyId, true);
        keys.values.remove(nextAlias);
        assertTrue(assertThrows(SecureStore.Unrecoverable.class, () -> cipher.prepare(rotated)).retire);
        SecureStoreCodec.Record replacement = cipher.seal(NS, "a", new byte[]{3}, true, rotated);
        assertNotEquals(rotated.keyId, replacement.keyId); assertEquals(3, keys.generated);
    }

    @Test public void transientProbeFailureNeverRetiresOrGenerates() throws Exception {
        Keys keys = new Keys(); SecureStoreCipher cipher = new SecureStoreCipher(keys);
        SecureStoreCodec.Record record = cipher.seal(NS, "a", new byte[]{1}, true, null);
        keys.failure = new SecureStoreException("unavailable");
        assertEquals("unavailable", assertThrows(SecureStoreException.class, () -> cipher.seal(NS, "a", new byte[]{2}, true, record)).code);
        assertEquals(1, keys.generated); assertTrue(keys.retired.isEmpty());
        keys.failure = null;
        assertArrayEquals(new byte[]{1}, cipher.open(record, cipher.prepare(record)));
    }

    @Test public void actualGcmFailureRecoversOneRecordThroughTheStore() throws Exception {
        Keys keys = new Keys(); SecureStoreCipher cipher = new SecureStoreCipher(keys); Memory disk = new Memory();
        SecureStore store = new SecureStore(NS, disk, cipher);
        store.set("a", "lost", false, 0); store.set("b", "safe", false, 0);
        SecureStoreState state = SecureStoreCodec.state(disk.read());
        SecureStoreCodec.Record record = SecureStoreCodec.record(state.record("a")); record.ciphertext[0] ^= 1;
        Map<String, SecureStoreState.Entry> entries = new HashMap<>(state.entries);
        entries.put("a", new SecureStoreState.Entry(1, SecureStoreCodec.record(record)));
        disk.bytes = SecureStoreCodec.state(new SecureStoreState(0, entries));
        SecureStore restarted = new SecureStore(NS, disk, cipher);
        assertNull(get(restarted, "a").value); assertEquals(2, get(restarted, "a").version);
        assertEquals("safe", get(restarted, "b").value); assertTrue(keys.retired.isEmpty());
    }
}
