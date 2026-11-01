// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Bundled-mode route resolution (MOB-P3 E3): maps a raw, still percent-encoded request path to a
 * file in the static export, using the build-time {@code route-manifest.json}. A port of
 * {@code apps/suite/scripts/route-resolver.mjs}; both run the shared vectors in
 * {@code apps/mobile/test/vectors/routes.json}. The resolver never lists directories and never
 * guesses from a path's shape: a path either matches a whole route (or an exact asset) or is 404.
 */
public final class RouteResolver {

    public static final int MAX_PATH_BYTES = 2048;
    public static final String NOT_FOUND = "404.html";

    private static final Pattern RAW_FORBIDDEN = Pattern.compile("[\\\\\\x00?#]");
    private static final Pattern ENCODED_FORBIDDEN =
        Pattern.compile("%2f|%5c|%00", Pattern.CASE_INSENSITIVE);
    private static final Pattern PREFETCH = Pattern.compile("^__next\\.[^\n\r\u2028\u2029]+\\.txt$");

    private static final int STATIC = 3;
    private static final int PARAM = 2;
    private static final int CATCH_ALL = 1;

    /** One manifest route: its segments, its placeholder directory and its exported files. */
    static final class Route {
        final int[] types;
        final String[] values;
        final boolean[] optional;
        final String directory;
        final Set<String> files;

        Route(int[] types, String[] values, boolean[] optional, String directory, Set<String> files) {
            this.types = types;
            this.values = values;
            this.optional = optional;
            this.directory = directory;
            this.files = files;
        }
    }

    /** The bundle file to serve, its status and the MIME type of the resolved file. */
    public static final class Resolution {
        public final String path;
        public final int status;
        public final String mimeType;

        Resolution(String path, int status) {
            this.path = path;
            this.status = status;
            this.mimeType = mimeType(path);
        }
    }

    private final List<Route> routes;
    private final Set<String> assets;

    RouteResolver(List<Route> routes, Set<String> assets) {
        this.routes = Collections.unmodifiableList(new ArrayList<>(routes));
        this.assets = Collections.unmodifiableSet(new HashSet<>(assets));
    }

    /** Parse {@code route-manifest.json}; any shape error rejects the whole manifest. */
    public static RouteResolver fromJson(String json) throws JSONException {
        JSONObject manifest = new JSONObject(json);
        if (manifest.getInt("version") != 1) throw new JSONException("Unsupported route manifest version");
        JSONArray routeArray = manifest.getJSONArray("routes");
        List<Route> routes = new ArrayList<>(routeArray.length());
        for (int i = 0; i < routeArray.length(); i++) {
            JSONObject route = routeArray.getJSONObject(i);
            JSONArray segments = route.getJSONArray("segments");
            int[] types = new int[segments.length()];
            String[] values = new String[segments.length()];
            boolean[] optional = new boolean[segments.length()];
            for (int j = 0; j < segments.length(); j++) {
                JSONObject segment = segments.getJSONObject(j);
                String type = segment.getString("type");
                switch (type) {
                    case "static":
                        types[j] = STATIC;
                        values[j] = segment.getString("value");
                        break;
                    case "param":
                        types[j] = PARAM;
                        break;
                    case "catch-all":
                        types[j] = CATCH_ALL;
                        optional[j] = segment.optBoolean("optional", false);
                        break;
                    default:
                        throw new JSONException("Unknown route segment type");
                }
            }
            JSONArray fileArray = route.getJSONArray("files");
            Set<String> files = new HashSet<>();
            for (int j = 0; j < fileArray.length(); j++) files.add(fileArray.getString(j));
            routes.add(new Route(types, values, optional, route.getString("directory"), files));
        }
        JSONArray assetArray = manifest.getJSONArray("assets");
        Set<String> assets = new HashSet<>();
        for (int i = 0; i < assetArray.length(); i++) assets.add(assetArray.getString(i));
        return new RouteResolver(routes, assets);
    }

    /** Resolve a raw encoded path (as from {@code Uri.getEncodedPath()}); never throws. */
    public Resolution resolve(String encodedPath) {
        List<String> values = requestSegments(encodedPath);
        if (values == null) return notFound();
        String exact = String.join("/", values);
        if (assets.contains(exact)) return new Resolution(exact, 200);
        String last = values.isEmpty() ? "" : values.get(values.size() - 1);
        boolean transport = reservedSuffix(last);
        List<String> routeValues = transport ? values.subList(0, values.size() - 1) : values;
        String file = transport ? last : "index.html";
        Route best = null;
        int[] bestRank = null;
        for (Route route : routes) {
            if (!route.files.contains(file)) continue;
            int[] rank = matchRoute(route, routeValues);
            if (rank == null) continue;
            if (best == null || compareRank(rank, bestRank) > 0) {
                best = route;
                bestRank = rank;
            }
        }
        if (best == null) return notFound();
        return new Resolution(best.directory.isEmpty() ? file : best.directory + "/" + file, 200);
    }

    static Resolution notFound() {
        return new Resolution(NOT_FOUND, 404);
    }

    /** Exported transport file names: never a route parameter (E3). */
    static boolean reservedSuffix(String name) {
        return name.equals("index.html") || name.equals("index.txt") || PREFETCH.matcher(name).matches();
    }

    /** The per-segment precedence rank of a complete match, or {@code null} for no match. */
    static int[] matchRoute(Route route, List<String> values) {
        int index = 0;
        List<Integer> rank = new ArrayList<>();
        for (int i = 0; i < route.types.length; i++) {
            int type = route.types[i];
            if (type == CATCH_ALL) {
                if (index == values.size() && !route.optional[i]) return null;
                while (index < values.size()) {
                    rank.add(CATCH_ALL);
                    index++;
                }
            } else {
                if (index == values.size()) return null;
                if (type == STATIC && !route.values[i].equals(values.get(index))) return null;
                rank.add(type);
                index++;
            }
        }
        if (index != values.size()) return null;
        int[] out = new int[rank.size()];
        for (int i = 0; i < out.length; i++) out[i] = rank.get(i);
        return out;
    }

    /** Static beats param beats catch-all at the earliest differing segment. */
    static int compareRank(int[] left, int[] right) {
        for (int i = 0; i < Math.max(left.length, right.length); i++) {
            int l = i < left.length ? left[i] : STATIC;
            int r = i < right.length ? right[i] : STATIC;
            if (l != r) return l - r;
        }
        return 0;
    }

    /**
     * Validate the raw path before decoding each segment exactly once. Rejects (returns
     * {@code null}) relative paths, paths over 2,048 UTF-8 bytes, backslashes, NUL, query or
     * fragment characters, encoded slash/backslash/NUL, malformed percent escapes or UTF-8, and
     * empty, {@code .} or {@code ..} segments. A trailing slash is dropped.
     */
    static List<String> requestSegments(String path) {
        if (path == null || !path.startsWith("/")) return null;
        if (path.getBytes(StandardCharsets.UTF_8).length > MAX_PATH_BYTES) return null;
        if (RAW_FORBIDDEN.matcher(path).find() || ENCODED_FORBIDDEN.matcher(path).find()) return null;
        String[] parts = path.substring(1).split("/", -1);
        int count = parts.length;
        if (count > 0 && parts[count - 1].isEmpty()) count--;
        List<String> decoded = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            String part = decodeSegment(parts[i]);
            if (part == null || part.isEmpty() || part.equals(".") || part.equals("..")
                || part.indexOf('\\') >= 0 || part.indexOf('/') >= 0 || part.indexOf('\0') >= 0) {
                return null;
            }
            decoded.add(part);
        }
        return decoded;
    }

    /** decodeURIComponent semantics: strict escapes and strict UTF-8; '+' stays '+'. */
    static String decodeSegment(String segment) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(segment.length());
        byte[] raw = segment.getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < raw.length; i++) {
            byte b = raw[i];
            if (b != '%') {
                bytes.write(b);
                continue;
            }
            if (i + 2 >= raw.length) return null;
            int high = Character.digit(raw[i + 1], 16);
            int low = Character.digit(raw[i + 2], 16);
            if (high < 0 || low < 0) return null;
            bytes.write((high << 4) | low);
            i += 2;
        }
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            return decoder.decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    private static final Map<String, String> MIME_TYPES = new HashMap<>();

    static {
        MIME_TYPES.put("html", "text/html");
        // Next's static-export client accepts text/plain as Flight data.
        MIME_TYPES.put("txt", "text/plain");
        MIME_TYPES.put("js", "text/javascript");
        MIME_TYPES.put("mjs", "text/javascript");
        MIME_TYPES.put("css", "text/css");
        MIME_TYPES.put("json", "application/json");
        MIME_TYPES.put("map", "application/json");
        MIME_TYPES.put("webmanifest", "application/manifest+json");
        MIME_TYPES.put("wasm", "application/wasm");
        MIME_TYPES.put("svg", "image/svg+xml");
        MIME_TYPES.put("png", "image/png");
        MIME_TYPES.put("jpg", "image/jpeg");
        MIME_TYPES.put("jpeg", "image/jpeg");
        MIME_TYPES.put("gif", "image/gif");
        MIME_TYPES.put("webp", "image/webp");
        MIME_TYPES.put("avif", "image/avif");
        MIME_TYPES.put("ico", "image/x-icon");
        MIME_TYPES.put("woff", "font/woff");
        MIME_TYPES.put("woff2", "font/woff2");
        MIME_TYPES.put("ttf", "font/ttf");
        MIME_TYPES.put("otf", "font/otf");
    }

    /** The MIME type of a resolved bundle file, from its own extension (never the request's). */
    public static String mimeType(String path) {
        int slash = path.lastIndexOf('/');
        int dot = path.lastIndexOf('.');
        if (dot <= slash + 1) return "application/octet-stream";
        String type = MIME_TYPES.get(path.substring(dot + 1).toLowerCase(Locale.ROOT));
        return type == null ? "application/octet-stream" : type;
    }

    /** Text types are served as UTF-8; binary types carry no charset. */
    public static String encoding(String mimeType) {
        return mimeType.startsWith("text/") || mimeType.equals("application/json")
            || mimeType.equals("application/manifest+json") || mimeType.equals("image/svg+xml")
            ? "utf-8" : null;
    }
}
