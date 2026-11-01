// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.util.Map;
import java.util.TreeMap;

/** Versions are absolute counters above an epoch floor. Null records are tombstones. */
final class SecureStoreState {
    static final int MAX_KEYS = 32;
    final long epoch;
    final Map<String, Entry> entries;

    static final class Entry {
        final long version;
        final byte[] record;
        Entry(long version, byte[] record) { this.version = version; this.record = record == null ? null : record.clone(); }
    }

    SecureStoreState() { this(0, new TreeMap<>()); }
    SecureStoreState(long epoch, Map<String, Entry> entries) {
        this.epoch = epoch;
        this.entries = java.util.Collections.unmodifiableMap(new TreeMap<>(entries));
    }

    long version(String key) { return entries.containsKey(key) ? entries.get(key).version : epoch; }
    byte[] record(String key) { Entry entry = entries.get(key); return entry == null ? null : entry.record; }
    int count() { int count = 0; for (Entry entry : entries.values()) if (entry.record != null) count++; return count; }

    void checkSet(String key, long expected) throws SecureStoreException {
        if (version(key) != expected) throw new SecureStoreException("stale");
        if (record(key) == null && count() >= MAX_KEYS) throw new SecureStoreException("full");
        SecureStoreValidation.next(expected);
    }

    SecureStoreState write(String key, byte[] record) throws SecureStoreException {
        Map<String, Entry> next = new TreeMap<>(entries);
        next.put(key, new Entry(SecureStoreValidation.next(version(key)), record));
        return new SecureStoreState(epoch, next);
    }

    SecureStoreState clear() throws SecureStoreException {
        long maximum = epoch;
        for (Entry entry : entries.values()) maximum = Math.max(maximum, entry.version);
        return new SecureStoreState(SecureStoreValidation.next(maximum), new TreeMap<>());
    }
}
