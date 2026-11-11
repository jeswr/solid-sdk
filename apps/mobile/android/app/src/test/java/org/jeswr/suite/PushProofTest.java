// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.math.BigInteger;
import java.security.KeyPair;
import java.security.Signature;
import java.util.Arrays;
import java.util.Map;
import org.junit.Test;

public class PushProofTest {
    @Test public void signsReplayProtectedInstallationProofWithES256() throws Exception {
        KeyPair pair = PushCryptoTest.pair(); String body = "{ \"x\": 1 }\n";
        String proof = PushProof.sign("POST", "https://relay.example/push/installations", body, 42, bytes -> {
            Signature signer = Signature.getInstance("SHA256withECDSA"); signer.initSign(pair.getPrivate()); signer.update(bytes); return signer.sign();
        });
        String[] parts = proof.split("\\."); assertEquals(3, parts.length);
        assertEquals("{\"alg\":\"ES256\",\"typ\":\"installation-proof+jwt\"}", new String(PushCrypto.unb64(parts[0]), java.nio.charset.StandardCharsets.UTF_8));
        Map<String, Object> claims = PushJson.object(PushJson.parse(new String(PushCrypto.unb64(parts[1]), java.nio.charset.StandardCharsets.UTF_8)));
        assertEquals(42L, claims.get("iat")); assertEquals("POST", claims.get("htm")); assertEquals("https://relay.example/push/installations", claims.get("htu"));
        assertEquals(PushCrypto.b64(PushCrypto.sha256(PushCrypto.utf8(body))), claims.get("body_sha256")); assertEquals(5, claims.size());
        assertTrue(((String) claims.get("jti")).matches("[A-Za-z0-9_-]{22}"));
        String again = PushProof.sign("POST", "https://relay.example/push/installations", body, 42, bytes -> {
            Signature signer = Signature.getInstance("SHA256withECDSA"); signer.initSign(pair.getPrivate()); signer.update(bytes); return signer.sign();
        });
        assertNotEquals(claims.get("jti"), PushJson.object(PushJson.parse(new String(PushCrypto.unb64(again.split("\\.")[1]), java.nio.charset.StandardCharsets.UTF_8))).get("jti"));
        byte[] raw = PushCrypto.unb64(parts[2]); assertEquals(64, raw.length);
        byte[] r = new BigInteger(1, Arrays.copyOf(raw, 32)).toByteArray(), s = new BigInteger(1, Arrays.copyOfRange(raw, 32, 64)).toByteArray();
        byte[] der = PushCrypto.concat(new byte[] {0x30, (byte) (4 + r.length + s.length), 2, (byte) r.length}, r, new byte[] {2, (byte) s.length}, s);
        Signature verify = Signature.getInstance("SHA256withECDSA"); verify.initVerify(pair.getPublic()); verify.update(PushCrypto.utf8(parts[0] + "." + parts[1])); assertTrue(verify.verify(der));
        assertArrayEquals(raw, PushCrypto.joseSignature(der));
    }
    @Test public void canonicalClaimsAndInvalidRequests() throws Exception {
        // Interop fixture: byte-identical to PushProofTests.swift and accepted by the relay's
        // apps/notification-relay/src/device-proof-interop.test.ts.
        String expected = "eyJhbGciOiJFUzI1NiIsInR5cCI6Imluc3RhbGxhdGlvbi1wcm9vZitqd3QifQ.eyJib2R5X3NoYTI1NiI6InZha1VuRGhQTVpzLXJMcHZLMml0Zk95OGxFWU12UG13STJvQlNNWWtUeG8iLCJodG0iOiJQT1NUIiwiaHR1IjoiaHR0cHM6Ly9yZWxheS5leGFtcGxlL3B1c2gvaW5zdGFsbGF0aW9ucy9hYmMvYWN0aXZhdGUiLCJpYXQiOjE3MDAwMDAwMDAsImp0aSI6ImludGVyb3AtZml4dHVyZS1qdGkifQ";
        KeyPair pair = PushCryptoTest.pair();
        PushProof.Signer signer = bytes -> {
            assertEquals(expected, new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            Signature sign = Signature.getInstance("SHA256withECDSA"); sign.initSign(pair.getPrivate()); sign.update(bytes); return sign.sign();
        };
        PushProof.sign("POST", "https://relay.example/push/installations/abc/activate", "{\"nonce\":\"n\"}", 1700000000L, "interop-fixture-jti", signer);
        for (String jti : new String[] {"", "a b", "a.b", new String(new char[129]).replace('\0', 'a')}) {
            assertThrows(Exception.class, () -> PushProof.sign("DELETE", "https://relay.example/", "", 1, jti, signer));
        }
        for (String url : new String[] {"http://relay.example/", "https://user@relay.example/", "https://relay.example/#f", "https://relay.example/?x=1", "https://relay.example/?", "//relay.example/", "relative", "https:/path"}) {
            assertThrows(Exception.class, () -> PushProof.sign("DELETE", url, "", 1, "j", signer));
        }
        for (String method : new String[] {"post", "POST\n", "", "POST DELETE"}) {
            assertThrows(Exception.class, () -> PushProof.sign(method, "https://relay.example/", "", 1, "j", signer));
        }
        assertThrows(Exception.class, () -> PushCrypto.joseSignature(new byte[64]));
        assertThrows(Exception.class, () -> PushProof.sign("POST", "https://relay.example/", new String(new char[65537]), 1, "j", signer));
    }
}
