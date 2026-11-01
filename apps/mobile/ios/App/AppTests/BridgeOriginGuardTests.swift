// AUTHORED-BY GPT-5.6 Codex
import Foundation
import XCTest
@testable import App

final class BridgeOriginGuardTests: XCTestCase {
    func testOnlyTheMainFrameOnTheExactOriginGetsNativeChannels() throws {
        let allowed = try XCTUnwrap(SuiteOrigin(url: URL(string: "https://suite.example")))
        let matching = try XCTUnwrap(SuiteOrigin(url: URL(string: "https://SUITE.example:443/drive")))
        XCTAssertTrue(BridgeOriginGuard.allows(isMainFrame: true, origin: matching, allowed: allowed))
        XCTAssertFalse(BridgeOriginGuard.allows(isMainFrame: false, origin: matching, allowed: allowed))
        for raw in [
            "http://suite.example/", "https://suite.example:8443/", "https://evil.suite.example/",
            "https://suite.example.evil/", "https://evil.example/", "capacitor://localhost/offline.html",
            "file:///tmp/offline.html", "data:text/html,hi", "about:blank"
        ] {
            let origin = SuiteOrigin(url: try XCTUnwrap(URL(string: raw)))
            for mainFrame in [true, false] {
                XCTAssertFalse(BridgeOriginGuard.allows(isMainFrame: mainFrame, origin: origin, allowed: allowed), raw)
            }
        }
        XCTAssertFalse(BridgeOriginGuard.allows(isMainFrame: true, origin: nil, allowed: allowed))
        XCTAssertFalse(BridgeOriginGuard.allows(isMainFrame: false, origin: nil, allowed: allowed))
    }

    func testShareAcceptsOnlyHTTPSURLsAndCommittedFiles() throws {
        let staged = try XCTUnwrap(URL(string: "file:///tmp/share-out/x/a.txt"))
        let committed: (URL) -> URL? = { $0 == staged ? staged : nil }
        XCTAssertEqual(SuiteSharePlugin.items(text: "hi", url: "https://pod.example/a", files: [staged.absoluteString],
                                              committed: committed)?.count, 3)
        for url in ["http://pod.example/a", "https://u:p@pod.example/a", "file:///etc/passwd", "javascript:x", "https:///a"] {
            XCTAssertNil(SuiteSharePlugin.items(text: nil, url: url, files: nil, committed: committed), url)
        }
        for files in [["file:///private/var/mobile/secret"], [1], "file:///tmp/share-out/x/a.txt",
                      Array(repeating: staged.absoluteString, count: 21)] as [Any] {
            XCTAssertNil(SuiteSharePlugin.items(text: nil, url: nil, files: files, committed: committed))
        }
        XCTAssertNil(SuiteSharePlugin.items(text: String(repeating: "x", count: 10_001), url: nil, files: nil, committed: committed))
        XCTAssertNil(SuiteSharePlugin.items(text: nil, url: nil, files: nil, committed: committed))
    }

    func testOnlyRegisteredPluginNamesReachCapacitor() {
        let registered: (String) -> Bool = { $0 == "SuiteAuthSession" }
        let call: [String: Any] = ["type": "message", "pluginId": "SuiteAuthSession", "methodName": "cancel"]
        XCTAssertTrue(BridgeOriginGuard.admits(body: call, isRegistered: registered))
        let refused: [[String: Any]] = [
            ["type": "message", "pluginId": "SuiteAuthSessionPlugin", "methodName": "cancel"],
            ["type": "message", "pluginId": "SharePlugin", "methodName": "share"],
            ["type": "message", "methodName": "cancel"],
            ["type": "cordova", "service": "SuiteAuthSession", "action": "cancel"]
        ]
        for body in refused {
            XCTAssertFalse(BridgeOriginGuard.admits(body: body, isRegistered: registered))
        }
        let jsError: [String: Any] = ["type": "js.error", "error": [String: Any]()]
        XCTAssertTrue(BridgeOriginGuard.admits(body: jsError, isRegistered: registered))
    }
}
