// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import android.os.Bundle;
import android.view.Gravity;
import android.webkit.WebView;
import android.widget.TextView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayInputStream;
import java.io.InputStream;

/**
 * The suite shell. Registers the local plugins and refuses to start the Capacitor bridge on a
 * WebView without WEB_MESSAGE_LISTENER (Capacitor would fall back to addJavascriptInterface, which
 * exposes the bridge to every frame) or DOCUMENT_START_SCRIPT (Capacitor would inject its bridge by
 * proxying the suite's HTML through an HttpURLConnection that follows redirects to any origin and
 * serves the result as the suite) (DESIGN D3).
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SuiteAuthSessionPlugin.class);
        registerPlugin(SuiteShareIntakePlugin.class);
        registerPlugin(SuiteShareStagingPlugin.class);
        registerPlugin(SuiteSecureStorePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            refuse();
            return;
        }
        super.load();
        WebView webView = bridge.getWebView();
        if (usesProxyInjection()) {
            // addDocumentStartJavaScript threw and Capacitor fell back to the proxy: fail closed.
            webView.stopLoading();
            refuse();
            return;
        }
        bridge.setWebViewClient(new SuiteWebViewClient(bridge));
        webView.stopLoading();
        // Reinstall Capacitor's listener with synchronous secure-store admission. Its inherited
        // listener checks the main frame and WebView enforces these exact-origin rules before
        // SuiteMessageHandler.postMessage can take a ticket or dispatch any plugin invocation.
        try {
            if (NavigationPolicy.origin(bridge.getServerUrl()) == null) throw new IllegalStateException("Missing suite origin");
            WebViewCompat.removeWebMessageListener(webView, "androidBridge");
            bridge.getAllowedOriginRules().clear();
            bridge.getAllowedOriginRules().add(bridge.getServerUrl());
            new SuiteMessageHandler(bridge, webView);
        } catch (RuntimeException e) {
            refuse();
            return;
        }
        // Capacitor's cookie and HTTP plugins install JavascriptInterfaces for every frame whatever
        // their config, and its bridge falls back to an "androidBridge" interface if registering the
        // origin-scoped web message listener throws. Remove all three and restart the first load so
        // no document sees them (DESIGN D3). Removing "androidBridge" leaves the listener (a separate
        // mechanism) in place; after a fallback it leaves the suite without a bridge: fail closed.
        for (String name : FRAME_INTERFACES) {
            webView.removeJavascriptInterface(name);
        }
        webView.stopLoading();
        webView.loadUrl(bridge.getAppUrl());
    }

    /** The local server wraps streams only when it holds the proxy-injection fallback. */
    private boolean usesProxyInjection() {
        InputStream probe = new ByteArrayInputStream(new byte[0]);
        return bridge.getLocalServer().getJavaScriptInjectedStream(probe) != probe;
    }

    private void refuse() {
        TextView message = new TextView(this);
        message.setText(R.string.webview_too_old);
        message.setGravity(Gravity.CENTER);
        message.setPadding(48, 48, 48, 48);
        setContentView(message);
    }

    private static final String[] FRAME_INTERFACES = {
        "androidBridge",
        "CapacitorCookiesAndroidInterface",
        "CapacitorHttpAndroidInterface",
    };
}
