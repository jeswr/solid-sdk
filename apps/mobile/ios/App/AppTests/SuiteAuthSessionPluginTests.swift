// AUTHORED-BY GPT-5.6 Codex
import Foundation
import XCTest
@testable import App

final class SuiteAuthSessionPluginTests: XCTestCase {
    func testAcceptsOnlyHTTPSAuthorizationURLsWithoutCredentials() throws {
        XCTAssertTrue(SuiteAuthSessionPlugin.isAuthorizationURL(
            try XCTUnwrap(URL(string: "https://idp.example/authorize?x=1"))))
        for raw in [
            "http://idp.example/authorize", "https://u:p@idp.example/authorize",
            "https://u@idp.example/authorize", "https://:p@idp.example/authorize",
            "javascript:alert(1)", "file:///authorize", "org.jeswr.suite:/oauth/callback",
            "https:/authorize", "relative/path", "http://10.0.2.2:3000/authorize",
            "http://localhost.evil:3000/authorize", "http://[::1]:3000/authorize"
        ] {
            XCTAssertFalse(SuiteAuthSessionPlugin.isAuthorizationURL(try XCTUnwrap(URL(string: raw))), raw)
        }
    }

    // CI runs both configurations so this checks the compiled release policy, too.
    func testLoopbackHTTPIsDebugOnly() throws {
        for raw in ["http://localhost:3000/.oidc/auth", "http://127.0.0.1:3000/.oidc/auth"] {
            let url = try XCTUnwrap(URL(string: raw))
            #if DEBUG
            XCTAssertTrue(SuiteAuthSessionPlugin.isAuthorizationURL(url), raw)
            #else
            XCTAssertFalse(SuiteAuthSessionPlugin.isAuthorizationURL(url), raw)
            #endif
        }
        XCTAssertFalse(SuiteAuthSessionPlugin.isAuthorizationURL(
            try XCTUnwrap(URL(string: "http://user:password@localhost:3000/authorize"))))
    }

    func testAcceptsTheExactCallbackWithAnEmptyAuthority() throws {
        for raw in [
            "org.jeswr.suite:/oauth/callback?code=c&state=s",
            "org.jeswr.suite:///oauth/callback?code=c",
            "org.jeswr.suite:/oauth/callback"
        ] {
            XCTAssertTrue(SuiteAuthSessionPlugin.isCallback(try XCTUnwrap(URL(string: raw))), raw)
        }
    }

    func testRejectsHostileCallbackVariants() throws {
        for raw in [
            "org.jeswr.evil:/oauth/callback", "ORG.JESWR.SUITE:/oauth/callback",
            "https://suite.example/oauth/callback", "http://suite.example/oauth/callback",
            "org.jeswr.suite://evil/oauth/callback?code=c",
            "org.jeswr.suite://localhost/oauth/callback",
            "org.jeswr.suite:/oauth/callback/x?code=c", "org.jeswr.suite:/oauth/callback/",
            "org.jeswr.suite:/oauth/callback#code=c", "org.jeswr.suite:/oauth/callback#",
            "org.jeswr.suite:oauth/callback", "org.jeswr.suite:/oauth/Callback",
            "org.jeswr.suite:/oauth/%63allback", "org.jeswr.suite:/oauth%2Fcallback",
            "org.jeswr.suite:/oauth/%2563allback", "org.jeswr.suite:/oauth/./callback",
            "org.jeswr.suite:/oauth/other/../callback", "org.jeswr.suite:/oauth/callback%2fextra",
            "org.jeswr.suite:/oauth/callback%00", "relative/path"
        ] {
            XCTAssertFalse(SuiteAuthSessionPlugin.isCallback(try XCTUnwrap(URL(string: raw))), raw)
        }
    }
}
