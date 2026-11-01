// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.math.BigInteger;
import java.security.KeyPair;
import java.security.Signature;
import java.util.Arrays;
import java.util.Map;
import org.junit.Test;

public class PushProofTest {
    @Test public void signsExactMethodUrlTimestampAndBodyHashWithES256() throws Exception {
        KeyPair pair = PushCryptoTest.pair(); String body = "{ \"x\": 1 }\n";
        String proof = PushProof.sign("POST", "https://relay.example/push/installations?x=1", body, 42, bytes -> {
            Signature signer = Signature.getInstance("SHA256withECDSA"); signer.initSign(pair.getPrivate()); signer.update(bytes); return signer.sign();
        });
        String[] parts = proof.split("\\."); assertEquals(3, parts.length);
        assertEquals("{\"alg\":\"ES256\"}", new String(PushCrypto.unb64(parts[0]), java.nio.charset.StandardCharsets.UTF_8));
        Map<String, Object> claims = PushJson.object(PushJson.parse(new String(PushCrypto.unb64(parts[1]), java.nio.charset.StandardCharsets.UTF_8)));
        assertEquals(42L, claims.get("timestamp")); assertEquals("POST", claims.get("method")); assertEquals("https://relay.example/push/installations?x=1", claims.get("url"));
        assertEquals(PushCrypto.b64(PushCrypto.sha256(PushCrypto.utf8(body))), claims.get("bodyHash")); assertEquals(4, claims.size());
        byte[] raw = PushCrypto.unb64(parts[2]); assertEquals(64, raw.length);
        byte[] r = new BigInteger(1, Arrays.copyOf(raw, 32)).toByteArray(), s = new BigInteger(1, Arrays.copyOfRange(raw, 32, 64)).toByteArray();
        byte[] der = PushCrypto.concat(new byte[] {0x30, (byte) (4 + r.length + s.length), 2, (byte) r.length}, r, new byte[] {2, (byte) s.length}, s);
        Signature verify = Signature.getInstance("SHA256withECDSA"); verify.initVerify(pair.getPublic()); verify.update(PushCrypto.utf8(parts[0] + "." + parts[1])); assertTrue(verify.verify(der));
        assertArrayEquals(raw, PushCrypto.joseSignature(der));
    }
    @Test public void canonicalClaimsAndInvalidRequests() throws Exception {
        String expected = "{\"bodyHash\":\"47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU\",\"method\":\"DELETE\",\"timestamp\":1,\"url\":\"https://relay.example/push/installations/id\"}";
        KeyPair pair = PushCryptoTest.pair();
        PushProof.Signer signer = bytes -> {
            String input = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(expected, new String(PushCrypto.unb64(input.split("\\.")[1]), java.nio.charset.StandardCharsets.UTF_8));
            Signature sign = Signature.getInstance("SHA256withECDSA"); sign.initSign(pair.getPrivate()); sign.update(bytes); return sign.sign();
        };
        PushProof.sign("DELETE", "https://relay.example/push/installations/id", "", 1, signer);
        for (String url : new String[] {"http://relay.example/", "https://user@relay.example/", "https://relay.example/#f", "//relay.example/", "relative", "https:/path"}) {
            assertThrows(Exception.class, () -> PushProof.sign("DELETE", url, "", 1, signer));
        }
        for (String method : new String[] {"post", "POST\n", "", "POST DELETE"}) {
            assertThrows(Exception.class, () -> PushProof.sign(method, "https://relay.example/", "", 1, signer));
        }
        assertThrows(Exception.class, () -> PushCrypto.joseSignature(new byte[64]));
        assertThrows(Exception.class, () -> PushProof.sign("POST", "https://relay.example/", new String(new char[65537]), 1, signer));
    }
}
