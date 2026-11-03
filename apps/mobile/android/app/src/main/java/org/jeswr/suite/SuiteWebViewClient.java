// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
package org.jeswr.suite;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.PluginHandle;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import org.json.JSONException;

/**
 * Keeps the main frame on the exact app origin; other http(s)/mailto/tel links open outside. In
 * bundled mode (no server.url) it also serves every request to the local origin from the bundle
 * itself (MOB-P3 E4), and lets device files through only as sandboxed media (E5).
 */
public class SuiteWebViewClient extends BridgeWebViewClient {

    private final NavigationPolicy policy;
    private final Bridge bridge;
    private final String appOrigin;
    private final String localHost;
    private final BundledServer bundled;

    public SuiteWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        String appUrl = NavigationPolicy.appUrl(bridge.getServerUrl(), bridge.getLocalUrl());
        this.policy = new NavigationPolicy(appUrl, bridge.getErrorUrl());
        this.appOrigin = NavigationPolicy.origin(appUrl);
        String local = bridge.getLocalUrl();
        this.localHost = local == null ? null : Uri.parse(local).getHost();
        this.bundled = bridge.getServerUrl() == null ? loadBundle(bridge) : null;
    }

    /** Bundled mode fails closed (the activity refuses to start) without a valid manifest. */
    private static BundledServer loadBundle(Bridge bridge) {
        try (InputStream in = bridge.getContext().getAssets().open("public/route-manifest.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int n; (n = in.read(buffer)) != -1; ) out.write(buffer, 0, n);
            RouteResolver resolver = RouteResolver.fromJson(out.toString(StandardCharsets.UTF_8.name()));
            return new BundledServer(resolver, path -> bridge.getContext().getAssets().open("public/" + path));
        } catch (IOException | JSONException e) {
            throw new IllegalStateException("Bundled mode needs public/route-manifest.json", e);
        }
    }

    private boolean isLocal(Uri url) {
        return appOrigin != null && appOrigin.equals(NavigationPolicy.origin(url.toString()));
    }

    /**
     * Capacitor's local server answers its hostname on any scheme and port (http://localhost too),
     * so in bundled mode every such request that is not the exact app origin is refused.
     */
    private boolean isOtherLocalOrigin(Uri url) {
        String host = url.getHost();
        return localHost != null && host != null && host.equalsIgnoreCase(localHost) && !isLocal(url);
    }

    /** Navigations send Upgrade-Insecure-Requests; isForMainFrame alone misses iframes. */
    private static boolean isDocumentRequest(WebResourceRequest request) {
        if (request.isForMainFrame()) return true;
        Map<String, String> headers = request.getRequestHeaders();
        if (headers == null) return false;
        for (String header : headers.keySet()) {
            if ("Upgrade-Insecure-Requests".equalsIgnoreCase(header)) return true;
        }
        return false;
    }

    private static WebResourceResponse toWebResponse(BundledServer.Response response) {
        return new WebResourceResponse(response.mimeType, response.encoding, response.status, response.reason,
            response.headers, response.body);
    }

    private static WebResourceResponse forbidden() {
        return toWebResponse(BundledServer.empty(403, "Forbidden"));
    }

    /** Device files: never a document, and only image, audio or video, sandboxed (E5). */
    private WebResourceResponse serveNativeFile(WebView view, WebResourceRequest request) {
        if (isDocumentRequest(request)) return forbidden();
        WebResourceResponse response = super.shouldInterceptRequest(view, request);
        if (response == null || !BundledServer.nativeFileTypeAllowed(response.getMimeType())) {
            if (response != null && response.getData() != null) {
                try {
                    response.getData().close();
                } catch (IOException ignored) {
                    // The refusal stands.
                }
            }
            return forbidden();
        }
        response.setResponseHeaders(BundledServer.nativeFileHeaders(response.getResponseHeaders()));
        return response;
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
        PluginHandle handle = bridge.getPlugin("SuiteSecureStore");
        if (handle != null && handle.getInstance() instanceof SuiteSecureStorePlugin) {
            ((SuiteSecureStorePlugin) handle.getInstance()).mainFrameNavigation();
        }
        super.onPageCommitVisible(view, url);
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
        if (bundled != null && isOtherLocalOrigin(request.getUrl())) return forbidden();
        if (bundled != null && isLocal(request.getUrl())) {
            // Capacitor's local server is never reached for the local origin except for device files.
            if (BundledServer.isNativeFilePath(request.getUrl().getPath())) return serveNativeFile(view, request);
            String path = request.getUrl().getEncodedPath();
            return toWebResponse(bundled.serve(request.getMethod(), path == null || path.isEmpty() ? "/" : path));
        }
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String target = url.toString();
        // No frame may navigate to a device file at the local origin (E5).
        if (bundled != null && isOtherLocalOrigin(url)) return true;
        if (bundled != null && isLocal(url) && BundledServer.isNativeFilePath(url.getPath())) return true;
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
