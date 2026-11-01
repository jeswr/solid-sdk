// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import Foundation
import XCTest

/// A thrown error fails the test after the diagnostic attachment is recorded.
private struct FixtureFailure: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

final class FixtureTests: XCTestCase {
    override func setUpWithError() throws {
        try super.setUpWithError()
        continueAfterFailure = false
    }

    // The fixture is ordinary remote content in the real app's WKWebView. Only accessibility
    // is used here: the application has no test-only JavaScript or launch-argument hooks.
    private func readResult(_ app: XCUIApplication, page: String, done: Bool, step: String) throws -> (String, [String: Any]) {
        // WKWebView exposes aria-label as the accessibility label; the HTML id is not an identifier.
        let element = app.webViews.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ OR label == %@", "e2e-result", "e2e-result"))
            .firstMatch
        func foreground() -> Bool {
            // The foreign link queues UIApplication.open. An earlier activate() can finish
            // before Safari opens, so regain the foreground during polling as well.
            let state = app.state
            if state == .runningBackground || state == .runningBackgroundSuspended { app.activate() }
            // A terminated app must reach diagnostics; activate() would relaunch it and hide a crash.
            return state == .runningForeground
        }
        let present = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            foreground() && element.exists
        }, object: element)
        guard XCTWaiter.wait(for: [present], timeout: 30) == .completed else {
            attachDebug(app, page: page, done: done, step: step, reason: "Missing fixture result element")
            throw FixtureFailure(message: "Missing fixture result element")
        }
        // The textarea's accessibility value can be cut short for a long result, while WebKit also
        // exposes the same text as a static-text label, so either source may carry the full JSON.
        let texts = app.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "{\"page\":"))
        var lastValueLength = -1
        func parse(_ text: String?) -> (String, [String: Any])? {
            guard let text, let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  json["page"] as? String == page, json["done"] as? Bool == done else { return nil }
            return (text, json)
        }
        func current() -> (String, [String: Any])? {
            guard foreground(), element.exists else { return nil }
            let value = element.value as? String
            lastValueLength = value?.count ?? -1
            if let result = parse(value) { return result }
            return texts.allElementsBoundByIndex.lazy.compactMap { text in
                text.exists ? parse(text.label) : nil
            }.first
        }
        let ready = NSPredicate { _, _ in current() != nil }
        let expectation = XCTNSPredicateExpectation(predicate: ready, object: element)
        guard XCTWaiter.wait(for: [expectation], timeout: 30) == .completed, let result = current() else {
            // The element may have vanished or its WebContent process may be unreachable. Only
            // cached values belong here: querying value/debugDescription can abort XCTest before
            // the attachment is written (continueAfterFailure is false).
            attachDebug(app, page: page, done: done, step: step,
                        reason: "Fixture did not finish; last observed value length \(lastValueLength)")
            throw FixtureFailure(message: "Fixture did not finish at \(step): page=\(page), done=\(done)")
        }
        return result
    }

    /// Diagnostics only: the host prints e2e-debug attachments on failure and never treats them as evidence.
    private func attachDebug(_ app: XCUIApplication, page: String, done: Bool, step: String, reason: String) {
        let hasWebView = app.webViews.count > 0
        let attachment = XCTAttachment(string: "step=\(step), page=\(page), done=\(done), hasWebView=\(hasWebView), appState=\(app.state)\n\(reason)\n\n\(app.debugDescription)")
        attachment.name = "e2e-debug.txt"
        attachment.lifetime = .keepAlways
        add(attachment)
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
        let (fixture, _) = try readResult(app, page: "index", done: true, step: "initial fixture")
        attach(fixture, name: "e2e-result.json")

        let navigation = app.webViews.links["Test foreign navigation"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 10))
        let foreign = app.webViews.links["Attempt foreign navigation"]
        // The index result can still grow after done=true (late bridge responses), which may move
        // the small link while XCUITest synthesizes the tap, so WebKit drops it. The link is a
        // same-origin navigation to a fixed page, so re-tapping until that page appears is safe.
        for _ in 0..<3 where !foreign.exists {
            if navigation.exists { navigation.tap() }
            _ = foreign.waitForExistence(timeout: 10)
        }
        let (_, before) = try readResult(app, page: "navigation", done: false, step: "before foreign navigation")
        XCTAssertTrue(foreign.waitForExistence(timeout: 10))
        foreign.tap()
        // SuiteNavigationPlugin may open Safari; bring the same application back to observe
        // its bounded refusal window. activate() preserves the existing WebView document.
        app.activate()
        let (_, after) = try readResult(app, page: "navigation", done: true, step: "after foreign navigation")
        XCUIDevice.shared.press(.home)
        app.activate()
        let (_, reactivated) = try readResult(app, page: "navigation", done: true, step: "after reactivation")
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
