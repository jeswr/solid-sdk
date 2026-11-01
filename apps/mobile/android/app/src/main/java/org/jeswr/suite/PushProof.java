// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import java.net.URI;
import java.security.GeneralSecurityException;
import java.util.LinkedHashMap;
import java.util.Map;

/** Installation-Proof serialization; the signer is injected so tests verify a real ES256 proof. */
final class PushProof {
    interface Signer { byte[] sign(byte[] input) throws GeneralSecurityException; }
    static String sign(String method, String url, String body, long timestamp, Signer signer) throws Exception {
        URI uri = new URI(url);
        if (method == null || !method.matches("[A-Z]{1,16}") || url.length() > 2048 || !"https".equals(uri.getScheme())
            || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null
            || body == null || PushCrypto.utf8(body).length > 65536 || timestamp < 0) throw new IllegalArgumentException("Invalid proof request");
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("bodyHash", PushCrypto.b64(PushCrypto.sha256(PushCrypto.utf8(body))));
        claims.put("method", method); claims.put("timestamp", timestamp); claims.put("url", url);
        String input = PushCrypto.b64(PushCrypto.utf8("{\"alg\":\"ES256\"}")) + "." + PushCrypto.b64(PushCrypto.utf8(PushJson.encode(claims)));
        return input + "." + PushCrypto.b64(PushCrypto.joseSignature(signer.sign(PushCrypto.utf8(input))));
    }
}
