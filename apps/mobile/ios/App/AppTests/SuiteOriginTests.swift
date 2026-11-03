// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Claude Opus 5.5
import Foundation
import XCTest
@testable import App

final class SuiteOriginTests: XCTestCase {
    func testOnlyTheExactSuiteOriginMatches() throws {
        let allowed = try XCTUnwrap(SuiteOrigin(url: URL(string: "https://suite.example")))
        for raw in ["https://suite.example/drive", "https://SUITE.example:443/docs?x#y", "HTTPS://SUITE.example:443/"] {
            XCTAssertEqual(SuiteOrigin(url: try XCTUnwrap(URL(string: raw))), allowed, raw)
        }
        for raw in [
            "http://suite.example/drive", "https://suite.example:8443/drive",
            "https://evil.suite.example/", "https://suite.example.evil/",
            "https://user@suite.example/", "https://user:password@suite.example/",
            "https://localhost/offline.html", "data:text/html,hi"
        ] {
            XCTAssertNotEqual(SuiteOrigin(url: try XCTUnwrap(URL(string: raw))), allowed, raw)
        }
    }

    func testNormalisesDefaultPortsAndHostCase() throws {
        let https = try XCTUnwrap(SuiteOrigin(url: URL(string: "https://SUITE.example/path")))
        XCTAssertEqual(https.scheme, "https")
        XCTAssertEqual(https.host, "suite.example")
        XCTAssertEqual(https.port, 443)
        let http = try XCTUnwrap(SuiteOrigin(url: URL(string: "http://localhost")))
        XCTAssertEqual(http.port, 80)
        let explicit = try XCTUnwrap(SuiteOrigin(url: URL(string: "http://127.0.0.1:3210")))
        XCTAssertEqual(explicit.port, 3210)
        XCTAssertNotEqual(explicit, http)
    }

    func testRejectsMissingHostsCredentialsAndNonHTTPOrigins() throws {
        XCTAssertNil(SuiteOrigin(url: nil))
        for raw in [
            "ftp://example.org/", "mailto:a@example.org", "capacitor://localhost",
            "file:///tmp/private", "relative/path", "https:/path",
            "https://user@example.org/", "https://:password@example.org/"
        ] {
            XCTAssertNil(SuiteOrigin(url: try XCTUnwrap(URL(string: raw))), raw)
        }
    }

    func testOpensOnlySafeSchemesExternally() throws {
        for raw in ["https://example.org/", "http://example.org/", "mailto:a@example.org", "tel:+441234"] {
            XCTAssertTrue(SuiteOrigin.mayOpenExternally(try XCTUnwrap(URL(string: raw))), raw)
        }
        for raw in [
            "intent://scan/", "file:///tmp/private", "content://x/y", "javascript:alert(1)",
            "data:text/html,hi", "capacitor://localhost/offline.html", "relative/path"
        ] {
            XCTAssertFalse(SuiteOrigin.mayOpenExternally(try XCTUnwrap(URL(string: raw))), raw)
        }
    }

    func testBundledModeTrustsOnlyTheLocalCapacitorOrigin() throws {
        let local = try XCTUnwrap(URL(string: "capacitor://localhost"))
        let bundled = try XCTUnwrap(SuiteOrigin.app(serverURL: local, localURL: local))
        XCTAssertEqual(bundled.scheme, "capacitor")
        XCTAssertEqual(bundled.port, 0)
        XCTAssertTrue(SuiteOrigin.isBundled(serverURL: local, localURL: local))
        let remote = try XCTUnwrap(URL(string: "https://suite.example"))
        XCTAssertEqual(SuiteOrigin.app(serverURL: remote, localURL: local), SuiteOrigin(url: remote))
        XCTAssertFalse(SuiteOrigin.isBundled(serverURL: remote, localURL: local))
        // A capacitor server URL that is not Capacitor's own local URL is never trusted.
        XCTAssertNil(SuiteOrigin.app(serverURL: local, localURL: URL(string: "capacitor://other")))
        XCTAssertNil(SuiteOrigin.app(serverURL: URL(string: "capacitor://evil"), localURL: URL(string: "capacitor://evil")))
        XCTAssertNil(SuiteOrigin.app(serverURL: nil, localURL: local))
        XCTAssertEqual(SuiteOrigin.of(URL(string: "capacitor://LOCALHOST/drive/f/YQ/")), bundled)
        for raw in ["capacitor://localhost:8080/", "capacitor://user@localhost/", "capacitor://evil/", "file:///x"] {
            XCTAssertNil(SuiteOrigin.local(URL(string: raw)), raw)
        }
        XCTAssertEqual(SuiteOrigin(securityScheme: "CAPACITOR", host: "localhost", port: 0), bundled)
        XCTAssertNil(SuiteOrigin(securityScheme: "capacitor", host: "evil", port: 0))
        XCTAssertNil(SuiteOrigin(securityScheme: "capacitor", host: "localhost", port: 1))
        XCTAssertNil(SuiteOrigin(securityScheme: "file", host: "", port: 0))
        XCTAssertEqual(SuiteOrigin(securityScheme: "https", host: "Suite.Example", port: 0), SuiteOrigin(url: remote))
        XCTAssertFalse(BridgeOriginGuard.allows(isMainFrame: true, origin: bundled, allowed: try XCTUnwrap(SuiteOrigin(url: remote))))
        XCTAssertTrue(BridgeOriginGuard.allows(isMainFrame: true, origin: bundled, allowed: bundled))
        XCTAssertNotEqual(SecureStoreValidation.namespace(bundled), SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: remote))))
    }
}
