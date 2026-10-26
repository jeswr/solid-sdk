// AUTHORED-BY GPT-5.6 Codex
import Foundation
import XCTest

final class FixtureTests: XCTestCase {
    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
    }

    // The fixture is ordinary remote content in the real app's WKWebView. Only accessibility
    // is used here: the application has no test-only JavaScript or launch-argument hooks.
    private func readResult(_ app: XCUIApplication, page: String, done: Bool) throws -> (String, [String: Any]) {
        let element = app.webViews.descendants(matching: .any).matching(identifier: "e2e-result").firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing fixture result element")
        let ready = NSPredicate { _, _ in
            guard element.exists, let text = element.value as? String,
                  let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return json["page"] as? String == page && json["done"] as? Bool == done
        }
        let expectation = XCTNSPredicateExpectation(predicate: ready, object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 30), .completed,
                       "Fixture did not finish: \(element.debugDescription)")
        let text = try XCTUnwrap(element.value as? String)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        return (text, json)
    }

    private func attach(_ text: String, name: String) {
        let attachment = XCTAttachment(data: Data(text.utf8), uniformTypeIdentifier: "public.json")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testFixtureAndForeignNavigation() throws {
        let app = XCUIApplication(bundleIdentifier: "org.jeswr.suite")
        app.launch()
        defer { app.terminate() }
        let (fixture, _) = try readResult(app, page: "index", done: true)
        attach(fixture, name: "e2e-result.json")

        let navigation = app.webViews.links["Test foreign navigation"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 10))
        navigation.tap()
        let (_, before) = try readResult(app, page: "navigation", done: false)
        let foreign = app.webViews.links["Attempt foreign navigation"]
        XCTAssertTrue(foreign.waitForExistence(timeout: 10))
        foreign.tap()
        // SuiteNavigationPlugin may open Safari; bring the same application back to observe
        // its bounded refusal window. activate() preserves the existing WebView document.
        app.activate()
        let (_, after) = try readResult(app, page: "navigation", done: true)
        XCUIDevice.shared.press(.home)
        app.activate()
        let (_, reactivated) = try readResult(app, page: "navigation", done: true)
        let evidence: [String: Any] = ["before": before, "after": after, "reactivated": reactivated]
        let data = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
        attach(try XCTUnwrap(String(data: data, encoding: .utf8)), name: "e2e-navigation.json")
        XCTAssertEqual(after["documentId"] as? String, before["documentId"] as? String)
        XCTAssertEqual(reactivated["documentId"] as? String, before["documentId"] as? String)
        XCTAssertEqual(after["origin"] as? String, before["origin"] as? String)
        XCTAssertEqual(reactivated["href"] as? String, before["href"] as? String)
        // The host applies all platform-specific checks.ts verdicts to both attachments.
    }
}
