// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import android.os.Handler;
import android.os.Looper;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Local origin-scoped bridge. File and crypto work share one serial queue across activity recreation. */
@CapacitorPlugin(name = "SuiteSecureStore")
public class SuiteSecureStorePlugin extends Plugin {
    private static final ExecutorService queue = Executors.newSingleThreadExecutor();
    private final Executor main = command -> new Handler(Looper.getMainLooper()).post(command);
    private final SecureStoreOperations operations = new SecureStoreOperations(queue, main,
        () -> new SecureStorePrompt(getActivity(), main));
    private SecureStore store;
    private SecureStore.Crypto crypto;
    private volatile boolean destroyed;

    @Override public void load() {
        operations.foreground(getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED));
    }

    private SecureStore store() throws Exception {
        if (destroyed) throw new SecureStoreException("unavailable");
        if (store == null) {
            String origin = NavigationPolicy.appUrl(bridge.getServerUrl(), bridge.getLocalUrl());
            if (NavigationPolicy.origin(origin) == null) throw new SecureStoreException("unavailable");
            String namespace = SecureStoreValidation.namespace(origin);
            crypto = new SecureStoreCipher(new SecureStoreKeys(getContext(), namespace));
            store = new SecureStore(namespace, new SecureStoreFile(new File(getContext().getNoBackupFilesDir(), "securestore"), namespace), crypto);
        }
        return store;
    }

    @PluginMethod public void status(PluginCall call) {
        queue.execute(() -> {
            SecureStore.Status status;
            try { store(); status = crypto.status(); }
            catch (Exception e) { status = new SecureStore.Status(false, false, false); }
            JSObject result = new JSObject();
            result.put("available", status.available); result.put("userPresence", status.userPresence); result.put("hardwareBacked", status.hardwareBacked);
            call.resolve(result);
        });
    }

    @PluginMethod public void get(PluginCall call) {
        final String key;
        final SecureStoreOperations.Ticket ticket;
        try {
            key = SecureStoreValidation.key(call.getData().opt("key"));
            ticket = operations.takeReadTicket(call.getCallbackId(), key);
        }
        catch (Exception e) { reject(call, e); return; }
        operations.get(this::store, ticket, new SecureStoreOperations.Result() {
            @Override public void success(SecureStore.Value value) {
                JSObject data = new JSObject();
                data.put("value", value.value == null ? JSONObject.NULL : value.value); data.put("version", value.version);
                call.resolve(data);
            }
            @Override public void failure(String code) { call.reject(code, code); }
        });
    }

    @PluginMethod public void set(PluginCall call) {
        queue.execute(() -> {
            try {
                String key = SecureStoreValidation.key(call.getData().opt("key"));
                String value = SecureStoreValidation.value(call.getData().opt("value"));
                boolean presence = SecureStoreValidation.presence(call.getData().opt("userPresence"));
                long version = SecureStoreValidation.version(call.getData().opt("version"));
                JSObject result = new JSObject();
                result.put("version", store().set(key, value, presence, version));
                call.resolve(result);
            } catch (Exception e) { reject(call, e); }
        });
    }

    @PluginMethod public void remove(PluginCall call) {
        final String key;
        try { key = SecureStoreValidation.key(call.getData().opt("key")); }
        catch (Exception e) { reject(call, e); return; }
        operations.remove(key);
        queue.execute(() -> {
            try {
                store().remove(key); call.resolve(new JSObject());
            } catch (Exception e) { reject(call, e); }
        });
    }

    @PluginMethod public void clear(PluginCall call) {
        operations.clear();
        queue.execute(() -> {
            try { store().clear(); call.resolve(new JSObject()); }
            catch (Exception e) { reject(call, e); }
        });
    }

    @PluginMethod public void cancel(PluginCall call) { operations.cancel(); call.resolve(new JSObject()); }
    void admitRead(String callbackId, Object key) { operations.admitRead(callbackId, key); }
    void mainFrameNavigation() { operations.navigation(); }
    @Override protected void handleOnResume() { operations.foreground(true); }
    @Override protected void handleOnPause() { operations.foreground(false); }
    @Override protected void handleOnStop() { operations.foreground(false); }
    @Override protected void handleOnDestroy() { destroyed = true; operations.foreground(false); }

    private static void reject(PluginCall call, Exception error) {
        String code = SecureStoreException.code(error);
        call.reject(code, code);
    }
}
