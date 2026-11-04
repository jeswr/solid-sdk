// AUTHORED-BY Claude Opus 5.5
package org.jeswr.suite;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

public class RouteResolverTest {

    /** Gradle runs unit tests from the app module; the vectors live in apps/mobile/test. */
    private static JSONObject vectors() throws Exception {
        File file = new File("../../test/vectors/routes.json");
        if (!file.exists()) file = new File(System.getProperty("vectors", "test/vectors/routes.json"));
        return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
    }

    @Test
    public void agreesWithTheSharedVectors() throws Exception {
        JSONObject vectors = vectors();
        RouteResolver resolver = RouteResolver.fromJson(vectors.getJSONObject("manifest").toString());
        JSONArray cases = vectors.getJSONArray("cases");
        assertTrue(cases.length() > 40);
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            String request = c.getString("request");
            RouteResolver.Resolution result = resolver.resolve(request);
            assertEquals(request, c.getString("path"), result.path);
            assertEquals(request, c.getInt("status"), result.status);
            assertEquals(request, RouteResolver.mimeType(c.getString("path")), result.mimeType);
        }
    }

    @Test
    public void servesTheResolvedFilesTypeNotTheRequestedOne() throws Exception {
        RouteResolver resolver = RouteResolver.fromJson(vectors().getJSONObject("manifest").toString());
        RouteResolver.Resolution dotted = resolver.resolve("/tasks/l/work.2026");
        assertEquals("tasks/l/__/index.html", dotted.path);
        assertEquals("text/html", dotted.mimeType);
        assertEquals("text/plain", resolver.resolve("/tasks/l/work.2026/index.txt").mimeType);
        assertEquals("text/html", resolver.resolve("/nothing.js").mimeType);
        assertEquals(404, resolver.resolve(null).status);
    }

    @Test
    public void mapsExtensionsCaseInsensitivelyAndDefaultsToOctetStream() {
        assertEquals("text/javascript", RouteResolver.mimeType("_next/static/a.JS"));
        assertEquals("image/svg+xml", RouteResolver.mimeType("logo.svg"));
        assertEquals("font/woff2", RouteResolver.mimeType("_next/static/media/a.woff2"));
        assertEquals("application/octet-stream", RouteResolver.mimeType("_next/static/README"));
        assertEquals("application/octet-stream", RouteResolver.mimeType("dir.d/file"));
        assertEquals("application/octet-stream", RouteResolver.mimeType(".hidden"));
        assertEquals("application/octet-stream", RouteResolver.mimeType("a.unknown"));
        assertEquals("utf-8", RouteResolver.encoding("text/html"));
        assertEquals("utf-8", RouteResolver.encoding("image/svg+xml"));
        assertNull(RouteResolver.encoding("image/png"));
    }

    @Test
    public void decodesSegmentsLikeDecodeUriComponent() {
        assertEquals("a+b c", RouteResolver.decodeSegment("a+b%20c"));
        assertEquals("Café", RouteResolver.decodeSegment("Caf%C3%A9"));
        assertEquals("Café", RouteResolver.decodeSegment("Café"));
        assertNull(RouteResolver.decodeSegment("%"));
        assertNull(RouteResolver.decodeSegment("%4"));
        assertNull(RouteResolver.decodeSegment("%zz"));
        assertNull("overlong encoding", RouteResolver.decodeSegment("%C0%AF"));
        assertNull("lone surrogate", RouteResolver.decodeSegment("%ED%A0%80"));
    }

    @Test
    public void rejectsMalformedManifests() {
        assertThrows(JSONException.class, () -> RouteResolver.fromJson("{}"));
        assertThrows(JSONException.class,
            () -> RouteResolver.fromJson("{\"version\":2,\"routes\":[],\"assets\":[]}"));
        assertThrows(JSONException.class, () -> RouteResolver.fromJson(
            "{\"version\":1,\"assets\":[],\"routes\":[{\"segments\":[{\"type\":\"glob\"}],"
                + "\"directory\":\"\",\"files\":[]}]}"));
        assertThrows(JSONException.class, () -> RouteResolver.fromJson(
            "{\"version\":1,\"assets\":[],\"routes\":[{\"segments\":[{\"type\":\"static\"}],"
                + "\"directory\":\"\",\"files\":[]}]}"));
    }
}
