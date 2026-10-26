// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The system-browser leg of Solid-OIDC sign-in (DESIGN D4). Opens the authorization URL in a
 * Custom Tab via {@link AuthManagementActivity} and resolves with the redirect URL. Protocol
 * checks (state, PKCE, iss) happen in @jeswr/suite-native; this side validates its inputs too.
 */
@CapacitorPlugin(name = "SuiteAuthSession")
public class SuiteAuthSessionPlugin extends Plugin {

    static final String USER_CANCELLED = "USER_CANCELLED";

    private boolean inFlight = false;

    @PluginMethod
    public void authenticate(PluginCall call) {
        String url = call.getString("url");
        String scheme = call.getString("callbackScheme");
        if (!RedirectPolicy.SCHEME.equals(scheme)) {
            call.reject("Unsupported callback scheme", "INVALID_ARGUMENT");
            return;
        }
        if (!RedirectPolicy.isAuthorizationUrl(url, BuildConfig.DEBUG)) {
            call.reject("Authorization URL must be https", "INVALID_ARGUMENT");
            return;
        }
        if (inFlight) {
            call.reject("A sign-in is already in progress", "BUSY");
            return;
        }
        inFlight = true;
        Intent intent = new Intent(getContext(), AuthManagementActivity.class)
            .putExtra(AuthManagementActivity.EXTRA_AUTHORIZATION_URL, url);
        startActivityForResult(call, intent, "authResult");
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        if (inFlight) {
            // Brings the management activity back over the Custom Tab (CLEAR_TOP closes the tab).
            Intent intent = new Intent(getContext(), AuthManagementActivity.class)
                .setAction(AuthManagementActivity.ACTION_CANCEL)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @ActivityCallback
    private void authResult(PluginCall call, ActivityResult result) {
        inFlight = false;
        if (call == null) return;
        Intent data = result.getData();
        String url = data == null ? null : data.getStringExtra(AuthManagementActivity.EXTRA_CALLBACK_URL);
        if (result.getResultCode() == Activity.RESULT_OK && RedirectPolicy.isAuthCallback(url)) {
            JSObject ret = new JSObject();
            ret.put("url", url);
            call.resolve(ret);
        } else if (result.getResultCode() == AuthManagementActivity.RESULT_NO_BROWSER) {
            call.reject("No browser is available to sign in", "NO_BROWSER");
        } else {
            call.reject("Sign-in was cancelled", USER_CANCELLED);
        }
    }
}
