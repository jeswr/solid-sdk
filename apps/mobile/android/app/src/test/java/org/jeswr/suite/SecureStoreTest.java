// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import static org.junit.Assert.*;
import static org.jeswr.suite.SecureStoreTestSupport.*;
import java.io.IOException;
import java.util.TreeMap;
import org.junit.Before;
import org.junit.Test;

public class SecureStoreTest {
    private Memory disk;
    private Crypto crypto;
    private SecureStore store;

    @Before public void setup() throws Exception { disk = new Memory(); crypto = new Crypto(); store = new SecureStore(NS, disk, crypto); }
    private SecureStore restart() throws Exception { return new SecureStore(NS, disk, crypto); }

    @Test public void absentRoundTripRotationAndStale() throws Exception {
        assertNull(get(store, "a").value); assertEquals(0, get(store, "a").version);
        assertEquals(1, store.set("a", "first", false, 0));
        assertEquals("first", get(store, "a").value);
        assertEquals(2, store.set("a", "next", true, 1));
        assertEquals("next", get(restart(), "a").value);
        assertEquals("stale", assertThrows(SecureStoreException.class, () -> store.set("a", "late", false, 1)).code);
        assertEquals("next", get(store, "a").value);
        assertEquals(2, crypto.writes);
    }

    @Test public void removeLeavesATombstoneWithoutTouchingOtherAccounts() throws Exception {
        store.set("a", "first", true, 0); store.set("b", "other", false, 0);
        store.remove("a");
        assertNull(get(restart(), "a").value); assertEquals(2, get(restart(), "a").version);
        assertEquals("other", get(store, "b").value);
        assertEquals("stale", assertThrows(SecureStoreException.class, () -> store.set("a", "late", true, 1)).code);
        assertEquals(3, store.set("a", "new", false, 2));
        store.remove("never-written");
        assertEquals(1, get(store, "never-written").version);
        store.remove("never-written");
        assertEquals(2, get(restart(), "never-written").version);
    }

    @Test public void clearRaisesEveryVersionIncludingTombstonesAndPreviouslyAbsentKeys() throws Exception {
        for (int i = 0; i < 5; i++) store.set("a", "value", false, i);
        store.set("b", "other", false, 0); store.remove("gone");
        store.clear();
        for (String key : new String[]{"a", "b", "gone", "never-written"}) {
            assertNull(get(restart(), key).value); assertEquals(6, get(restart(), key).version);
        }
        assertEquals("stale", assertThrows(SecureStoreException.class, () -> store.set("a", "late", false, 5)).code);
        assertEquals(7, store.set("a", "next", false, 6));
        store.clear(); store.clear();
        assertEquals(9, get(restart(), "a").version);
    }

    @Test public void capCountsBothModesAndAllowsReplacementsAndTombstones() throws Exception {
        for (int i = 0; i < 32; i++) store.set("k" + i, "value", i % 2 == 0, 0);
        byte[] before = disk.read();
        assertEquals("full", assertThrows(SecureStoreException.class, () -> store.set("new", "value", false, 0)).code);
        assertArrayEquals(before, disk.read());
        assertEquals(2, store.set("k0", "replacement", false, 1));
        store.remove("k1");
        assertEquals(1, store.set("new", "value", true, 0));
        assertEquals("full", assertThrows(SecureStoreException.class, () -> store.set("k1", "value", true, 2)).code);
        for (int i = 0; i < 100; i++) store.remove("tombstone" + i);
        assertEquals(32, SecureStoreCodec.state(disk.read()).count());
        assertEquals("value", get(restart(), "k31").value);
    }

    @Test public void invalidArgumentsAndUnsupportedGatingDoNotMutate() throws Exception {
        assertThrows(SecureStoreException.class, () -> store.set("A", "x", false, 0));
        assertThrows(SecureStoreException.class, () -> store.set("a", "x".repeat(16385), false, 0));
        assertThrows(SecureStoreException.class, () -> store.set("a", "x", false, -1));
        assertThrows(SecureStoreException.class, () -> store.remove("../x"));
        assertThrows(SecureStoreException.class, () -> store.beginGet("../x"));
        crypto.presence = false;
        assertEquals("unavailable", assertThrows(SecureStoreException.class, () -> store.set("a", "x", true, 0)).code);
        assertEquals(0, crypto.writes); assertNull(disk.bytes);
        assertEquals(1, store.set("a", "x", false, 0));
    }

    @Test public void pendingReadsCannotReturnAReplacedOrRemovedRecord() throws Exception {
        store.set("a", "old", true, 0);
        SecureStore.Read read = store.beginGet("a");
        store.set("a", "new", true, 1);
        assertEquals("stale", assertThrows(SecureStoreException.class, () -> store.finishGet(read, read.cryptoObject)).code);
        assertEquals(0, crypto.opens);
    }

    @Test public void backgroundGatedReadsNeverPrepareAPrivateKey() throws Exception {
        store.set("a", "x", true, 0);
        assertEquals("background", assertThrows(SecureStoreException.class, () -> store.beginGet("a", false)).code);
        assertEquals(0, crypto.prepares);
        store.set("b", "ungated", false, 0);
        assertEquals("ungated", store.finishGet(store.beginGet("b", false), null).value);
    }

    @Test public void missingOrInvalidatedKeyRecoversOneRecordAndRetiresIt() throws Exception {
        store.set("a", "lost", true, 0); store.set("b", "safe", false, 0);
        crypto.prepareFailure = new SecureStore.Unrecoverable(true);
        assertNull(get(store, "a").value);
        assertEquals(java.util.List.of("a"), crypto.retired);
        crypto.prepareFailure = null;
        assertEquals(2, get(restart(), "a").version);
        assertEquals("safe", get(restart(), "b").value);
        assertEquals(2, crypto.writes);
        assertEquals("stale", assertThrows(SecureStoreException.class, () -> store.set("a", "late", true, 1)).code);
    }

    @Test public void corruptTagOrUngatedMissingKeyRecoversOnlyThatRecord() throws Exception {
        for (boolean retire : new boolean[]{false, true}) {
            setup(); store.set("a", "lost", false, 0); store.set("b", "safe", false, 0);
            crypto.openFailure = new SecureStore.Unrecoverable(retire);
            assertNull(get(store, "a").value);
            crypto.openFailure = null;
            assertEquals(2, get(restart(), "a").version);
            assertEquals("safe", get(store, "b").value);
            assertEquals(retire ? 1 : 0, crypto.retired.size());
        }
    }

    @Test public void badRecordParsingAndLocationNeverReachCryptoOrRetireForeignKeys() throws Exception {
        store.set("a", "lost", false, 0); store.set("b", "safe", false, 0);
        SecureStoreState before = SecureStoreCodec.state(disk.read());
        for (byte[] bad : new byte[][]{new byte[]{1}, new byte[SecureStoreCodec.MAX_RECORD_BYTES + 1], before.record("b"), SecureStoreCodec.record(
                new SecureStoreCodec.Record("f".repeat(64), "a", false, ID, new byte[12], new byte[0], new byte[16]))}) {
            TreeMap<String, SecureStoreState.Entry> entries = new TreeMap<>(before.entries);
            entries.put("a", new SecureStoreState.Entry(1, bad));
            disk.bytes = SecureStoreCodec.state(new SecureStoreState(0, entries));
            SecureStore current = restart();
            int opens = crypto.opens;
            assertNull(get(current, "a").value); assertEquals(opens, crypto.opens);
            assertEquals("safe", get(restart(), "b").value);
            assertTrue(crypto.retired.isEmpty());
        }
    }

    @Test public void transientErrorsLeaveBothDiskAndMemoryUntouched() throws Exception {
        store.set("a", "keep", true, 0);
        byte[] before = disk.read();
        for (String code : new String[]{"lockout", "unavailable", "cancelled", "failed"}) {
            crypto.prepareFailure = new SecureStoreException(code);
            assertEquals(code, assertThrows(SecureStoreException.class, () -> get(store, "a")).code);
            crypto.prepareFailure = null; crypto.openFailure = new SecureStoreException(code);
            assertEquals(code, assertThrows(SecureStoreException.class, () -> get(store, "a")).code);
            crypto.openFailure = null;
            assertArrayEquals(before, disk.read()); assertEquals("keep", get(store, "a").value);
        }
        assertTrue(crypto.retired.isEmpty());
    }

    @Test public void allMutationsRetainOldStateOnFailedCommit() throws Exception {
        store.set("a", "keep", false, 0);
        byte[] before = disk.read(); disk.fail = true;
        assertThrows(IOException.class, () -> store.set("a", "new", false, 1));
        assertThrows(IOException.class, () -> store.remove("a"));
        assertThrows(IOException.class, store::clear);
        crypto.openFailure = new SecureStore.Unrecoverable(false);
        assertThrows(IOException.class, () -> get(store, "a"));
        crypto.openFailure = null;
        assertArrayEquals(before, disk.read()); assertEquals("keep", get(store, "a").value);
        assertEquals(1, get(restart(), "a").version);
    }

    @Test public void invalidNamespaceEnvelopeIsPreservedForDiagnosis() {
        disk.bytes = new byte[]{1, 2, 3};
        assertThrows(IOException.class, this::restart);
        assertArrayEquals(new byte[]{1, 2, 3}, disk.bytes);
    }

    @Test public void exhaustedVersionsCannotWrapOrMutate() throws Exception {
        disk.bytes = SecureStoreCodec.state(new SecureStoreState(SecureStoreValidation.MAX_VERSION, java.util.Map.of()));
        SecureStore current = restart(); byte[] before = disk.read();
        assertThrows(SecureStoreException.class, () -> current.set("a", "value", false, SecureStoreValidation.MAX_VERSION));
        assertThrows(SecureStoreException.class, () -> current.remove("a"));
        assertThrows(SecureStoreException.class, current::clear);
        assertArrayEquals(before, disk.read()); assertEquals(0, crypto.writes);
    }
}
