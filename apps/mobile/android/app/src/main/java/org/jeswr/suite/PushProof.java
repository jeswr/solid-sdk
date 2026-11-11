// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.net.URI;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * installation-proof+jwt serialization, the exact shape the relay verifier admits: header
 * {alg,typ}, claims {body_sha256,htm,htu,iat,jti} in sorted key order (byte-identical to iOS).
 * htu is the request URL with no query; jti is fresh per proof so the relay rejects replays.
 * The signer is injected so tests verify a real ES256 proof.
 */
final class PushProof {
    static final String HEADER = "{\"alg\":\"ES256\",\"typ\":\"installation-proof+jwt\"}";
    private static final SecureRandom RANDOM = new SecureRandom();
    interface Signer { byte[] sign(byte[] input) throws GeneralSecurityException; }
    static String sign(String method, String url, String body, long timestamp, Signer signer) throws Exception {
        byte[] nonce = new byte[16]; RANDOM.nextBytes(nonce);
        return sign(method, url, body, timestamp, PushCrypto.b64(nonce), signer);
    }
    static String sign(String method, String url, String body, long timestamp, String jti, Signer signer) throws Exception {
        URI uri = new URI(url);
        if (method == null || !method.matches("[A-Z]{1,16}") || url.length() > 2048 || !"https".equals(uri.getScheme())
            || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
            || body == null || PushCrypto.utf8(body).length > 65536 || timestamp < 0
            || jti == null || !jti.matches("[A-Za-z0-9_-]{1,128}")) throw new IllegalArgumentException("Invalid proof request");
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("body_sha256", PushCrypto.b64(PushCrypto.sha256(PushCrypto.utf8(body))));
        claims.put("htm", method); claims.put("htu", url); claims.put("iat", timestamp); claims.put("jti", jti);
        String input = PushCrypto.b64(PushCrypto.utf8(HEADER)) + "." + PushCrypto.b64(PushCrypto.utf8(PushJson.encode(claims)));
        return input + "." + PushCrypto.b64(PushCrypto.joseSignature(signer.sign(PushCrypto.utf8(input))));
    }
}
