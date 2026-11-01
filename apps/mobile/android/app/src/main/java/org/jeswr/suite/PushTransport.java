// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import java.util.Map;

/** Reject before Firebase's background display logic, regardless of flag values or encrypted data. */
final class PushTransport {
    static void dispatch(Iterable<String> keys, Runnable firebase) {
        if (!notificationBearing(keys)) firebase.run();
    }
    static boolean notificationBearing(Map<String, ?> extras) {
        return extras != null && notificationBearing(extras.keySet());
    }
    static boolean notificationBearing(Iterable<String> keys) {
        for (String key : keys) {
            if (key != null && (key.startsWith("gcm.notification.") || key.startsWith("gcm.n."))) return true;
        }
        return false;
    }
}
