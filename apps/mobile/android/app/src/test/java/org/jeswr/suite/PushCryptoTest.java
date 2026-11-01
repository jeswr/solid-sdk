// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECPrivateKeySpec;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.Test;

public class PushCryptoTest {
    static final String RFC = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
        + "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
        + "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
    static final String UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    static PrivateKey receiver() throws Exception {
        return KeyFactory.getInstance("EC").generatePrivate(new ECPrivateKeySpec(new BigInteger(1,
            PushCrypto.unb64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94")), PushCrypto.curve()));
    }
    static KeyPair pair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC"); generator.initialize(new ECGenParameterSpec("secp256r1")); return generator.generateKeyPair();
    }
    /** Independent sender composition, using JCA ECDH and the RFC's HMAC sequence. */
    static String encrypt(byte[] plain, KeyPair receiver, byte[] auth, int delimiter) throws Exception {
        KeyPair sender = pair(); byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt);
        byte[] ua = PushCrypto.point((ECPublicKey) receiver.getPublic()), as = PushCrypto.point((ECPublicKey) sender.getPublic());
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH"); agreement.init(sender.getPrivate()); agreement.doPhase(receiver.getPublic(), true);
        byte[] ikm = PushCrypto.hmac(PushCrypto.hmac(auth, agreement.generateSecret()), PushCrypto.concat(PushCrypto.utf8("WebPush: info\0"), ua, as, new byte[] {1}));
        byte[] prk = PushCrypto.hmac(salt, ikm);
        byte[] cek = Arrays.copyOf(PushCrypto.hmac(prk, PushCrypto.utf8("Content-Encoding: aes128gcm\0\1")), 16);
        byte[] nonce = Arrays.copyOf(PushCrypto.hmac(prk, PushCrypto.utf8("Content-Encoding: nonce\0\1")), 12);
        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding"); aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        return PushCrypto.b64(PushCrypto.concat(salt, ByteBuffer.allocate(4).putInt(4096).array(), new byte[] {65}, as,
            aes.doFinal(PushCrypto.concat(plain, new byte[] {(byte) delimiter, 0, 0}))));
    }
    @Test public void decryptsRFC8291Section5() throws Exception {
        assertEquals("When I grow up, I want to be a watermelon", new String(PushCrypto.decrypt(RFC, receiver(),
            PushCrypto.unb64(UA_PUBLIC), PushCrypto.unb64("BTBZMqHH6r4Tts7J_aSIgg")), java.nio.charset.StandardCharsets.UTF_8));
    }
    @Test public void roundTripsRandomKeysAndRejectsTamperingWrongAuthAndDelimiter() throws Exception {
        for (int i = 0; i < 8; i++) {
            KeyPair pair = pair(); byte[] auth = new byte[16]; new SecureRandom().nextBytes(auth);
            byte[] plain = PushStateTest.padded(PushStateTest.json("m" + i, "chat", "b", 1));
            String wire = encrypt(plain, pair, auth, 2);
            byte[] publicKey = PushCrypto.point((ECPublicKey) pair.getPublic());
            assertArrayEquals(plain, PushCrypto.decrypt(wire, pair.getPrivate(), publicKey, auth));
            byte[] tampered = PushCrypto.unb64(wire); tampered[tampered.length - 1] ^= 1;
            assertThrows(Exception.class, () -> PushCrypto.decrypt(PushCrypto.b64(tampered), pair.getPrivate(), publicKey, auth));
            byte[] wrongAuth = auth.clone(); wrongAuth[0] ^= 1;
            assertThrows(Exception.class, () -> PushCrypto.decrypt(wire, pair.getPrivate(), publicKey, wrongAuth));
            String wrongDelimiter = encrypt(plain, pair, auth, 1);
            assertThrows(Exception.class, () -> PushCrypto.decrypt(wrongDelimiter, pair.getPrivate(), publicKey, auth));
        }
    }
    @Test public void rejectsOversizeHeaderVariantsInvalidPointsAndBase64() throws Exception {
        byte[] ua = PushCrypto.unb64(UA_PUBLIC), auth = PushCrypto.unb64("BTBZMqHH6r4Tts7J_aSIgg");
        for (String bad : new String[] {"", "a", RFC + "=", RFC + "\n", PushCrypto.b64(new byte[4097])}) {
            assertThrows(Exception.class, () -> PushCrypto.decrypt(bad, receiver(), ua, auth));
        }
        for (int offset : new int[] {16, 18, 20, 21, 22}) {
            byte[] body = PushCrypto.unb64(RFC); body[offset] ^= 1;
            assertThrows(Exception.class, () -> PushCrypto.decrypt(PushCrypto.b64(body), receiver(), ua, auth));
        }
        assertThrows(Exception.class, () -> PushCrypto.publicKey(new byte[65]));
        byte[] offCurve = new byte[65]; offCurve[0] = 4;
        assertThrows(Exception.class, () -> PushCrypto.publicKey(offCurve));
        assertThrows(Exception.class, () -> PushCrypto.unb64("AB")); // nonzero unused bits
    }
}
