// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.Collections;

/** Keeps the main frame on the exact suite origin; other http(s)/mailto/tel links open outside. */
public class SuiteWebViewClient extends BridgeWebViewClient {

    private final NavigationPolicy policy;
    private final Bridge bridge;

    public SuiteWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        this.policy = new NavigationPolicy(bridge.getServerUrl(), bridge.getErrorUrl());
    }

    /**
     * Android skips shouldOverrideUrlLoading for POST navigations and their redirects, so a form
     * could still replace the main frame with a foreign page. Main-frame loads that are not a GET of
     * the suite origin or the offline page get an empty 403 (Capacitor then shows the offline page).
     */
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (request.isForMainFrame() && !policy.allowsMainFrameLoad(request.getUrl().toString(), request.getMethod())) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String target = url.toString();
        if (request.isForMainFrame() && !policy.staysInApp(target) && !policy.isErrorPage(target)) {
            if (policy.mayOpenExternally(target)) {
                try {
                    bridge.getContext().startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) {
                    // Nothing can open it; the navigation is still blocked.
                }
            }
            return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
    }
}
