// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** RFC 8291 / RFC 8188, one aes128gcm record. No Android dependencies. */
final class PushCrypto {
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    static byte[] utf8(String value) { return value.getBytes(StandardCharsets.UTF_8); }
    static byte[] concat(byte[]... values) {
        int n = 0; for (byte[] value : values) n += value.length;
        ByteBuffer result = ByteBuffer.allocate(n);
        for (byte[] value : values) result.put(value);
        return result.array();
    }
    // Avoid java.util.Base64 (API 26) so the same code runs on minSdk 24 and plain JVMs.
    static String b64(byte[] value) {
        StringBuilder out = new StringBuilder(); int bits = 0, buffer = 0;
        for (byte b : value) {
            buffer = (buffer << 8) | (b & 255); bits += 8;
            while (bits >= 6) { bits -= 6; out.append(ALPHABET.charAt((buffer >>> bits) & 63)); }
        }
        if (bits > 0) out.append(ALPHABET.charAt((buffer << (6 - bits)) & 63));
        return out.toString();
    }
    static byte[] unb64(String value) {
        if (value == null || value.length() > 8192 || value.length() % 4 == 1) throw new IllegalArgumentException("Invalid base64url");
        byte[] out = new byte[value.length() * 6 / 8]; int bits = 0, buffer = 0, at = 0;
        for (char c : value.toCharArray()) {
            int digit = ALPHABET.indexOf(c);
            if (digit < 0) throw new IllegalArgumentException("Invalid base64url");
            buffer = (buffer << 6) | digit; bits += 6;
            if (bits >= 8) { bits -= 8; out[at++] = (byte) (buffer >>> bits); }
        }
        if (!b64(out).equals(value)) throw new IllegalArgumentException("Non-canonical base64url");
        return out;
    }
    static ECParameterSpec curve() throws GeneralSecurityException {
        AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
        params.init(new ECGenParameterSpec("secp256r1"));
        return params.getParameterSpec(ECParameterSpec.class);
    }
    static ECPublicKey publicKey(byte[] raw) throws GeneralSecurityException {
        if (raw.length != 65 || raw[0] != 4) throw new GeneralSecurityException("Invalid P-256 point");
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(raw, 1, 33));
        BigInteger y = new BigInteger(1, Arrays.copyOfRange(raw, 33, 65));
        ECParameterSpec spec = curve();
        BigInteger p = ((java.security.spec.ECFieldFp) spec.getCurve().getField()).getP();
        if (x.compareTo(p) >= 0 || y.compareTo(p) >= 0 || !y.multiply(y).mod(p).equals(
                x.multiply(x).multiply(x).add(spec.getCurve().getA().multiply(x)).add(spec.getCurve().getB()).mod(p))) {
            throw new GeneralSecurityException("Point is not on P-256");
        }
        return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), spec));
    }
    static byte[] coordinate(BigInteger value) {
        byte[] bytes = value.toByteArray(), out = new byte[32];
        int n = Math.min(bytes.length, 32); System.arraycopy(bytes, bytes.length - n, out, 32 - n, n); return out;
    }
    static byte[] point(ECPublicKey key) {
        return concat(new byte[] {4}, coordinate(key.getW().getAffineX()), coordinate(key.getW().getAffineY()));
    }
    static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key, "HmacSHA256")); return mac.doFinal(data);
    }
    static byte[][] derive(PrivateKey key, byte[] ua, byte[] auth, byte[] salt, byte[] sender) throws GeneralSecurityException {
        if (auth.length != 16) throw new GeneralSecurityException("Invalid auth secret");
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(key); agreement.doPhase(publicKey(sender), true);
        byte[] ikm = hmac(hmac(auth, agreement.generateSecret()), concat(utf8("WebPush: info\0"), ua, sender, new byte[] {1}));
        byte[] prk = hmac(salt, ikm);
        return new byte[][] {
            Arrays.copyOf(hmac(prk, utf8("Content-Encoding: aes128gcm\0\1")), 16),
            Arrays.copyOf(hmac(prk, utf8("Content-Encoding: nonce\0\1")), 12)
        };
    }
    static byte[] decrypt(String encoded, PrivateKey key, byte[] ua, byte[] auth) throws GeneralSecurityException {
        if (encoded == null || encoded.length() > 5462) throw new GeneralSecurityException("Oversized push");
        byte[] body = unb64(encoded);
        if (body.length < 103 || body.length > 4096 || ByteBuffer.wrap(body, 16, 4).getInt() != 4096 || body[20] != 65) {
            throw new GeneralSecurityException("Invalid aes128gcm header");
        }
        byte[][] derived = derive(key, ua, auth, Arrays.copyOf(body, 16), Arrays.copyOfRange(body, 21, 86));
        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.DECRYPT_MODE, new SecretKeySpec(derived[0], "AES"), new GCMParameterSpec(128, derived[1]));
        byte[] plain = aes.doFinal(Arrays.copyOfRange(body, 86, body.length));
        int end = plain.length - 1;
        while (end >= 0 && plain[end] == 0) end--;
        if (end < 0 || plain[end] != 2) throw new GeneralSecurityException("Invalid final record delimiter");
        return Arrays.copyOf(plain, end);
    }
    static byte[] sha256(byte[] value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value); }
        catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
    /** ES256 JWS uses fixed-width R || S, while Android Keystore signs ASN.1 DER. */
    static byte[] joseSignature(byte[] der) throws GeneralSecurityException {
        if (der.length < 8 || der.length > 72 || der[0] != 0x30 || (der[1] & 255) != der.length - 2) throw new GeneralSecurityException("Invalid signature");
        byte[] out = new byte[64]; int at = 2;
        for (int i = 0; i < 2; i++) {
            if (at + 2 > der.length || der[at++] != 2) throw new GeneralSecurityException("Invalid signature");
            int n = der[at++] & 255;
            if (n < 1 || n > 33 || at + n > der.length || (n == 33 && der[at] != 0)) throw new GeneralSecurityException("Invalid signature");
            int skip = n == 33 ? 1 : 0;
            System.arraycopy(der, at + skip, out, i * 32 + 32 - (n - skip), n - skip); at += n;
        }
        if (at != der.length) throw new GeneralSecurityException("Invalid signature");
        return out;
    }
}
