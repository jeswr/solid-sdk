// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.TreeMap;

/** Big-endian framing keeps damaged record payloads isolated from the state envelope. */
final class SecureStoreCodec {
    private static final int STATE_MAGIC = 0x53535431;
    private static final int RECORD_MAGIC = 0x53535231;
    static final int MAX_RECORD_BYTES = 18 * 1024;

    static final class Record {
        final String namespace;
        final String key;
        final boolean gated;
        final String keyId;
        final byte[] nonce;
        final byte[] wrappedKey;
        final byte[] ciphertext;
        Record(String namespace, String key, boolean gated, String keyId, byte[] nonce, byte[] wrappedKey, byte[] ciphertext) {
            this.namespace = namespace; this.key = key; this.gated = gated; this.keyId = keyId;
            this.nonce = nonce.clone(); this.wrappedKey = wrappedKey.clone(); this.ciphertext = ciphertext.clone();
        }
        boolean at(String namespace, String key) { return this.namespace.equals(namespace) && this.key.equals(key); }
    }

    static byte[] associatedData(String namespace, String key, boolean gated, String keyId) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeBytes("SSS1");
        text(out, namespace); text(out, key); out.writeByte(gated ? 1 : 0); text(out, keyId);
        return bytes.toByteArray();
    }

    static byte[] record(Record record) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeInt(RECORD_MAGIC);
        text(out, record.namespace); text(out, record.key); out.writeByte(record.gated ? 1 : 0); text(out, record.keyId);
        blob(out, record.nonce); blob(out, record.wrappedKey); blob(out, record.ciphertext);
        return bytes.toByteArray();
    }

    static Record record(byte[] bytes) throws IOException {
        if (bytes.length > MAX_RECORD_BYTES) throw new IOException("Record too large");
        DataInputStream in = input(bytes);
        if (in.readInt() != RECORD_MAGIC) throw new IOException("Invalid record");
        String namespace = text(in), key = text(in);
        int mode = in.readUnsignedByte();
        String keyId = text(in);
        byte[] nonce = blob(in, 12), wrapped = blob(in, 384), ciphertext = blob(in, SecureStoreValidation.MAX_VALUE_BYTES + 16);
        if (!namespace.matches("[0-9a-f]{64}") || !keyId.matches("[0-9a-f]{32}") || mode > 1 ||
                nonce.length != 12 || wrapped.length != (mode == 1 ? 384 : 0) || ciphertext.length < 16 || in.available() != 0) {
            throw new IOException("Invalid record fields");
        }
        try { SecureStoreValidation.key(key); } catch (SecureStoreException e) { throw new IOException(e); }
        return new Record(namespace, key, mode == 1, keyId, nonce, wrapped, ciphertext);
    }

    static byte[] state(SecureStoreState state) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeInt(STATE_MAGIC); out.writeLong(state.epoch); out.writeInt(state.entries.size());
        for (Map.Entry<String, SecureStoreState.Entry> item : state.entries.entrySet()) {
            text(out, item.getKey()); out.writeLong(item.getValue().version);
            byte[] record = item.getValue().record;
            out.writeInt(record == null ? -1 : record.length);
            if (record != null) out.write(record);
        }
        return bytes.toByteArray();
    }

    static SecureStoreState state(byte[] bytes) throws IOException {
        DataInputStream in = input(bytes);
        if (in.readInt() != STATE_MAGIC) throw new IOException("Invalid state");
        long epoch = in.readLong();
        int count = in.readInt();
        if (epoch < 0 || epoch > SecureStoreValidation.MAX_VERSION || count < 0 || count > in.available() / 15) {
            throw new IOException("Invalid state fields");
        }
        Map<String, SecureStoreState.Entry> entries = new TreeMap<>();
        for (int i = 0; i < count; i++) {
            String key = text(in);
            try { SecureStoreValidation.key(key); } catch (SecureStoreException e) { throw new IOException(e); }
            long version = in.readLong();
            int length = in.readInt();
            if (version <= epoch || version > SecureStoreValidation.MAX_VERSION || entries.containsKey(key) ||
                    length < -1 || length > in.available()) throw new IOException("Invalid entry");
            byte[] record = null;
            if (length >= 0) { record = new byte[length]; in.readFully(record); }
            entries.put(key, new SecureStoreState.Entry(version, record));
        }
        SecureStoreState state = new SecureStoreState(epoch, entries);
        if (in.available() != 0 || state.count() > SecureStoreState.MAX_KEYS) throw new IOException("Invalid state size");
        return state;
    }

    private static DataInputStream input(byte[] bytes) { return new DataInputStream(new ByteArrayInputStream(bytes)); }
    private static void text(DataOutputStream out, String value) throws IOException {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 65535) throw new IOException("String too long");
        out.writeShort(bytes.length); out.write(bytes);
    }
    private static String text(DataInputStream in) throws IOException {
        int length = in.readUnsignedShort();
        if (length > in.available()) throw new IOException("Truncated string");
        byte[] bytes = new byte[length]; in.readFully(bytes);
        return SecureStoreValidation.utf8(bytes);
    }
    private static void blob(DataOutputStream out, byte[] bytes) throws IOException { out.writeInt(bytes.length); out.write(bytes); }
    private static byte[] blob(DataInputStream in, int maximum) throws IOException {
        int length = in.readInt();
        if (length < 0 || length > maximum || length > in.available()) throw new IOException("Invalid bytes");
        byte[] bytes = new byte[length]; in.readFully(bytes); return bytes;
    }
}
