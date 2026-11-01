// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** The serial-queue store. Only set may create keys; recovery commits one tombstone at a time. */
final class SecureStore {
    interface Persistence {
        byte[] read() throws IOException;
        void commit(byte[] bytes) throws IOException;
    }
    interface Crypto {
        Status status() throws Exception;
        SecureStoreCodec.Record seal(String namespace, String key, byte[] value, boolean gated,
            SecureStoreCodec.Record previous) throws Exception;
        Object prepare(SecureStoreCodec.Record record) throws Exception;
        byte[] open(SecureStoreCodec.Record record, Object authorization) throws Exception;
        void retire(SecureStoreCodec.Record record) throws Exception;
    }
    static final class Status {
        final boolean available, userPresence, hardwareBacked;
        Status(boolean available, boolean userPresence, boolean hardwareBacked) {
            this.available = available; this.userPresence = userPresence; this.hardwareBacked = hardwareBacked;
        }
    }
    static final class Unrecoverable extends Exception {
        final boolean retire;
        Unrecoverable(boolean retire) { this.retire = retire; }
    }
    static final class Read {
        final String key;
        final long version;
        final SecureStoreCodec.Record record;
        final Object cryptoObject;
        Read(String key, long version, SecureStoreCodec.Record record, Object cryptoObject) {
            this.key = key; this.version = version; this.record = record; this.cryptoObject = cryptoObject;
        }
        boolean gated() { return record != null && record.gated; }
    }
    static final class Value {
        final String value;
        final long version;
        Value(String value, long version) { this.value = value; this.version = version; }
    }

    private final String namespace;
    private final Persistence persistence;
    private final Crypto crypto;
    private SecureStoreState state;

    SecureStore(String namespace, Persistence persistence, Crypto crypto) throws IOException {
        this.namespace = namespace; this.persistence = persistence; this.crypto = crypto;
        byte[] bytes = persistence.read();
        state = bytes == null ? new SecureStoreState() : SecureStoreCodec.state(bytes);
    }

    long set(String key, String value, boolean gated, long version) throws Exception {
        SecureStoreValidation.key(key); SecureStoreValidation.value(value); SecureStoreValidation.version(version);
        state.checkSet(key, version);
        if (gated && !crypto.status().userPresence) throw new SecureStoreException("unavailable");
        SecureStoreCodec.Record previous = located(key);
        SecureStoreCodec.Record record = crypto.seal(namespace, key, value.getBytes(StandardCharsets.UTF_8), gated, previous);
        commit(state.write(key, SecureStoreCodec.record(record)));
        return state.version(key);
    }

    Read beginGet(String key) throws Exception {
        return beginGet(key, true);
    }

    Read beginGet(String key, boolean foreground) throws Exception {
        SecureStoreValidation.key(key);
        if (state.record(key) == null) return new Read(key, state.version(key), null, null);
        SecureStoreCodec.Record record = located(key);
        if (record == null) { recover(key, null, false); return new Read(key, state.version(key), null, null); }
        if (record.gated && !foreground) throw new SecureStoreException("background");
        try {
            return new Read(key, state.version(key), record, record.gated ? crypto.prepare(record) : null);
        } catch (Unrecoverable e) {
            recover(key, record, e.retire);
            return new Read(key, state.version(key), null, null);
        }
    }

    Value finishGet(Read read, Object authorization) throws Exception {
        if (state.version(read.key) != read.version) throw new SecureStoreException("stale");
        if (read.record == null) return new Value(null, read.version);
        try {
            byte[] bytes = crypto.open(read.record, authorization);
            if (bytes.length > SecureStoreValidation.MAX_VALUE_BYTES) throw new Unrecoverable(false);
            String value;
            try { value = SecureStoreValidation.utf8(bytes); }
            catch (IOException e) { throw new Unrecoverable(false); }
            return new Value(value, read.version);
        } catch (Unrecoverable e) {
            recover(read.key, read.record, e.retire);
            return new Value(null, state.version(read.key));
        }
    }

    void remove(String key) throws Exception { SecureStoreValidation.key(key); commit(state.write(key, null)); }
    void clear() throws Exception { commit(state.clear()); }

    private SecureStoreCodec.Record located(String key) {
        byte[] bytes = state.record(key);
        if (bytes == null) return null;
        try {
            SecureStoreCodec.Record record = SecureStoreCodec.record(bytes);
            return record.at(namespace, key) ? record : null;
        } catch (IOException e) { return null; }
    }

    private void recover(String key, SecureStoreCodec.Record record, boolean retire) throws Exception {
        // Retirement must never target identifiers from a record at the wrong location.
        if (retire && record != null) crypto.retire(record);
        commit(state.write(key, null));
    }
    private void commit(SecureStoreState next) throws IOException { persistence.commit(SecureStoreCodec.state(next)); state = next; }
}
