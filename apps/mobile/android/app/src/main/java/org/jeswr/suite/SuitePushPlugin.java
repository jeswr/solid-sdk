// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.File;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

/** Registered only on MainActivity's D3 guarded bridge, like the other Suite plugins. */
@CapacitorPlugin(name = "SuitePush", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class SuitePushPlugin extends Plugin {
    private static PushStore sharedStore;
    private static final PushActivation challenges = new PushActivation();
    private static SuitePushPlugin active;
    private final Handler main = new Handler(Looper.getMainLooper());
    private PluginCall activation;
    private String installation;
    private long activationDeadline;
    private final PushEnablement<PluginCall> enablement = new PushEnablement<>();
    private volatile boolean deleting;

    static synchronized PushStore store(Context context) throws java.io.IOException {
        if (sharedStore == null) sharedStore = new PushStore(new File(context.getNoBackupFilesDir(), "push"));
        return sharedStore;
    }
    static void challenge(PushPolicy.Payload payload) {
        synchronized (SuitePushPlugin.class) {
            challenges.deliver(payload.registrationId, payload.nonce, System.currentTimeMillis());
            if (active != null) active.main.post(active::resolveChallenge);
        }
    }
    @Override public void load() {
        synchronized (SuitePushPlugin.class) { active = this; }
        capture(getActivity().getIntent());
    }
    @Override protected void handleOnNewIntent(Intent intent) { capture(intent); }
    private void capture(Intent intent) {
        if (intent == null || !intent.hasExtra("suitePushRegistration")) return;
        String registration = intent.getStringExtra("suitePushRegistration"); int index = intent.getIntExtra("suitePushTopic", -1);
        intent.removeExtra("suitePushRegistration"); intent.removeExtra("suitePushTopic");
        try { store(getContext()).launch(registration, index); } catch (Exception ignored) { /* No route on corrupt state. */ }
    }
    private boolean configured() {
        try { FirebaseApp.getInstance(); return true; }
        catch (IllegalStateException e) { return false; }
    }
    private String permission() {
        if (Build.VERSION.SDK_INT >= 33) {
            PermissionState state = getPermissionState("notifications");
            if (state != PermissionState.GRANTED) return state == PermissionState.DENIED ? "denied" : "prompt";
        }
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
    }
    @PluginMethod public void status(PluginCall call) {
        try {
            JSObject result = new JSObject(); result.put("permission", permission()); result.put("installed", PushKeys.installed(getContext())); result.put("platform", "android");
            result.put("registrationStale", store(getContext()).registrationStale()); call.resolve(result);
        } catch (Exception e) { call.reject("Cannot read push registration state", "push-unavailable"); }
    }
    @PluginMethod public void enable(PluginCall call) {
        synchronized (enablement) {
            if (!configured()) { call.reject("Firebase is not configured for this build", "push-unavailable"); return; }
            if (deleting || !enablement.begin(call)) { call.reject("Push lifecycle operation is already pending", "BUSY"); return; }
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
                requestPermissionForAlias("notifications", call, "notificationPermission"); return;
            }
            enabled(call);
        }
    }
    @PermissionCallback private void notificationPermission(PluginCall call) { enabled(call); }
    private void enabled(PluginCall call) {
        enablement.withCurrent(call, () -> {
            if (!permission().equals("granted")) {
                enablement.finish(call, () -> call.reject("Notifications are not permitted", "permission-denied")); return;
            }
            main.postDelayed(() -> enablement.finish(call, () -> call.reject("Firebase token request timed out", "push-unavailable")), 30000);
            try {
                FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> enablement.finish(call, () -> {
                    if (!task.isSuccessful() || task.getResult() == null) { call.reject("Cannot obtain a Firebase push token", "push-unavailable"); return; }
                    try {
                        PushKeys keys = new PushKeys(getContext(), true);
                        store(getContext()).recordToken(task.getResult());
                        JSObject result = new JSObject(); result.put("pushToken", task.getResult()); result.put("devicePublicKey", PushCrypto.b64(keys.publicKey));
                        result.put("authSecret", PushCrypto.b64(keys.auth)); result.put("deviceSigningKey", new JSONObject(keys.publicSigningKey())); call.resolve(result);
                    } catch (Exception e) { call.reject("Cannot open the push key store", "push-unavailable"); }
                }));
            } catch (Exception e) { enablement.finish(call, () -> call.reject("Cannot obtain a Firebase push token", "push-unavailable")); }
        });
    }
    @PluginMethod public void setTopicMap(PluginCall call) {
        try {
            Map<String, Object> args = PushJson.object(PushJson.parse(call.getData().toString()));
            store(getContext()).setTopics(PushPolicy.id(args.get("registrationId")), (List<?>) args.get("topics"),
                args.containsKey("pushToken") ? PushJson.string(args.get("pushToken")) : null); call.resolve();
        } catch (Exception e) { call.reject("Invalid or unavailable topic map", "INVALID_ARGUMENT"); }
    }
    @PluginMethod public void silence(PluginCall call) {
        try { store(getContext()).silence(call.getString("registrationId")); call.resolve(); }
        catch (Exception e) { call.reject("Cannot silence registration", "INVALID_ARGUMENT"); }
    }
    @PluginMethod public void sign(PluginCall call) {
        if (call.getData().has("body") && call.getString("body") == null) { call.reject("body must be a string", "INVALID_ARGUMENT"); return; }
        try {
            PushKeys keys = new PushKeys(getContext(), false);
            String proof = PushProof.sign(call.getString("method"), call.getString("url"), call.getString("body", ""), System.currentTimeMillis() / 1000, keys::sign);
            JSObject result = new JSObject(); result.put("proof", proof); call.resolve(result);
        } catch (Exception e) { call.reject("Cannot sign installation request", "INVALID_ARGUMENT"); }
    }
    @PluginMethod public void activate(PluginCall call) {
        String id;
        try { id = PushPolicy.id(call.getString("installationId")); }
        catch (Exception e) { call.reject("Invalid installationId", "INVALID_ARGUMENT"); return; }
        main.post(() -> {
            if (activation != null) { call.reject("Activation is already pending", "BUSY"); return; }
            activation = call; installation = id; activationDeadline = System.currentTimeMillis() + 60000; resolveChallenge();
            main.postDelayed(() -> {
                if (activation == call) { activation = null; installation = null; call.reject("Activation challenge timed out; try again", "activation-timeout"); }
            }, 60000);
        });
    }
    private void resolveChallenge() {
        if (activation == null) return;
        if (System.currentTimeMillis() >= activationDeadline) {
            PluginCall expired = activation; activation = null; installation = null;
            expired.reject("Activation challenge timed out; try again", "activation-timeout"); return;
        }
        String nonce = challenges.take(installation, System.currentTimeMillis());
        if (nonce == null) return;
        PluginCall call = activation; activation = null; installation = null;
        JSObject result = new JSObject(); result.put("nonce", nonce); call.resolve(result);
    }
    @PluginMethod public void disable(PluginCall call) {
        synchronized (enablement) {
            try {
                PluginCall cancelled = enablement.disable(() -> store(getContext()).silenceAll());
                if (cancelled != null) cancelled.reject("Push was disabled", "disabled");
            } catch (Exception e) { call.reject("Cannot silence push", "push-unavailable"); return; }
            if (deleting) { call.reject("Push cleanup is still pending; registrations are silenced", "BUSY"); return; }
            deleting = Boolean.TRUE.equals(call.getBoolean("deleteLocalData", false));
        }
        main.post(() -> {
            cancelActivation(); challenges.clear();
            if (Boolean.TRUE.equals(call.getBoolean("deleteLocalData", false))) {
                // P2d calls this ONLY after remote deletion is confirmed. A failed token deletion retains keys for retry.
                if (configured()) FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> {
                    if (task.isSuccessful()) erase(call); else { deleting = false; call.reject("Cannot drop push token; retry cleanup", "push-unavailable"); }
                });
                else erase(call);
            } else call.resolve();
        });
    }
    private void erase(PluginCall call) {
        try {
            PushKeys.delete(getContext());
            store(getContext()).clear(); call.resolve();
        } catch (Exception e) { call.reject("Cannot delete push state; retry cleanup", "push-unavailable"); }
        finally { deleting = false; }
    }
    private void cancelActivation() {
        if (activation != null) activation.reject("Push was disabled", "disabled");
        activation = null; installation = null;
    }
    @PluginMethod public void consumeLaunchRoute(PluginCall call) {
        try {
            Map<String, Object> launch = store(getContext()).consumeLaunch();
            JSObject result = new JSObject(); result.put("launchRoute", launch == null ? JSONObject.NULL : new JSONObject(launch)); call.resolve(result);
        } catch (Exception e) { call.reject("Cannot read launch route", "push-unavailable"); }
    }
    @Override protected void handleOnDestroy() {
        synchronized (SuitePushPlugin.class) { if (active == this) active = null; }
        main.post(this::cancelActivation);
        synchronized (enablement) {
            try {
                PluginCall cancelled = enablement.disable(() -> {});
                if (cancelled != null) cancelled.reject("Push bridge was closed", "disabled");
            } catch (Exception ignored) { /* No IO in cancellation. */ }
        }
    }
}
