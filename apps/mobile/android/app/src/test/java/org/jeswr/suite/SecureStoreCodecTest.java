// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import org.junit.Test;

public class SecureStoreCodecTest {
    private final String ns = "a".repeat(64), id = "b".repeat(32);

    @Test public void associatedDataHasExactS4Framing() throws Exception {
        String expected = "SSS1\u0000\u0040" + ns + "\u0000\u0003a:b\u0001\u0000\u0020" + id;
        assertArrayEquals(expected.getBytes(StandardCharsets.UTF_8), SecureStoreCodec.associatedData(ns, "a:b", true, id));
        byte[] ungated = SecureStoreCodec.associatedData(ns, "a:b", false, id);
        assertEquals(0, ungated[4 + 2 + 64 + 2 + 3]);
        assertFalse(Arrays.equals(ungated, SecureStoreCodec.associatedData(ns, "a:c", false, id)));
    }

    @Test public void recordRoundTripAndLocationChecks() throws Exception {
        for (boolean gated : new boolean[]{false, true}) {
            SecureStoreCodec.Record value = new SecureStoreCodec.Record(ns, "a:b", gated, id, new byte[12],
                new byte[gated ? 384 : 0], new byte[16400]);
            SecureStoreCodec.Record read = SecureStoreCodec.record(SecureStoreCodec.record(value));
            assertTrue(read.at(ns, "a:b"));
            assertFalse(read.at("c".repeat(64), "a:b"));
            assertFalse(read.at(ns, "a:c"));
            assertEquals(gated, read.gated);
            assertEquals(id, read.keyId);
            assertArrayEquals(value.ciphertext, read.ciphertext);
        }
    }

    @Test public void badRecordFieldsAndTruncationsAreRejected() throws Exception {
        SecureStoreCodec.Record record = new SecureStoreCodec.Record(ns, "a", false, id, new byte[12], new byte[0], new byte[16]);
        byte[] encoded = SecureStoreCodec.record(record);
        for (int i = 0; i < encoded.length; i++) {
            byte[] shortRecord = Arrays.copyOf(encoded, i);
            assertThrows(IOException.class, () -> SecureStoreCodec.record(shortRecord));
        }
        assertThrows(IOException.class, () -> SecureStoreCodec.record(Arrays.copyOf(encoded, encoded.length + 1)));
        for (SecureStoreCodec.Record bad : new SecureStoreCodec.Record[]{
            new SecureStoreCodec.Record(ns.toUpperCase(), "a", false, id, new byte[12], new byte[0], new byte[16]),
            new SecureStoreCodec.Record(ns, "A", false, id, new byte[12], new byte[0], new byte[16]),
            new SecureStoreCodec.Record(ns, "a", false, "bad", new byte[12], new byte[0], new byte[16]),
            new SecureStoreCodec.Record(ns, "a", false, id, new byte[11], new byte[0], new byte[16]),
            new SecureStoreCodec.Record(ns, "a", true, id, new byte[12], new byte[0], new byte[16]),
            new SecureStoreCodec.Record(ns, "a", false, id, new byte[12], new byte[1], new byte[16]),
            new SecureStoreCodec.Record(ns, "a", false, id, new byte[12], new byte[0], new byte[15])
        }) assertThrows(IOException.class, () -> SecureStoreCodec.record(SecureStoreCodec.record(bad)));
        encoded[4 + 2 + 64 + 2 + 1] = 2;
        assertThrows(IOException.class, () -> SecureStoreCodec.record(encoded));
    }

    @Test public void stateRoundTripIncludesTombstonesAndEpoch() throws Exception {
        SecureStoreState state = new SecureStoreState().write("a", new byte[]{1, 2}).write("gone", null);
        SecureStoreState read = SecureStoreCodec.state(SecureStoreCodec.state(state));
        assertEquals(0, read.epoch);
        assertEquals(1, read.version("a"));
        assertEquals(1, read.version("gone"));
        assertEquals(1, read.count());
        assertNull(read.record("gone"));
        SecureStoreState cleared = SecureStoreCodec.state(SecureStoreCodec.state(read.clear()));
        assertEquals(2, cleared.epoch);
        assertEquals(2, cleared.version("a"));
        assertEquals(0, cleared.count());
    }

    @Test public void badEnvelopesFailClosedWithoutDiscardingAllRecords() throws Exception {
        byte[] encoded = SecureStoreCodec.state(new SecureStoreState().write("a", new byte[]{1}));
        for (int i = 0; i < encoded.length; i++) {
            byte[] truncated = Arrays.copyOf(encoded, i);
            assertThrows(IOException.class, () -> SecureStoreCodec.state(truncated));
        }
        assertThrows(IOException.class, () -> SecureStoreCodec.state(Arrays.copyOf(encoded, encoded.length + 1)));
        for (SecureStoreState bad : new SecureStoreState[]{
            new SecureStoreState(-1, Map.of()),
            new SecureStoreState(SecureStoreValidation.MAX_VERSION + 1, Map.of()),
            new SecureStoreState(1, Map.of("a", new SecureStoreState.Entry(1, null))),
            new SecureStoreState(0, Map.of("a", new SecureStoreState.Entry(SecureStoreValidation.MAX_VERSION + 1, null))),
            new SecureStoreState(0, Map.of("A", new SecureStoreState.Entry(1, null)))
        }) assertThrows(IOException.class, () -> SecureStoreCodec.state(SecureStoreCodec.state(bad)));
    }
}
