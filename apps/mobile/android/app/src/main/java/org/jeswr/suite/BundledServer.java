// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves the bundled export at the app's local origin (MOB-P3 E4, E5). Pure Java over an
 * {@link Assets} opener, so plain JVM tests cover it; {@link SuiteWebViewClient} turns a
 * {@link Response} into a WebResourceResponse.
 */
public final class BundledServer {

    /** Opens a file under the bundle's {@code public/} directory. */
    public interface Assets {
        InputStream open(String path) throws IOException;
    }

    /** A plain response: status, reason, MIME type (of the resolved file), charset, headers, body. */
    public static final class Response {
        public final int status;
        public final String reason;
        public final String mimeType;
        public final String encoding;
        public final Map<String, String> headers;
        public final InputStream body;

        Response(int status, String reason, String mimeType, String encoding, Map<String, String> headers, InputStream body) {
            this.status = status;
            this.reason = reason;
            this.mimeType = mimeType;
            this.encoding = encoding;
            this.headers = headers;
            this.body = body;
        }
    }

    public static final String NATIVE_FILE_PREFIX = "/_capacitor_file_";
    public static final String NATIVE_CONTENT_PREFIX = "/_capacitor_content_";

    private final RouteResolver resolver;
    private final Assets assets;

    public BundledServer(RouteResolver resolver, Assets assets) {
        this.resolver = resolver;
        this.assets = assets;
    }

    /**
     * Serve a request for the local origin from the bundle. {@code encodedPath} is the raw path
     * ({@code Uri.getEncodedPath()}); the resolver validates and decodes it. Only GET and HEAD are
     * served; a missing bundle file is a 404 with the bundle's own 404 page when it exists.
     */
    public Response serve(String method, String encodedPath) {
        boolean head = "HEAD".equals(method);
        if (!"GET".equals(method) && !head) return empty(405, "Method Not Allowed");
        RouteResolver.Resolution resolution = resolver.resolve(encodedPath);
        InputStream body;
        try {
            body = assets.open(resolution.path);
        } catch (IOException e) {
            // A manifest entry whose file is missing is a 404, never a fall-through to the network.
            return empty(404, "Not Found");
        }
        if (head) {
            closeQuietly(body);
            body = new ByteArrayInputStream(new byte[0]);
        }
        return new Response(
            resolution.status,
            resolution.status == 200 ? "OK" : "Not Found",
            resolution.mimeType,
            RouteResolver.encoding(resolution.mimeType),
            bundleHeaders(),
            body
        );
    }

    /**
     * True when Capacitor would treat {@code decodedPath} ({@code Uri.getPath()}) as a device file
     * (Capacitor matches the decoded path with startsWith, so this does too).
     */
    public static boolean isNativeFilePath(String decodedPath) {
        return decodedPath != null
            && (decodedPath.startsWith(NATIVE_FILE_PREFIX) || decodedPath.startsWith(NATIVE_CONTENT_PREFIX));
    }

    /**
     * Device files are served only as images, audio or video (E5); everything else is refused.
     * SVG is a document format that can carry script, so it is refused too.
     */
    public static boolean nativeFileTypeAllowed(String mimeType) {
        if (mimeType == null) return false;
        String type = mimeType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (type.equals("image/svg+xml")) return false;
        return type.startsWith("image/") || type.startsWith("audio/") || type.startsWith("video/");
    }

    /** Headers added to a served device file: no script runs in it, and no MIME sniffing. */
    public static Map<String, String> nativeFileHeaders(Map<String, String> existing) {
        Map<String, String> headers = new HashMap<>();
        if (existing != null) {
            for (Map.Entry<String, String> entry : existing.entrySet()) {
                String name = entry.getKey() == null ? "" : entry.getKey().toLowerCase(Locale.ROOT);
                if (name.equals("content-security-policy") || name.equals("x-content-type-options")) continue;
                headers.put(entry.getKey(), entry.getValue());
            }
        }
        headers.put("Content-Security-Policy", "sandbox");
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }

    /** An empty response with {@code nosniff}. */
    public static Response empty(int status, String reason) {
        return new Response(status, reason, "text/plain", "utf-8", bundleHeaders(), new ByteArrayInputStream(new byte[0]));
    }

    private static Map<String, String> bundleHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        return Collections.unmodifiableMap(headers);
    }

    private static void closeQuietly(InputStream stream) {
        try {
            stream.close();
        } catch (IOException ignored) {
            // Nothing to recover.
        }
    }
}
