// AUTHORED-BY Claude Opus 5.5
import Foundation
import WebKit
import XCTest
@testable import App

private final class RecordingHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {}
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class SuiteSchemeHandlerTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            .appendingPathComponent("public")
        for (path, body) in [
            "index.html": "<html>home</html>",
            "tasks/__/index.html": "<html>tasks</html>",
            "tasks/__/index.txt": "flight",
            "_next/static/a.js": "js",
            "404.html": "<html>missing</html>",
        ] {
            let file = root.appendingPathComponent(path)
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(body.utf8).write(to: file)
        }
        try Data("secret".utf8).write(to: root.deletingLastPathComponent().appendingPathComponent("outside.txt"))
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root.deletingLastPathComponent())
    }

    private func handler(assets: [String] = ["_next/static/a.js", "logo.svg", "../outside.txt"]) throws -> SuiteSchemeHandler {
        let manifest: [String: Any] = [
            "version": 1,
            "assets": assets,
            "routes": [
                ["segments": [], "directory": "", "files": ["index.html", "index.txt"]],
                ["segments": [["type": "static", "value": "tasks"], ["type": "param"]],
                 "directory": "tasks/__", "files": ["index.html", "index.txt"]],
            ],
        ]
        let resolver = try RouteResolver(manifest: JSONSerialization.data(withJSONObject: manifest))
        return SuiteSchemeHandler(capacitor: RecordingHandler(), resolver: resolver, root: root)
    }

    func testServesRoutesWithTheResolvedFilesTypeAndNosniff() throws {
        let handler = try handler()
        let page = handler.respond(method: "GET", encodedPath: "/tasks/work.2026/")
        XCTAssertEqual(page.status, 200)
        XCTAssertEqual(page.headers["Content-Type"], "text/html; charset=utf-8")
        XCTAssertEqual(page.headers["X-Content-Type-Options"], "nosniff")
        XCTAssertEqual(String(decoding: page.body, as: UTF8.self), "<html>tasks</html>")
        XCTAssertEqual(page.headers["Content-Length"], String(page.body.count))
        let flight = handler.respond(method: "GET", encodedPath: "/tasks/work.2026/index.txt")
        XCTAssertEqual(flight.headers["Content-Type"], "text/plain; charset=utf-8")
        XCTAssertEqual(handler.respond(method: "GET", encodedPath: "/_next/static/a.js").headers["Content-Type"],
                       "text/javascript; charset=utf-8")
        XCTAssertEqual(String(decoding: handler.respond(method: "GET", encodedPath: "").body, as: UTF8.self),
                       "<html>home</html>")
    }

    func testServesTheBundled404PageForUnknownOrInvalidPaths() throws {
        let handler = try handler()
        for path in ["/unknown", "/tasks/a/../b", "/tasks/a%2Fb", "relative"] {
            let missing = handler.respond(method: "GET", encodedPath: path)
            XCTAssertEqual(missing.status, 404, path)
            XCTAssertEqual(String(decoding: missing.body, as: UTF8.self), "<html>missing</html>", path)
        }
    }

    func testNeverReadsOutsideTheBundleOrAMissingFile() throws {
        // "../outside.txt" cannot even be requested (dot segments are rejected) and would escape the root.
        let handler = try handler()
        XCTAssertEqual(handler.respond(method: "GET", encodedPath: "/../outside.txt").body,
                       Data("<html>missing</html>".utf8))
        let missing = handler.respond(method: "GET", encodedPath: "/logo.svg")
        XCTAssertEqual(missing.status, 404)
        XCTAssertEqual(missing.body, Data())
    }

    func testServesOnlyGetAndHead() throws {
        let handler = try handler()
        XCTAssertEqual(handler.respond(method: "POST", encodedPath: "/").status, 405)
        let head = handler.respond(method: "HEAD", encodedPath: "/")
        XCTAssertEqual(head.status, 200)
        XCTAssertEqual(head.body, Data())
        XCTAssertEqual(head.headers["Content-Type"], "text/html; charset=utf-8")
    }

    func testRecognisesCapacitorDeviceFilePrefixes() throws {
        XCTAssertTrue(SuiteSchemeHandler.isNativeFilePath("/_capacitor_file_/var/a.png"))
        XCTAssertTrue(SuiteSchemeHandler.isNativeFilePath("/_capacitor_content_/x"))
        XCTAssertFalse(SuiteSchemeHandler.isNativeFilePath("/docs/_capacitor_file_/a"))
        XCTAssertFalse(SuiteSchemeHandler.isNativeFilePath("/_CAPACITOR_FILE_/a"))
        let local = URL(string: "capacitor://localhost")
        XCTAssertTrue(SuiteNavigationPlugin.isLocalDeviceFile(
            try XCTUnwrap(URL(string: "capacitor://localhost/_capacitor_file_/var/a.html")), local: local))
        XCTAssertTrue(SuiteNavigationPlugin.isLocalDeviceFile(
            try XCTUnwrap(URL(string: "CAPACITOR://LOCALHOST/%5Fcapacitor_file_/a.svg")), local: local))
        XCTAssertFalse(SuiteNavigationPlugin.isLocalDeviceFile(
            try XCTUnwrap(URL(string: "https://evil.example/_capacitor_file_/a")), local: local))
        XCTAssertFalse(SuiteNavigationPlugin.isLocalDeviceFile(
            try XCTUnwrap(URL(string: "capacitor://localhost/docs/")), local: local))
        XCTAssertFalse(SuiteNavigationPlugin.isLocalDeviceFile(
            try XCTUnwrap(URL(string: "capacitor://localhost/_capacitor_file_/a")), local: nil))
    }

    func testTheConfigurationWrapsOnlyTheLocalSchemeHandler() throws {
        let config = SuiteBundledWebViewConfiguration()
        let wrapped = try handler()
        config.wrapLocalHandler = { _ in wrapped }
        let capacitor = RecordingHandler()
        config.setURLSchemeHandler(capacitor, forURLScheme: "capacitor")
        XCTAssertTrue(config.urlSchemeHandler(forURLScheme: "capacitor") === wrapped)
        let other = RecordingHandler()
        config.setURLSchemeHandler(other, forURLScheme: "suite-test")
        XCTAssertTrue(config.urlSchemeHandler(forURLScheme: "suite-test") === other)
        // The wrapped configuration survives WKWebView's own copy of it.
        let webView = WKWebView(frame: .zero, configuration: config)
        XCTAssertTrue(webView.configuration.urlSchemeHandler(forURLScheme: "capacitor") === wrapped)
    }

    func testAdoptingKeepsCapacitorsConfiguration() {
        let base = WKWebViewConfiguration()
        base.allowsInlineMediaPlayback = true
        base.suppressesIncrementalRendering = true
        base.allowsAirPlayForMediaPlayback = false
        base.mediaTypesRequiringUserActionForPlayback = []
        base.limitsNavigationsToAppBoundDomains = false
        base.applicationNameForUserAgent = "Suite Test"
        let adopted = SuiteBundledWebViewConfiguration.adopting(base)
        XCTAssertTrue(adopted.processPool === base.processPool)
        XCTAssertTrue(adopted.websiteDataStore === base.websiteDataStore)
        XCTAssertTrue(adopted.preferences === base.preferences)
        XCTAssertTrue(adopted.userContentController === base.userContentController)
        XCTAssertTrue(adopted.allowsInlineMediaPlayback)
        XCTAssertTrue(adopted.suppressesIncrementalRendering)
        XCTAssertFalse(adopted.allowsAirPlayForMediaPlayback)
        XCTAssertEqual(adopted.mediaTypesRequiringUserActionForPlayback, [])
        XCTAssertFalse(adopted.limitsNavigationsToAppBoundDomains)
        XCTAssertEqual(adopted.applicationNameForUserAgent, "Suite Test")
    }
}
