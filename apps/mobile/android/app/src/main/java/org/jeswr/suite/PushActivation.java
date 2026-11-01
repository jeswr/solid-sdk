// AUTHORED-BY Codex GPT-6.1-Sol
package org.jeswr.suite;

import java.util.LinkedHashMap;
import java.util.Map;

/** Bounded early-challenge mailbox: create can deliver before JS calls activate. Main-process only. */
final class PushActivation {
    private final Map<String, Challenge> early = new LinkedHashMap<>();
    private static final class Challenge {
        final String nonce; final long expires;
        Challenge(String nonce, long now) { this.nonce = nonce; expires = now + 60000; }
    }
    synchronized void deliver(String installation, String nonce, long now) {
        early.entrySet().removeIf(e -> e.getValue().expires <= now);
        if (early.size() == 4) early.remove(early.keySet().iterator().next());
        early.put(installation, new Challenge(nonce, now));
    }
    synchronized String take(String installation, long now) {
        Challenge challenge = early.remove(installation);
        return challenge != null && challenge.expires > now ? challenge.nonce : null;
    }
    synchronized void clear() { early.clear(); }
}
