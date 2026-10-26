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
}
