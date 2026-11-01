// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class BundledServerTest {

    private static final String MANIFEST = "{\"version\":1,\"assets\":[\"_next/static/a.js\",\"logo.svg\"],"
        + "\"routes\":[{\"segments\":[],\"directory\":\"\",\"files\":[\"index.html\",\"index.txt\"]},"
        + "{\"segments\":[{\"type\":\"static\",\"value\":\"tasks\"},{\"type\":\"param\"}],"
        + "\"directory\":\"tasks/__\",\"files\":[\"index.html\",\"index.txt\"]}]}";

    private final List<String> opened = new ArrayList<>();
    private final Map<String, String> files = new HashMap<>();

    private BundledServer server() throws Exception {
        files.put("index.html", "<html>home</html>");
        files.put("tasks/__/index.html", "<html>tasks</html>");
        files.put("tasks/__/index.txt", "flight");
        files.put("_next/static/a.js", "js");
        files.put("404.html", "<html>missing</html>");
        return new BundledServer(RouteResolver.fromJson(MANIFEST), path -> {
            opened.add(path);
            String body = files.get(path);
            if (body == null) throw new FileNotFoundException(path);
            return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
        });
    }

    private static String read(InputStream in) throws IOException {
        byte[] bytes = new byte[4096];
        int n = in.read(bytes);
        return n <= 0 ? "" : new String(bytes, 0, n, StandardCharsets.UTF_8);
    }

    @Test
    public void servesRoutesWithTheResolvedFilesTypeAndNosniff() throws Exception {
        BundledServer server = server();
        BundledServer.Response page = server.serve("GET", "/tasks/work.2026/");
        assertEquals(200, page.status);
        assertEquals("text/html", page.mimeType);
        assertEquals("utf-8", page.encoding);
        assertEquals("nosniff", page.headers.get("X-Content-Type-Options"));
        assertEquals("<html>tasks</html>", read(page.body));
        BundledServer.Response flight = server.serve("GET", "/tasks/work.2026/index.txt");
        assertEquals("text/plain", flight.mimeType);
        assertEquals("flight", read(flight.body));
        BundledServer.Response script = server.serve("GET", "/_next/static/a.js");
        assertEquals("text/javascript", script.mimeType);
    }

    @Test
    public void servesTheBundled404PageForUnknownOrInvalidPaths() throws Exception {
        BundledServer server = server();
        for (String path : new String[] {"/unknown", "/tasks/a/../b", "/tasks/a%2Fb", "relative"}) {
            BundledServer.Response missing = server.serve("GET", path);
            assertEquals(path, 404, missing.status);
            assertEquals(path, "text/html", missing.mimeType);
            assertEquals(path, "<html>missing</html>", read(missing.body));
        }
    }

    @Test
    public void aManifestEntryWithoutItsFileIsAnEmpty404() throws Exception {
        BundledServer server = server();
        files.remove("index.html");
        files.remove("logo.svg");
        BundledServer.Response missing = server.serve("GET", "/logo.svg");
        assertEquals(404, missing.status);
        assertEquals("", read(missing.body));
    }

    @Test
    public void servesOnlyGetAndHead() throws Exception {
        BundledServer server = server();
        assertEquals(405, server.serve("POST", "/").status);
        assertEquals(405, server.serve(null, "/").status);
        assertTrue(opened.isEmpty());
        BundledServer.Response head = server.serve("HEAD", "/");
        assertEquals(200, head.status);
        assertEquals("text/html", head.mimeType);
        assertEquals("", read(head.body));
    }

    @Test
    public void recognisesCapacitorDeviceFilePrefixesLikeCapacitor() {
        assertTrue(BundledServer.isNativeFilePath("/_capacitor_file_/data/a.png"));
        assertTrue(BundledServer.isNativeFilePath("/_capacitor_content_/media/1"));
        assertTrue(BundledServer.isNativeFilePath("/_capacitor_file_x"));
        assertFalse(BundledServer.isNativeFilePath("/_CAPACITOR_FILE_/a"));
        assertFalse(BundledServer.isNativeFilePath("/docs/_capacitor_file_/a"));
        assertFalse(BundledServer.isNativeFilePath(null));
    }

    @Test
    public void allowsDeviceFilesOnlyAsMedia() {
        assertTrue(BundledServer.nativeFileTypeAllowed("image/png"));
        assertTrue(BundledServer.nativeFileTypeAllowed("Video/MP4; codecs=x"));
        assertTrue(BundledServer.nativeFileTypeAllowed("audio/mpeg"));
        assertFalse(BundledServer.nativeFileTypeAllowed("text/html"));
        assertFalse(BundledServer.nativeFileTypeAllowed("image/svg+xml"));
        assertFalse(BundledServer.nativeFileTypeAllowed("Image/SVG+XML; charset=utf-8"));
        assertFalse(BundledServer.nativeFileTypeAllowed("application/javascript"));
        assertFalse(BundledServer.nativeFileTypeAllowed("application/xhtml+xml"));
        assertFalse(BundledServer.nativeFileTypeAllowed(""));
        assertFalse(BundledServer.nativeFileTypeAllowed(null));
    }

    @Test
    public void sandboxesDeviceFilesOverAnyExistingPolicy() {
        Map<String, String> existing = new HashMap<>();
        existing.put("content-security-policy", "default-src *");
        existing.put("X-CONTENT-TYPE-OPTIONS", "sniff");
        existing.put("Cache-Control", "no-cache");
        Map<String, String> headers = BundledServer.nativeFileHeaders(existing);
        assertEquals("sandbox", headers.get("Content-Security-Policy"));
        assertEquals("nosniff", headers.get("X-Content-Type-Options"));
        assertEquals("no-cache", headers.get("Cache-Control"));
        assertNull(headers.get("content-security-policy"));
        assertNull(headers.get("X-CONTENT-TYPE-OPTIONS"));
        assertEquals(2, BundledServer.nativeFileHeaders(null).size());
    }
}
