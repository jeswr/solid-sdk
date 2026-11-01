// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

/** OS-independent receive decision with injected credential/state access, including the locked-device seam. */
final class PushReceiver {
    interface Decryptor { byte[] decrypt(String value) throws Exception; }
    interface Storage { PushStore load() throws Exception; }
    enum Kind { DROP, GENERIC, CHALLENGE, NOTIFY }
    static final class Result {
        final Kind kind; final PushPolicy.Payload payload; final PushStore.Delivery delivery;
        Result(Kind kind, PushPolicy.Payload payload, PushStore.Delivery delivery) { this.kind = kind; this.payload = payload; this.delivery = delivery; }
    }
    static Result receive(String encoded, boolean unlocked, Decryptor decryptor, Storage storage) {
        if (encoded == null || encoded.length() > 5462) return new Result(Kind.DROP, null, null);
        if (!unlocked) return new Result(Kind.GENERIC, null, null);
        try {
            PushPolicy.Payload payload = PushPolicy.plaintext(decryptor.decrypt(encoded));
            PushStore store = storage.load();
            if (payload.kind.equals("challenge")) return new Result(store.remember(payload.id) ? Kind.CHALLENGE : Kind.DROP, payload, null);
            PushStore.Delivery delivery = store.accept(payload);
            return new Result(delivery == null ? Kind.DROP : Kind.NOTIFY, payload, delivery);
        } catch (Exception e) { return new Result(Kind.DROP, null, null); }
    }
    static boolean deleted(boolean unlocked, Storage storage, Runnable post) {
        if (!unlocked) { post.run(); return true; }
        try { return storage.load().withAnyActive(post); }
        catch (Exception e) { return false; } // Unreadable state after unlock fails closed.
    }
}
