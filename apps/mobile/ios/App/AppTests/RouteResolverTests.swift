// AUTHORED-BY Claude Opus 5.5
import Foundation
import XCTest
@testable import App

final class RouteResolverTests: XCTestCase {
    /// The simulator can read the host checkout, so the tests use the shared vectors in place.
    private func loadVectors(file: StaticString = #filePath) throws -> [String: Any] {
        let url = URL(fileURLWithPath: "\(file)")
            .deletingLastPathComponent() // AppTests
            .deletingLastPathComponent() // App
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // apps/mobile
            .appendingPathComponent("test/vectors/routes.json")
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func makeResolver() throws -> RouteResolver {
        let manifest = try XCTUnwrap(loadVectors()["manifest"])
        return try RouteResolver(manifest: JSONSerialization.data(withJSONObject: manifest))
    }

    func testAgreesWithTheSharedVectors() throws {
        let vectors = try loadVectors()
        let resolver = try RouteResolver(
            manifest: JSONSerialization.data(withJSONObject: try XCTUnwrap(vectors["manifest"])))
        let cases = try XCTUnwrap(vectors["cases"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 40)
        for item in cases {
            let request = try XCTUnwrap(item["request"] as? String)
            let path = try XCTUnwrap(item["path"] as? String)
            let status = try XCTUnwrap(item["status"] as? Int)
            let result = resolver.resolve(request)
            XCTAssertEqual(result.path, path, request)
            XCTAssertEqual(result.status, status, request)
            XCTAssertEqual(result.mimeType, RouteResolver.mimeType(path), request)
        }
    }

    func testServesTheResolvedFilesTypeNotTheRequestedOne() throws {
        let resolver = try makeResolver()
        let dotted = resolver.resolve("/tasks/l/work.2026")
        XCTAssertEqual(dotted.path, "tasks/l/__/index.html")
        XCTAssertEqual(dotted.mimeType, "text/html")
        XCTAssertEqual(resolver.resolve("/tasks/l/work.2026/index.txt").mimeType, "text/plain")
        XCTAssertEqual(resolver.resolve("/nothing.js").mimeType, "text/html")
    }

    func testMapsExtensionsCaseInsensitivelyAndDefaultsToOctetStream() {
        XCTAssertEqual(RouteResolver.mimeType("_next/static/a.JS"), "text/javascript")
        XCTAssertEqual(RouteResolver.mimeType("logo.svg"), "image/svg+xml")
        XCTAssertEqual(RouteResolver.mimeType("_next/static/media/a.woff2"), "font/woff2")
        XCTAssertEqual(RouteResolver.mimeType("_next/static/README"), "application/octet-stream")
        XCTAssertEqual(RouteResolver.mimeType("dir.d/file"), "application/octet-stream")
        XCTAssertEqual(RouteResolver.mimeType(".hidden"), "application/octet-stream")
        XCTAssertEqual(RouteResolver.mimeType("a.unknown"), "application/octet-stream")
    }

    func testDecodesSegmentsLikeDecodeURIComponent() {
        XCTAssertEqual(RouteResolver.decodeSegment("a+b%20c"), "a+b c")
        XCTAssertEqual(RouteResolver.decodeSegment("Caf%C3%A9"), "Café")
        XCTAssertEqual(RouteResolver.decodeSegment("Café"), "Café")
        XCTAssertNil(RouteResolver.decodeSegment("%"))
        XCTAssertNil(RouteResolver.decodeSegment("%4"))
        XCTAssertNil(RouteResolver.decodeSegment("%zz"))
        XCTAssertNil(RouteResolver.decodeSegment("%C0%AF"), "overlong encoding")
        XCTAssertNil(RouteResolver.decodeSegment("%ED%A0%80"), "lone surrogate")
    }

    func testComparesCodeUnitsNotCanonicalEquivalence() throws {
        // "é" precomposed (NFC) in the manifest; the request spells it decomposed (NFD).
        let manifest: [String: Any] = [
            "version": 1,
            "assets": ["caf\u{e9}.png"],
            "routes": [["segments": [["type": "static", "value": "caf\u{e9}"]], "directory": "cafe", "files": ["index.html"]]],
        ]
        let resolver = try RouteResolver(manifest: JSONSerialization.data(withJSONObject: manifest))
        XCTAssertEqual(resolver.resolve("/caf%C3%A9").status, 200)
        XCTAssertEqual(resolver.resolve("/cafe%CC%81").status, 404)
        XCTAssertEqual(resolver.resolve("/caf%C3%A9.png").status, 200)
        XCTAssertEqual(resolver.resolve("/cafe%CC%81.png").status, 404)
        XCTAssertTrue(RouteResolver.reservedSuffix("__next.\u{301}.txt"))
        XCTAssertTrue(RouteResolver.reservedSuffix("__next.\u{85}.txt"))
        XCTAssertFalse(RouteResolver.reservedSuffix("__next.\n.txt"))
        XCTAssertFalse(RouteResolver.reservedSuffix("__next.\u{2028}.txt"))
        XCTAssertFalse(RouteResolver.reservedSuffix("__next..txt"))
    }

    func testRejectsMalformedManifests() {
        for json in [
            "{}",
            #"{"version":2,"routes":[],"assets":[]}"#,
            #"{"version":1,"assets":[],"routes":[{"segments":[{"type":"glob"}],"directory":"","files":[]}]}"#,
            #"{"version":1,"assets":[],"routes":[{"segments":[{"type":"static"}],"directory":"","files":[]}]}"#,
        ] {
            XCTAssertThrowsError(try RouteResolver(manifest: Data(json.utf8)), json)
        }
    }
}
