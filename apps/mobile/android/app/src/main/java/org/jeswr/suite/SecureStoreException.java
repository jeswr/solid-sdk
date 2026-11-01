// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

/** Only these codes cross the bridge; native exception messages stay native. */
final class SecureStoreException extends Exception {
    final String code;
    SecureStoreException(String code) { super(code); this.code = code; }

    static String code(Exception error) {
        return error instanceof SecureStoreException ? ((SecureStoreException) error).code : "failed";
    }
}
