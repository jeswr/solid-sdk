// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class SecureStoreValidation {
    static final long MAX_VERSION = 9_007_199_254_740_991L;
    static final int MAX_VALUE_BYTES = 16 * 1024;

    static String key(Object raw) throws SecureStoreException {
        if (!(raw instanceof String) || !((String) raw).matches("[a-z0-9][a-z0-9:._-]{0,127}")) {
            throw new SecureStoreException("invalid");
        }
        return (String) raw;
    }

    static String value(Object raw) throws SecureStoreException {
        if (!(raw instanceof String) || ((String) raw).length() > MAX_VALUE_BYTES ||
                ((String) raw).getBytes(StandardCharsets.UTF_8).length > MAX_VALUE_BYTES) {
            throw new SecureStoreException("invalid");
        }
        String value = (String) raw;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i == value.length() || !Character.isLowSurrogate(value.charAt(i))) throw new SecureStoreException("invalid");
            } else if (Character.isLowSurrogate(c)) throw new SecureStoreException("invalid");
        }
        return value;
    }

    static long version(Object raw) throws SecureStoreException {
        if (!(raw instanceof Number)) throw new SecureStoreException("invalid");
        double value = ((Number) raw).doubleValue();
        if (!Double.isFinite(value) || value < 0 || value > MAX_VERSION || value != Math.floor(value)) {
            throw new SecureStoreException("invalid");
        }
        return (long) value;
    }

    static boolean presence(Object raw) throws SecureStoreException {
        if (!(raw instanceof Boolean)) throw new SecureStoreException("invalid");
        return (Boolean) raw;
    }

    static long next(long value) throws SecureStoreException {
        if (value < 0 || value >= MAX_VERSION) throw new SecureStoreException("failed");
        return value + 1;
    }

    static String utf8(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    }

    static String namespace(String origin) {
        if (origin == null) throw new IllegalArgumentException("Missing suite origin");
        try { return hex(MessageDigest.getInstance("SHA-256").digest(origin.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) result.append(Character.forDigit((b >>> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
        return result.toString();
    }
}
