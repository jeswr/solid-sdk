// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

final class SecureStoreTestSupport {
    static final String NS = SecureStoreValidation.namespace("https://suite.example");
    static final String ID = "0123456789abcdef0123456789abcdef";

    static final class Memory implements SecureStore.Persistence {
        byte[] bytes;
        boolean fail;
        @Override public byte[] read() { return bytes == null ? null : bytes.clone(); }
        @Override public void commit(byte[] value) throws IOException {
            if (fail) throw new IOException("Injected commit failure");
            bytes = value.clone();
        }
    }

    static final class Crypto implements SecureStore.Crypto {
        int writes, prepares, opens;
        boolean presence = true;
        Exception prepareFailure, openFailure;
        Runnable duringOpen;
        final List<String> retired = new ArrayList<>();
        @Override public SecureStore.Status status() { return new SecureStore.Status(true, presence, false); }
        @Override public SecureStoreCodec.Record seal(String namespace, String key, byte[] value, boolean gated,
                SecureStoreCodec.Record previous) {
            writes++;
            return new SecureStoreCodec.Record(namespace, key, gated, ID, new byte[12], new byte[gated ? 384 : 0],
                Arrays.copyOf(value, value.length + 16));
        }
        @Override public Object prepare(SecureStoreCodec.Record record) throws Exception {
            prepares++;
            if (prepareFailure != null) throw prepareFailure;
            return record.keyId;
        }
        @Override public byte[] open(SecureStoreCodec.Record record, Object authorization) throws Exception {
            opens++;
            if (duringOpen != null) duringOpen.run();
            if (openFailure != null) throw openFailure;
            return Arrays.copyOf(record.ciphertext, record.ciphertext.length - 16);
        }
        @Override public void retire(SecureStoreCodec.Record record) { retired.add(record.key); }
    }

    static SecureStore.Value get(SecureStore store, String key) throws Exception {
        SecureStore.Read read = store.beginGet(key);
        return store.finishGet(read, read.cryptoObject);
    }
}
