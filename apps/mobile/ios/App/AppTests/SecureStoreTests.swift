// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import Capacitor
import Foundation
import CryptoKit
import LocalAuthentication
import Security
import UIKit
import XCTest
import WebKit
@testable import App

struct FakeSecureStoreInstallation: SecureStoreInstallChecking {
    var error: Error?
    func prepare() throws { if let error = error { throw error } }
}

/// Exercise real WKWebView KVO and delegate delivery, without a server, Keychain or LA prompt.
private final class SecureStoreTestNavigationHandler: WebViewDelegationHandler {
    var started: (() -> Void)?
    var committed: (() -> Void)?
    var finished: (() -> Void)?
    var policyCalls = 0
    var finishes = 0
    var terminations = 0

    override func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        super.webView(webView, didStartProvisionalNavigation: navigation)
        started?()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        committed?()
    }

    override func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                          decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        policyCalls += 1
        super.webView(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
    }

    override func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        super.webView(webView, didFinish: navigation)
        finishes += 1
        finished?()
    }

    override func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        terminations += 1
        super.webViewWebContentProcessDidTerminate(webView)
    }
}

@MainActor
final class SecureStoreNavigationObserverTests: XCTestCase {
    private func load(_ webView: WKWebView, handler: SecureStoreTestNavigationHandler, action: () -> Void) {
        let finished = expectation(description: "Capacitor didFinish still delivered")
        handler.finished = { finished.fulfill() }
        action()
        wait(for: [finished], timeout: 10)
        handler.finished = nil
    }

    func testNavigationAndSameURLReloadCancelWithoutReplacingEitherDelegate() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = directory.appendingPathComponent("first.html")
        let second = directory.appendingPathComponent("second.html")
        for url in [first, second] { try Data("<!doctype html><p>fixture</p>".utf8).write(to: url) }
        let webView = WKWebView(frame: .zero)
        let handler = SecureStoreTestNavigationHandler()
        defer { handler.cleanUp() }
        let allowed = try XCTUnwrap(SuiteOrigin(url: URL(string: "https://suite.example")))
        let uiGuard = UIDelegateOriginGuard(inner: handler, allowed: allowed)
        webView.navigationDelegate = handler
        webView.uiDelegate = uiGuard
        load(webView, handler: handler) { webView.loadFileURL(first, allowingReadAccessTo: directory) }

        let cancellation = SecureStoreCancellation()
        var ticket = cancellation.ticket(key: "a")
        var observer: SecureStoreNavigationObserver? = SecureStoreNavigationObserver(webView: webView) {
            XCTAssertTrue(Thread.isMainThread)
            cancellation.documentChanged()
        }
        XCTAssertTrue(cancellation.isCurrent(ticket), "Installing observations must not cancel reads")
        load(webView, handler: handler) { webView.loadFileURL(second, allowingReadAccessTo: directory) }
        XCTAssertFalse(cancellation.isCurrent(ticket))
        XCTAssertTrue(webView.navigationDelegate === handler)
        XCTAssertTrue(webView.uiDelegate === uiGuard)

        ticket = cancellation.ticket(key: "a")
        let iframeLoaded = expectation(description: "Subframe load completed")
        webView.callAsyncJavaScript("""
            await new Promise(resolve => {
                const frame = document.createElement('iframe');
                frame.onload = resolve;
                frame.srcdoc = '<p>child document</p>';
                document.body.append(frame);
            });
            return true;
            """, arguments: [:], in: nil, in: .page) { result in
            if case .failure(let error) = result { XCTFail("Subframe failed: \(error)") }
            iframeLoaded.fulfill()
        }
        wait(for: [iframeLoaded], timeout: 10)
        XCTAssertTrue(cancellation.isCurrent(ticket), "Subframe loads must not cancel main-frame reads")

        ticket = cancellation.ticket(key: "a")
        load(webView, handler: handler) { webView.reload() }
        XCTAssertEqual(webView.url, second)
        XCTAssertFalse(cancellation.isCurrent(ticket), "URL-only observation misses reloads")

        // Same-document URL changes do not start loading, but also invalidate outstanding reads.
        ticket = cancellation.ticket(key: "a")
        webView.evaluateJavaScript("history.pushState(null, '', '#next')") { _, error in
            XCTAssertNil(error)
        }
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !cancellation.isCurrent(ticket)
        }, object: nil)
        wait(for: [changed], timeout: 10)

        XCTAssertNotNil(observer)
        observer = nil
        ticket = cancellation.ticket(key: "a")
        load(webView, handler: handler) { webView.loadFileURL(first, allowingReadAccessTo: directory) }
        XCTAssertTrue(cancellation.isCurrent(ticket), "Releasing the owner must remove its observations")
    }
}

/// Holds the response before document commit, including for reloads, without a server or sleeps.
@MainActor
private final class SecureStoreDelayedNavigation: NSObject, WKURLSchemeHandler {
    var requested: (() -> Void)?
    private var pending: WKURLSchemeTask?

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        XCTAssertNil(pending)
        pending = urlSchemeTask
        requested?()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        pending = nil
    }

    func finish() throws {
        let task = try XCTUnwrap(pending)
        let url = try XCTUnwrap(task.request.url)
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                                    headerFields: ["Content-Type": "text/html", "Cache-Control": "no-store"]))
        pending = nil
        task.didReceive(response)
        task.didReceive(Data("<!doctype html><p>fixture</p>".utf8))
        task.didFinish()
    }
}

@MainActor
private final class SecureStoreNavigationFixture {
    let queue: DispatchQueue
    let cancellation: SecureStoreCancellation
    let keys: FakeSecureStoreKeys
    let authenticator: FakeSecureStoreAuthenticator
    let store: SecureStore
    let webView: WKWebView
    let handler: SecureStoreTestNavigationHandler
    // Retain both owners: WebKit's navigation delegate is weak and observations end at deinit.
    let navigation: SecureStoreNavigationGuard
    let observer: SecureStoreNavigationObserver

    init(scheme: SecureStoreDelayedNavigation) throws {
        let queue = DispatchQueue(label: "securestore-navigation-tests")
        let cancellation = SecureStoreCancellation()
        let keys = FakeSecureStoreKeys()
        let authenticator = FakeSecureStoreAuthenticator()
        let writer = FakeSecureStoreWriter()
        let store = try SecureStore(namespace: String(repeating: "a", count: 64), queue: queue,
                                    installation: FakeSecureStoreInstallation(), writer: { writer },
                                    keys: keys, authenticator: authenticator, cancellation: cancellation)
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(scheme, forURLScheme: "secure-store-test")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let handler = SecureStoreTestNavigationHandler()
        let changed: () -> Void = {
            XCTAssertTrue(Thread.isMainThread)
            cancellation.documentChanged()
            queue.async { store.cancelInvalidated() }
        }
        let navigation = SecureStoreNavigationGuard(inner: handler, committed: changed)
        webView.navigationDelegate = navigation
        self.queue = queue
        self.cancellation = cancellation
        self.keys = keys
        self.authenticator = authenticator
        self.store = store
        self.webView = webView
        self.handler = handler
        self.navigation = navigation
        self.observer = SecureStoreNavigationObserver(webView: webView, navigated: changed)
    }

    func teardown() {
        webView.stopLoading()
        queue.sync { store.teardown() }
        handler.cleanUp()
    }
}

@MainActor
final class SecureStoreNavigationGuardTests: XCTestCase {
    private func begin(_ fixture: SecureStoreNavigationFixture, scheme: SecureStoreDelayedNavigation,
                       action: () -> Void) {
        let started = expectation(description: "Provisional navigation started")
        let requested = expectation(description: "Response held before commit")
        fixture.handler.started = { started.fulfill() }
        scheme.requested = { requested.fulfill() }
        action()
        wait(for: [started, requested], timeout: 10)
        fixture.handler.started = nil
        scheme.requested = nil
        XCTAssertTrue(fixture.webView.isLoading)
    }

    private func finish(_ fixture: SecureStoreNavigationFixture, scheme: SecureStoreDelayedNavigation) throws {
        let finished = expectation(description: "Capacitor didFinish forwarded")
        fixture.handler.finished = { finished.fulfill() }
        try scheme.finish()
        wait(for: [finished], timeout: 10)
        fixture.handler.finished = nil
    }

    private func checkReadDuringProvisionalLoad(reload: Bool) throws {
        let scheme = SecureStoreDelayedNavigation()
        let fixture = try SecureStoreNavigationFixture(scheme: scheme)
        defer { fixture.teardown() }
        let first = try XCTUnwrap(URL(string: "secure-store-test://suite/first.html"))
        let second = try XCTUnwrap(URL(string: "secure-store-test://suite/second.html"))
        begin(fixture, scheme: scheme) { fixture.webView.load(URLRequest(url: first)) }
        try finish(fixture, scheme: scheme)
        _ = try fixture.queue.sync { try fixture.store.set(key: "a", value: "token", userPresence: true, version: 0) }
        let previous = fixture.cancellation.ticket(key: "a")
        begin(fixture, scheme: scheme) {
            if reload { fixture.webView.reload() }
            else { fixture.webView.load(URLRequest(url: second)) }
        }
        let provisionalURL = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            fixture.webView.url == (reload ? first : second) && fixture.webView.isLoading
        }, object: nil)
        wait(for: [provisionalURL], timeout: 10)
        // No response has been released, so the outgoing document still exists. KVO has already
        // signalled loading; a new read now must also be cancelled at the later commit.
        let ticket = fixture.cancellation.ticket(key: "a")
        XCTAssertGreaterThan(ticket.documentGeneration, previous.documentGeneration)
        XCTAssertTrue(fixture.cancellation.isCurrent(ticket))
        let done = expectation(description: "Read rejected without resolving")
        done.assertForOverFulfill = true
        var rejections = 0
        var resolutions = 0
        fixture.queue.sync {
            fixture.store.get(key: "a", ticket: ticket) { result in
                DispatchQueue.main.async {
                    fixture.cancellation.deliver(ticket, result) { delivered in
                        switch delivered {
                        case .success: resolutions += 1; XCTFail("Read escaped into replacement document")
                        case .failure: rejections += 1; assertFailure(delivered, .cancelled)
                        }
                        done.fulfill()
                    }
                }
            }
        }
        let authentication = try XCTUnwrap(fixture.authenticator.sessions.last)
        XCTAssertFalse(authentication.invalidated)
        let committed = expectation(description: "Commit forwarded after synchronous cancellation")
        fixture.handler.committed = {
            XCTAssertFalse(fixture.cancellation.isCurrent(ticket), "Cancel before Capacitor sees commit")
            committed.fulfill()
        }
        try finish(fixture, scheme: scheme)
        wait(for: [committed], timeout: 10)
        fixture.handler.committed = nil
        XCTAssertEqual(fixture.webView.url, reload ? first : second)
        // Complete authentication only after the replacement document has committed.
        fixture.queue.sync { authentication.completion?(.success(())) }
        let drained = expectation(description: "Late authentication and bridge deliveries drained")
        fixture.queue.async { DispatchQueue.main.async { drained.fulfill() } }
        wait(for: [done, drained], timeout: 2)
        fixture.queue.sync {
            XCTAssertTrue(authentication.invalidated)
            XCTAssertEqual(fixture.keys.unwraps, 0)
        }
        XCTAssertEqual(rejections, 1)
        XCTAssertEqual(resolutions, 0)
    }

    func testReadStartedAfterProvisionalNavigationIsRejectedAtCommitBeforeAuthenticationCompletes() throws {
        try checkReadDuringProvisionalLoad(reload: false)
    }

    func testReadStartedAfterSameURLReloadBeginsIsRejectedAtCommitBeforeAuthenticationCompletes() throws {
        try checkReadDuringProvisionalLoad(reload: true)
    }

    func testProxyForwardsCapacitorPolicyFinishAndProcessTerminationCallbacks() throws {
        let scheme = SecureStoreDelayedNavigation()
        let fixture = try SecureStoreNavigationFixture(scheme: scheme)
        defer { fixture.teardown() }
        for name in ["webView:decidePolicyForNavigationAction:decisionHandler:",
                     "webView:didFinishNavigation:", "webViewWebContentProcessDidTerminate:"] {
            let selector = NSSelectorFromString(name)
            XCTAssertTrue(fixture.navigation.responds(to: selector), name)
            XCTAssertTrue((fixture.navigation.forwardingTarget(for: selector) as? WebViewDelegationHandler) === fixture.handler)
        }
        let absent = NSSelectorFromString("notAWebKitCallback:")
        XCTAssertFalse(fixture.navigation.responds(to: absent))
        XCTAssertNil(fixture.navigation.forwardingTarget(for: absent))
        let url = try XCTUnwrap(URL(string: "secure-store-test://suite/first.html"))
        begin(fixture, scheme: scheme) { fixture.webView.load(URLRequest(url: url)) }
        try finish(fixture, scheme: scheme)
        XCTAssertGreaterThan(fixture.handler.policyCalls, 0)
        XCTAssertEqual(fixture.handler.finishes, 1)
        let delegate: WKNavigationDelegate = fixture.navigation
        // Capacitor's real termination handler reloads the page; this must reach it through
        // Objective-C optional-selector forwarding just like WebKit's policy/finish callbacks.
        begin(fixture, scheme: scheme) { delegate.webViewWebContentProcessDidTerminate?(fixture.webView) }
        try finish(fixture, scheme: scheme)
        XCTAssertEqual(fixture.handler.terminations, 1)
        XCTAssertEqual(fixture.handler.finishes, 2)
    }

    func testReadWithinOneDocumentStillResolves() throws {
        let scheme = SecureStoreDelayedNavigation()
        let fixture = try SecureStoreNavigationFixture(scheme: scheme)
        defer { fixture.teardown() }
        let url = try XCTUnwrap(URL(string: "secure-store-test://suite/first.html"))
        begin(fixture, scheme: scheme) { fixture.webView.load(URLRequest(url: url)) }
        try finish(fixture, scheme: scheme)
        _ = try fixture.queue.sync { try fixture.store.set(key: "a", value: "token", userPresence: true, version: 0) }
        let ticket = fixture.cancellation.ticket(key: "a")
        let done = expectation(description: "Same-document read resolves")
        var resolutions = 0
        fixture.queue.sync {
            fixture.store.get(key: "a", ticket: ticket) { result in
                DispatchQueue.main.async {
                    fixture.cancellation.deliver(ticket, result) { delivered in
                        do {
                            let read = try delivered.get()
                            XCTAssertEqual(read.value, "token")
                            XCTAssertEqual(read.version, 1)
                            resolutions += 1
                        } catch { XCTFail("Same-document read rejected: \(error)") }
                        done.fulfill()
                    }
                }
            }
            fixture.authenticator.sessions.last?.completion?(.success(()))
        }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(resolutions, 1)
        XCTAssertTrue(fixture.cancellation.isCurrent(ticket))
        fixture.queue.sync {
            XCTAssertEqual(fixture.keys.unwraps, 1)
            XCTAssertTrue(fixture.authenticator.sessions[0].invalidated)
        }
    }
}

/// Uses the production plugin's get/admission paths and serial loader with fake native services.
private final class SecureStoreAdmissionTestPlugin: SuiteSecureStorePlugin {
    let keys = FakeSecureStoreKeys()
    let authenticator = FakeSecureStoreAuthenticator()
    var ready: (() -> Void)?
    var storageQueue: DispatchQueue?
    var testStore: SecureStore?

    override func load() {
        loadStore { queue, cancellation in
            let writer = FakeSecureStoreWriter()
            let store = try SecureStore(namespace: String(repeating: "a", count: 64), queue: queue,
                                        installation: FakeSecureStoreInstallation(), writer: { writer },
                                        keys: self.keys, authenticator: self.authenticator, cancellation: cancellation)
            self.storageQueue = queue
            self.testStore = store
            self.ready?()
            return store
        }
    }
}

/// A real Capacitor bridge and WKScriptMessage channel, without network, Keychain or LA prompts.
@MainActor
private final class SecureStoreAdmissionBridge: NSObject, CAPBridgeDelegate, WKScriptMessageHandler {
    let plugin = SecureStoreAdmissionTestPlugin()
    let handler: SecureStoreTestNavigationHandler
    let webView: WKWebView
    var bridgedWebView: WKWebView? { return webView }
    var bridgedViewController: UIViewController? { return nil }
    private(set) var bridge: CapacitorBridge!
    private var originGuard: BridgeOriginGuard!
    private var navigationGuard: SecureStoreNavigationGuard!
    var admitted: (() -> Void)?
    var received: (([String: Any]) -> Void)?

    init(ready: @escaping () -> Void) throws {
        let webConfiguration = WKWebViewConfiguration()
        let handler = SecureStoreTestNavigationHandler()
        self.handler = handler
        webConfiguration.userContentController = handler.contentController
        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        super.init()
        let descriptor = InstanceDescriptor()
        descriptor.serverURL = "https://suite.example"
        descriptor.handleApplicationNotifications = false
        let configuration = InstanceConfiguration(with: descriptor, isDebug: false)
        bridge = CapacitorBridge(with: configuration, delegate: self,
                                 cordovaConfiguration: descriptor.cordovaConfiguration,
                                 assetHandler: WebViewAssetHandler(router: CapacitorRouter()),
                                 delegationHandler: handler, autoRegisterPlugins: false)
        plugin.ready = ready
        bridge.registerPluginInstance(plugin)
        let allowed = try XCTUnwrap(SuiteOrigin(url: configuration.serverURL))
        originGuard = BridgeOriginGuard(inner: handler, allowed: allowed, admitted: { [weak self] body in
            self?.plugin.admitRead(body)
            if let message = body as? [String: Any], message["pluginId"] as? String == "SuiteSecureStore",
               message["methodName"] as? String == "get" { self?.admitted?() }
        }) { [weak self] name in self?.bridge.plugin(withName: name) != nil }
        handler.contentController.removeScriptMessageHandler(forName: "bridge")
        handler.contentController.add(originGuard, name: "bridge")
        handler.contentController.add(self, name: "secureStoreResult")
        // Observe Capacitor's actual JavaScript delivery, including unknown callback ids.
        handler.contentController.addUserScript(WKUserScript(source: """
            window.Capacitor.fromNative = result => window.webkit.messageHandlers.secureStoreResult.postMessage(result);
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        navigationGuard = SecureStoreNavigationGuard(inner: handler) { [weak self] in
            self?.plugin.navigationCommitted()
        }
        webView.navigationDelegate = navigationGuard
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let result = message.body as? [String: Any] else { XCTFail("Missing bridge result"); return }
        received?(result)
    }

    func teardown() {
        webView.stopLoading()
        handler.contentController.removeScriptMessageHandler(forName: "secureStoreResult")
        if let queue = plugin.storageQueue { queue.sync { plugin.testStore?.teardown() } }
        handler.cleanUp()
    }
}

@MainActor
final class SecureStoreAdmissionTests: XCTestCase {
    private func load(_ fixture: SecureStoreAdmissionBridge, path: String) throws {
        let committed = expectation(description: "Main-frame commit forwarded")
        let finished = expectation(description: "Document loaded")
        fixture.handler.committed = { committed.fulfill() }
        fixture.handler.finished = { finished.fulfill() }
        let url = try XCTUnwrap(URL(string: "https://suite.example/\(path)"))
        // WebKit supplies a real HTTPS document origin without issuing a network request.
        fixture.webView.loadSimulatedRequest(URLRequest(url: url), responseHTML: "<!doctype html><p>fixture</p>")
        wait(for: [committed, finished], timeout: 10)
        fixture.handler.committed = nil
        fixture.handler.finished = nil
    }

    private func submit(_ fixture: SecureStoreAdmissionBridge, key: String = "a", callbackId: String = "read") {
        let admitted = expectation(description: "Origin guard admitted read before dispatch")
        let submitted = expectation(description: "Read submitted from page")
        fixture.admitted = {
            XCTAssertTrue(Thread.isMainThread)
            admitted.fulfill()
        }
        fixture.webView.evaluateJavaScript("""
            window.webkit.messageHandlers.bridge.postMessage({type: 'message', pluginId: 'SuiteSecureStore',
                methodName: 'get', callbackId: '\(callbackId)', options: {key: '\(key)'}});
            """) { _, error in
            XCTAssertNil(error)
            submitted.fulfill()
        }
        wait(for: [admitted, submitted], timeout: 10)
        fixture.admitted = nil
    }

    private func makeFixture() throws -> SecureStoreAdmissionBridge {
        let ready = expectation(description: "Fake native store loaded")
        let fixture = try SecureStoreAdmissionBridge { ready.fulfill() }
        wait(for: [ready], timeout: 2)
        let queue = try XCTUnwrap(fixture.plugin.storageQueue)
        let store = try XCTUnwrap(fixture.plugin.testStore)
        _ = try queue.sync { try store.set(key: "a", value: "token", userPresence: true, version: 0) }
        try load(fixture, path: "first")
        return fixture
    }

    func testReadAdmittedBeforeCommitButDispatchedAfterwardsCancelsWithoutPrompt() throws {
        let fixture = try makeFixture()
        defer { fixture.teardown() }
        let delivered = expectation(description: "Queued read rejected through Capacitor to JavaScript")
        fixture.received = { result in
            XCTAssertEqual(result["callbackId"] as? String, "read")
            XCTAssertEqual(result["success"] as? Bool, false)
            XCTAssertEqual((result["error"] as? [String: Any])?["code"] as? String, "cancelled")
            XCTAssertNil(result["data"])
            delivered.fulfill()
        }
        // Hold Capacitor's actual queue, not the storage queue: get has not been invoked yet.
        fixture.bridge.dispatchQueue.suspend()
        do {
            defer { fixture.bridge.dispatchQueue.resume() }
            submit(fixture)
            try load(fixture, path: "replacement")
        }
        wait(for: [delivered], timeout: 10)
        let queue = try XCTUnwrap(fixture.plugin.storageQueue)
        queue.sync {
            XCTAssertTrue(fixture.plugin.authenticator.sessions.isEmpty)
            XCTAssertEqual(fixture.plugin.keys.accesses, 0)
            XCTAssertEqual(fixture.plugin.keys.unwraps, 0)
        }
    }

    func testReusedCallbackIdCannotLendReplacementDocumentsTicketToOutgoingRead() throws {
        let fixture = try makeFixture()
        defer { fixture.teardown() }
        let cancelled = expectation(description: "Outgoing read cancelled")
        let resolved = expectation(description: "Replacement read resolves")
        var results = 0
        fixture.received = { result in
            results += 1
            XCTAssertEqual(result["callbackId"] as? String, "read")
            if results == 1 {
                XCTAssertEqual(result["success"] as? Bool, false)
                XCTAssertEqual((result["error"] as? [String: Any])?["code"] as? String, "cancelled")
                cancelled.fulfill()
            } else {
                XCTAssertEqual(result["success"] as? Bool, true)
                XCTAssertEqual((result["data"] as? [String: Any])?["value"] as? String, "token")
                resolved.fulfill()
            }
        }
        fixture.bridge.dispatchQueue.suspend()
        do {
            defer { fixture.bridge.dispatchQueue.resume() }
            submit(fixture)
            try load(fixture, path: "replacement")
            submit(fixture) // Same callback id and key, but a different admitted document generation.
        }
        fixture.bridge.dispatchQueue.sync {} // Both invocations have now reached the production plugin.
        let queue = try XCTUnwrap(fixture.plugin.storageQueue)
        queue.sync {
            XCTAssertEqual(fixture.plugin.authenticator.sessions.count, 1)
            XCTAssertEqual(fixture.plugin.keys.accesses, 1)
            fixture.plugin.authenticator.sessions.last?.completion?(.success(()))
        }
        wait(for: [cancelled, resolved], timeout: 10, enforceOrder: true)
        XCTAssertEqual(results, 2)
    }

    func testReadWithoutAdmissionRejectsInsteadOfCapturingCurrentDocument() throws {
        let fixture = try makeFixture()
        defer { fixture.teardown() }
        let rejected = expectation(description: "Unadmitted read cancelled")
        let call = try XCTUnwrap(CAPPluginCall(callbackId: "unadmitted", methodName: "get", options: ["key": "a"],
                                             success: { _, _ in XCTFail("Unadmitted read resolved") },
                                             error: { error in
                                                 XCTAssertEqual(error?.code, "cancelled")
                                                 rejected.fulfill()
                                             }))
        fixture.plugin.get(call)
        wait(for: [rejected], timeout: 2)
        let queue = try XCTUnwrap(fixture.plugin.storageQueue)
        queue.sync {
            XCTAssertTrue(fixture.plugin.authenticator.sessions.isEmpty)
            XCTAssertEqual(fixture.plugin.keys.accesses, 0)
        }
    }

    func testInvalidReadDoesNotConsumeNextValidReadsAdmissionWithSameCallbackId() throws {
        let fixture = try makeFixture()
        defer { fixture.teardown() }
        let invalid = expectation(description: "Invalid key rejected")
        let valid = expectation(description: "Valid read resolves with its own ticket")
        var results = 0
        fixture.received = { result in
            results += 1
            if results == 1 {
                XCTAssertEqual((result["error"] as? [String: Any])?["code"] as? String, "invalid")
                invalid.fulfill()
            } else {
                XCTAssertEqual((result["data"] as? [String: Any])?["value"] as? String, "token")
                valid.fulfill()
            }
        }
        fixture.bridge.dispatchQueue.suspend()
        do {
            defer { fixture.bridge.dispatchQueue.resume() }
            submit(fixture, key: "INVALID")
            submit(fixture)
        }
        fixture.bridge.dispatchQueue.sync {}
        let queue = try XCTUnwrap(fixture.plugin.storageQueue)
        queue.sync {
            XCTAssertEqual(fixture.plugin.authenticator.sessions.count, 1)
            fixture.plugin.authenticator.sessions.last?.completion?(.success(()))
        }
        wait(for: [invalid, valid], timeout: 10, enforceOrder: true)
        XCTAssertEqual(results, 2)
    }
}

/// Asserts a completion result failed with `expected`, without `try`, so completion closures
/// stay non-throwing (Swift 6.2 infers a closure containing `try` as throwing).
func assertFailure<Success, Failure: Error>(
    _ result: Result<Success, Failure>,
    _ expected: SecureStoreFailure?,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    switch result {
    case .success:
        XCTFail("expected failure \(String(describing: expected)), got success", file: file, line: line)
    case .failure(let error):
        XCTAssertEqual(error as? SecureStoreFailure, expected, file: file, line: line)
    }
}

final class FakeSecureStoreWriter: SecureStoreFileWriting {
    var data: Data?
    var fail = false
    var backing: SecureStoreFileWriting?
    func read() throws -> Data? { return try backing?.read() ?? data }
    func write(_ data: Data) throws {
        if fail { throw SecureStoreFailure.failed }
        try backing?.write(data)
        self.data = data
    }
}

final class FakeSecureStoreAuthentication: SecureStoreAuthentication {
    var context: LAContext? { return nil }
    var completion: ((Result<Void, SecureStoreFailure>) -> Void)?
    var invalidated = false
    func authenticate(accessControl: SecAccessControl, completion: @escaping (Result<Void, SecureStoreFailure>) -> Void) {
        self.completion = completion
    }
    func invalidate() { invalidated = true }
}

final class FakeSecureStoreAuthenticator: SecureStoreAuthenticating {
    var sessions = [FakeSecureStoreAuthentication]()
    func makeSession() -> SecureStoreAuthentication {
        let session = FakeSecureStoreAuthentication()
        sessions.append(session)
        return session
    }
}

final class FakeSecureStoreKeys: SecureStoreKeyProviding {
    var userPresence = true
    var hardwareBacked = false
    var key = Data(repeating: 7, count: 32)
    var missing = Set<String>()
    var retired = [String]()
    var ungatedExists = true
    var creates = 0
    var unwraps = 0
    var accesses = 0
    var readError: Error?
    var duringUnwrap: (() -> Void)?
    var eciesKey: SecKey?

    func ungated(create: Bool) throws -> Data {
        if let error = readError { throw error }
        if !ungatedExists {
            if !create { throw SecureStoreRecordFailure.missingKey }
            creates += 1
            ungatedExists = true
        }
        return key
    }

    func wrap(_ data: Data, currentKeyId: String?) throws -> SecureStoreWrappedKey {
        var id = currentKeyId
        if let current = id, missing.contains(current) { try retire(keyId: current); id = nil }
        if id == nil { creates += 1; id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() }
        if let key = eciesKey {
            guard let publicKey = SecKeyCopyPublicKey(key),
                  let wrapped = SecKeyCreateEncryptedData(publicKey, .eciesEncryptionCofactorVariableIVX963SHA256AESGCM,
                                                          data as CFData, nil) else { throw SecureStoreFailure.failed }
            return SecureStoreWrappedKey(keyId: id!, data: wrapped as Data)
        }
        return SecureStoreWrappedKey(keyId: id!, data: data)
    }

    func accessControl(keyId: String) throws -> SecAccessControl {
        accesses += 1
        if let error = readError { throw error }
        if missing.contains(keyId) { throw SecureStoreRecordFailure.missingKey }
        return SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [], nil)!
    }

    func unwrap(_ data: Data, keyId: String, authentication: SecureStoreAuthentication) throws -> Data {
        unwraps += 1
        duringUnwrap?()
        if let error = readError { throw error }
        if missing.contains(keyId) { throw SecureStoreRecordFailure.missingKey }
        if let key = eciesKey { return try SecureStoreKeyProvider.unwrap(data, using: key) }
        return data
    }

    func retire(keyId: String) throws { retired.append(keyId) }
}

final class SecureStoreTests: XCTestCase {
    private let queue = DispatchQueue(label: "securestore-tests")
    private let namespace = String(repeating: "a", count: 64)
    private var writer: FakeSecureStoreWriter!
    private var keys: FakeSecureStoreKeys!
    private var authenticator: FakeSecureStoreAuthenticator!
    private var store: SecureStore!
    private var cancellation: SecureStoreCancellation!

    override func setUpWithError() throws {
        try super.setUpWithError()
        writer = FakeSecureStoreWriter()
        keys = FakeSecureStoreKeys()
        authenticator = FakeSecureStoreAuthenticator()
        cancellation = SecureStoreCancellation()
        store = try makeStore()
    }

    override func tearDownWithError() throws {
        queue.sync { store.teardown() }
        store = nil
        try super.tearDownWithError()
    }

    private func makeStore() throws -> SecureStore {
        return try SecureStore(namespace: namespace, queue: queue, installation: FakeSecureStoreInstallation(),
                               writer: { self.writer }, keys: keys, authenticator: authenticator, cancellation: cancellation)
    }

    @discardableResult
    private func set(_ key: String = "a", _ value: String = "token", gated: Bool = false, version: Int64 = 0) throws -> Int64 {
        return try queue.sync { try store.set(key: key, value: value, userPresence: gated, version: version) }
    }

    private func get(_ key: String = "a", authenticated: Bool = false) throws -> SecureStoreRead {
        let done = expectation(description: "read")
        var result: Result<SecureStoreRead, Error>?
        queue.sync {
            store.get(key: key) { result = $0; done.fulfill() }
            if authenticated { authenticator.sessions.last?.completion?(.success(())) }
        }
        wait(for: [done], timeout: 2)
        return try XCTUnwrap(result).get()
    }

    private func state() throws -> SecureStoreState { return try JSONDecoder().decode(SecureStoreState.self, from: XCTUnwrap(writer.data)) }

    private func replaceState(_ state: SecureStoreState) throws {
        writer.data = try JSONEncoder().encode(state)
        store = try makeStore()
    }

    private func failure(_ code: SecureStoreFailure, _ operation: () throws -> Void, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try operation(), file: file, line: line) {
            XCTAssertEqual($0 as? SecureStoreFailure, code, file: file, line: line)
        }
    }

    func testValidationIsExactAndCountsUTF8Bytes() throws {
        for key in ["a", "pod-auth:refresh:012._-", String(repeating: "z", count: 128)] {
            XCTAssertEqual(try SecureStoreValidation.key(key), key)
        }
        for key in ["", "A", "_a", "a/b", "a\n", " a", "a\u{0}", "é", String(repeating: "a", count: 129)] {
            failure(.invalid) { _ = try SecureStoreValidation.key(key) }
        }
        failure(.invalid) { _ = try SecureStoreValidation.key(NSNull()) }
        XCTAssertEqual(try SecureStoreValidation.value(""), "")
        _ = try SecureStoreValidation.value(String(repeating: "é", count: 8192))
        failure(.invalid) { _ = try SecureStoreValidation.value(String(repeating: "é", count: 8193)) }
        failure(.invalid) { _ = try SecureStoreValidation.value(12) }
        for raw in [true, "1", -1, 1.5, Double.nan, Double.infinity, 9_007_199_254_740_992.0, NSNull()] as [Any] {
            failure(.invalid) { _ = try SecureStoreValidation.version(raw) }
        }
        XCTAssertEqual(try SecureStoreValidation.version(0), 0)
        XCTAssertEqual(try SecureStoreValidation.version(SecureStoreValidation.maxVersion), SecureStoreValidation.maxVersion)
        XCTAssertTrue(try SecureStoreValidation.boolean(true))
        XCTAssertFalse(try SecureStoreValidation.boolean(false))
        for raw in [0, 1, "true", NSNull()] as [Any] { failure(.invalid) { _ = try SecureStoreValidation.boolean(raw) } }
    }

    func testVersionsTombstonesAndEpochPersistAndRejectLateRefreshes() throws {
        XCTAssertNil(try get().value)
        XCTAssertEqual(try get().version, 0)
        XCTAssertEqual(try set(), 1)
        XCTAssertEqual(try set("a", "rotated", version: 1), 2)
        failure(.stale) { _ = try set(version: 1) }
        try queue.sync { try store.remove(key: "a") }
        XCTAssertNil(try get().value)
        XCTAssertEqual(try get().version, 3)
        failure(.stale) { _ = try set(version: 2) }
        _ = try set("b")
        XCTAssertEqual(try get("b").value, "token")
        store = try makeStore()
        XCTAssertEqual(try get().version, 3)
        try queue.sync { try store.clear() }
        XCTAssertEqual(try get().version, 4)
        XCTAssertEqual(try get("never-written").version, 4)
        failure(.stale) { _ = try set("never-written") }
        store = try makeStore()
        XCTAssertEqual(try set("a", version: 4), 5)
        try queue.sync { try store.remove(key: "missing") }
        XCTAssertEqual(try get("missing").version, 5)
    }

    func testCapacityCountsBothModesWithoutReadingKeysAndAllowsReplacement() throws {
        for index in 0..<32 { _ = try set("k\(index)", gated: index.isMultiple(of: 2)) }
        XCTAssertTrue(authenticator.sessions.isEmpty)
        let before = writer.data
        failure(.full) { _ = try set("overflow") }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try set("k0", gated: false, version: 1), 2)
        XCTAssertEqual(try set("k1", gated: true, version: 1), 2)
        keys.readError = SecureStoreFailure.unavailable
        failure(.full) { _ = try set("overflow") }
        keys.readError = nil
        try queue.sync { try store.remove(key: "k2") }
        XCTAssertEqual(try set("new"), 1)
        XCTAssertEqual(try state().records.count, 32)
        XCTAssertEqual(try state().version("k2"), 2)
    }

    func testAssociatedDataUsesTheSharedBigEndianLengthPrefixedVector() {
        let bytes = SecureStoreRecordCodec.associatedData(namespace: "ns", key: "a:b", mode: 1, keyId: "id")
        XCTAssertEqual(Array(bytes), [83, 83, 83, 49, 0, 2, 110, 115, 0, 3, 97, 58, 98, 1, 0, 2, 105, 100])
        let long = SecureStoreRecordCodec.associatedData(namespace: String(repeating: "a", count: 256), key: "x", mode: 0, keyId: "ungated")
        XCTAssertEqual(Array(Array(long)[4...5]), [1, 0])
        XCTAssertNotEqual(SecureStoreRecordCodec.associatedData(namespace: "ab", key: "c", mode: 0, keyId: "d"),
                          SecureStoreRecordCodec.associatedData(namespace: "a", key: "bc", mode: 0, keyId: "d"))
    }

    func testAEADRejectsEveryChangedBindingAndHasFreshNonces() throws {
        let codec = SecureStoreRecordCodec()
        let first = try codec.seal("secret", namespace: namespace, key: "a", mode: 0, keyId: "ungated", dataKey: keys.key, wrappedKey: nil)
        let second = try codec.seal("secret", namespace: namespace, key: "a", mode: 0, keyId: "ungated", dataKey: keys.key, wrappedKey: nil)
        XCTAssertNotEqual(first.nonce, second.nonce)
        XCTAssertEqual(first.nonce.count, 12)
        XCTAssertEqual(first.tag.count, 16)
        XCTAssertEqual(try codec.open(first, dataKey: keys.key), "secret")
        for (ns, key, mode, id) in [("other", "a", UInt8(0), "ungated"), (namespace, "b", 0, "ungated"),
                                    (namespace, "a", 1, "ungated"), (namespace, "a", 0, "other")] {
            let moved = SecureStoreRecord(namespace: ns, key: key, mode: mode, keyId: id, wrappedKey: nil,
                                          nonce: first.nonce, ciphertext: first.ciphertext, tag: first.tag)
            XCTAssertThrowsError(try codec.open(moved, dataKey: keys.key)) {
                XCTAssertTrue($0 is SecureStoreRecordFailure)
            }
        }
    }

    func testCorruptParsingLocationAndTagRecoverOnlyTheAffectedRecord() throws {
        for damage in ["parse", "namespace", "location", "mode", "keyId", "tag"] {
            writer.data = nil
            store = try makeStore()
            _ = try set("a")
            _ = try set("b", "neighbor")
            var changed = try state()
            if damage == "parse" { changed.records["a"] = Data("broken".utf8) }
            else if damage == "location" { changed.records["a"] = changed.records["b"] }
            else {
                var record = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(changed.records["a"])) as? [String: Any])
                if damage == "mode" { record[damage] = 2 }
                else if damage == "tag" { record[damage] = Data(repeating: 0, count: 16).base64EncodedString() }
                else { record[damage] = "wrong" }
                changed.records["a"] = try JSONSerialization.data(withJSONObject: record)
            }
            try replaceState(changed)
            XCTAssertNil(try get().value, damage)
            XCTAssertEqual(try get().version, 2)
            XCTAssertEqual(try get("b").value, "neighbor")
            XCTAssertTrue(keys.retired.isEmpty)
        }
    }

    func testMissingKeysRecoverWithoutGeneratingKeysAndRotateOnlyOnSet() throws {
        _ = try set(gated: true)
        _ = try set("b", "neighbor")
        let id = try XCTUnwrap(state().wrappingKeyId)
        keys.missing.insert(id)
        let creates = keys.creates
        XCTAssertNil(try get().value)
        XCTAssertEqual(keys.retired, [id])
        XCTAssertEqual(keys.creates, creates)
        XCTAssertEqual(try get("b").value, "neighbor")
        _ = try set("a", gated: true, version: 2)
        XCTAssertNotEqual(try state().wrappingKeyId, id)
        XCTAssertEqual(keys.creates, creates + 1)
        keys.ungatedExists = false
        XCTAssertNil(try get("b").value)
        XCTAssertEqual(keys.creates, creates + 1)
    }

    func testRealECIESWrappersRoundTripAndCorruptionRecoversOnlyThatRecord() throws {
        let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                                        kSecAttrKeySizeInBits as String: 256]
        // A software P-256 key exercises Security's real ECIES framing and tag checks on a simulator too.
        keys.eciesKey = try XCTUnwrap(SecKeyCreateRandomKey(attributes as CFDictionary, nil))
        for damage in ["truncated", "tag", "point"] {
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            _ = try set("b", "neighbor")
            XCTAssertEqual(try get(authenticated: true).value, "token")
            var changed = try state()
            var record = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(changed.records["a"])) as? [String: Any])
            var wrapper = try XCTUnwrap(Data(base64Encoded: XCTUnwrap(record["wrappedKey"] as? String)))
            if damage == "truncated" { wrapper = Data(wrapper.prefix(80)) }
            else if damage == "point" { wrapper[0] = 0x02 }
            else { wrapper[wrapper.count - 1] ^= 1 }
            record["wrappedKey"] = wrapper.base64EncodedString()
            changed.records["a"] = try JSONSerialization.data(withJSONObject: record)
            try replaceState(changed)
            let creates = keys.creates
            let recovered = try get(authenticated: true)
            XCTAssertNil(recovered.value, damage)
            XCTAssertEqual(recovered.version, 2)
            XCTAssertNil(try state().records["a"])
            XCTAssertEqual(try get("b").value, "neighbor")
            XCTAssertTrue(keys.retired.isEmpty)
            XCTAssertEqual(keys.creates, creates)
        }
    }

    func testECIESUnwrapErrorMappingPreservesAuthenticationAndInteractionFailures() throws {
        for status in [errSecDecode, errSecParam] {
            let error = try XCTUnwrap(CFErrorCreate(nil, kCFErrorDomainOSStatus, Int(status), nil))
            XCTAssertTrue(SecureStoreKeyProvider.unwrapFailure(error) is SecureStoreRecordFailure)
        }
        for (status, code) in [(errSecUserCanceled, SecureStoreFailure.cancelled),
                                (errSecAuthFailed, .failed), (errSecInteractionNotAllowed, .unavailable)] {
            let error = try XCTUnwrap(CFErrorCreate(nil, kCFErrorDomainOSStatus, Int(status), nil))
            XCTAssertEqual(SecureStoreKeyProvider.unwrapFailure(error) as? SecureStoreFailure, code)
        }
        for (status, code) in [(LAError.Code.systemCancel, SecureStoreFailure.cancelled),
                                (.biometryLockout, .lockout), (.notInteractive, .unavailable)] {
            let error = try XCTUnwrap(CFErrorCreate(nil, LAError.errorDomain as CFString, status.rawValue, nil))
            XCTAssertEqual(SecureStoreKeyProvider.unwrapFailure(error) as? SecureStoreFailure, code)
        }
    }

    func testMalformedOuterRecordEncodingAlsoRecoversOnlyThatRecord() throws {
        for corrupt in ["not base64", NSNull(), ["unexpected": "object"]] as [Any] {
            writer.data = nil
            store = try makeStore()
            _ = try set("a")
            _ = try set("b", "neighbor")
            var root = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(writer.data)) as? [String: Any])
            var records = try XCTUnwrap(root["records"] as? [String: Any])
            records["a"] = corrupt
            root["records"] = records
            writer.data = try JSONSerialization.data(withJSONObject: root)
            store = try makeStore()
            XCTAssertNil(try get().value)
            XCTAssertEqual(try get().version, 2)
            XCTAssertEqual(try get("b").value, "neighbor")
        }
    }

    func testTransientKeyErrorsPreserveTheFileAndEveryVersion() throws {
        _ = try set()
        let before = writer.data
        for error in [SecureStoreFailure.lockout, .unavailable, .cancelled, .failed] {
            keys.readError = error
            failure(error) { _ = try get() }
            XCTAssertEqual(writer.data, before)
        }
        keys.readError = nil
        XCTAssertEqual(try get().value, "token")
        XCTAssertEqual(try get().version, 1)
    }

    func testFailedCommitsKeepDiskAndMemoryForSetRemoveClearAndRecovery() throws {
        _ = try set()
        let before = writer.data
        writer.fail = true
        failure(.failed) { _ = try set("a", "changed", version: 1) }
        failure(.failed) { _ = try queue.sync { try store.remove(key: "a") } }
        failure(.failed) { _ = try queue.sync { try store.clear() } }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try get().value, "token")
        XCTAssertEqual(try get().version, 1)
        keys.ungatedExists = false
        failure(.failed) { _ = try get() }
        XCTAssertEqual(writer.data, before)
        keys.ungatedExists = true
        writer.fail = false
        store = try makeStore()
        XCTAssertEqual(try get().value, "token")
        XCTAssertEqual(try set("a", "next", version: 1), 2)
    }

    func testSafeIntegerExhaustionNeverWrapsOrPartiallyChangesState() throws {
        var exhausted = SecureStoreState()
        exhausted.epoch = SecureStoreValidation.maxVersion
        try replaceState(exhausted)
        let before = writer.data
        failure(.failed) { _ = try set(version: SecureStoreValidation.maxVersion) }
        failure(.failed) { _ = try queue.sync { try store.remove(key: "a") } }
        failure(.failed) { _ = try queue.sync { try store.clear() } }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try get().version, SecureStoreValidation.maxVersion)
    }

    func testMalformedNamespaceStateFailsClosedInsteadOfResettingVersions() throws {
        writer.data = Data("broken state".utf8)
        XCTAssertThrowsError(try makeStore())
        var invalid = SecureStoreState()
        invalid.epoch = -1
        writer.data = try JSONEncoder().encode(invalid)
        XCTAssertThrowsError(try makeStore())
        invalid.epoch = 5
        invalid.versions["a"] = 4
        writer.data = try JSONEncoder().encode(invalid)
        XCTAssertThrowsError(try makeStore())
        XCTAssertEqual(try get().version, 0)
    }

    func testGatedWritesNeverAuthenticateAndUnavailableNeverDowngrades() throws {
        _ = try set(gated: true)
        XCTAssertTrue(authenticator.sessions.isEmpty)
        let before = writer.data
        keys.userPresence = false
        failure(.unavailable) { _ = try set("a", "rotation", gated: true, version: 1) }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try state().records.count, 1)
    }

    func testEachReadHasAFreshSessionAndFinishingInvalidatesIt() throws {
        _ = try set(gated: true)
        for _ in 0..<2 {
            let done = expectation(description: "authenticated read")
            queue.sync {
                store.get(key: "a") { result in
                    do { XCTAssertEqual(try result.get().value, "token") }
                    catch { XCTFail("Unexpected read failure: \(error)") }
                    done.fulfill()
                }
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [done], timeout: 2)
            XCTAssertTrue(try XCTUnwrap(authenticator.sessions.last).invalidated)
        }
        XCTAssertEqual(authenticator.sessions.count, 2)
        XCTAssertFalse(authenticator.sessions[0] === authenticator.sessions[1])
        XCTAssertEqual(keys.unwraps, 2)
    }

    func testPromptFailuresDoNotDeleteRecordsOrAllowLateSuccess() throws {
        _ = try set(gated: true)
        let before = writer.data
        for code in [SecureStoreFailure.background, .cancelled, .lockout, .unavailable, .failed] {
            let done = expectation(description: "prompt failure")
            var completions = 0
            queue.sync {
                store.get(key: "a") { result in
                    completions += 1
                    assertFailure(result, code)
                    done.fulfill()
                }
                authenticator.sessions.last?.completion?(.failure(code))
            }
            wait(for: [done], timeout: 2)
            queue.sync { authenticator.sessions.last?.completion?(.success(())) }
            queue.sync { XCTAssertEqual(completions, 1) }
            XCTAssertEqual(writer.data, before)
        }
        XCTAssertEqual(keys.unwraps, 0)
    }

    func testCancelBackgroundNavigationRemoveClearAndTeardownDropLateCallbacks() throws {
        for trigger in ["cancel", "background", "navigation", "remove", "clear", "teardown"] {
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            let done = expectation(description: trigger)
            var completions = 0
            try queue.sync {
                store.get(key: "a") { result in
                    completions += 1
                    assertFailure(result, .cancelled)
                    done.fulfill()
                }
                switch trigger {
                case "background": store.background()
                case "navigation": store.navigationCommitted()
                case "remove": try store.remove(key: "a")
                case "clear": try store.clear()
                case "teardown": store.teardown()
                default: store.cancel()
                }
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [done], timeout: 2)
            queue.sync { XCTAssertEqual(completions, 1) }
            XCTAssertTrue(try XCTUnwrap(authenticator.sessions.last).invalidated)
        }
        XCTAssertEqual(keys.unwraps, 0)
    }

    func testRemovingAnotherKeyDoesNotCancelAndARotationMakesTheOldReadStale() throws {
        _ = try set(gated: true)
        let done = expectation(description: "rotated during prompt")
        try queue.sync {
            store.get(key: "a") { result in
                assertFailure(result, .stale)
                done.fulfill()
            }
            try store.remove(key: "b")
            XCTAssertFalse(authenticator.sessions[0].invalidated)
            _ = try store.set(key: "a", value: "new", userPresence: false, version: 1)
            authenticator.sessions[0].completion?(.success(()))
        }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(try get().value, "new")
        XCTAssertEqual(keys.unwraps, 0)
    }

    func testSynchronousCancellationDuringDecryptionCannotReturnPlaintextOrDeleteTheRecord() throws {
        for trigger in ["background", "navigation", "cancel", "remove", "clear", "teardown"] {
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            let before = writer.data
            let decrypting = expectation(description: "decrypting: \(trigger)")
            let done = expectation(description: "cancelled: \(trigger)")
            let resume = DispatchSemaphore(value: 0)
            keys.duringUnwrap = {
                decrypting.fulfill()
                XCTAssertEqual(resume.wait(timeout: .now() + 2), .success)
            }
            var completions = 0
            queue.sync {
                store.get(key: "a") { result in
                    completions += 1
                    assertFailure(result, .cancelled)
                    done.fulfill()
                }
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [decrypting], timeout: 2)
            // The bridge records this on the calling thread before enqueuing prompt cleanup.
            if trigger == "navigation" { cancellation.documentChanged() }
            else { cancellation.cancel(key: trigger == "remove" ? "a" : nil) }
            queue.async { self.store.cancelInvalidated() }
            resume.signal()
            wait(for: [done], timeout: 2)
            queue.sync {
                XCTAssertEqual(completions, 1)
                keys.duringUnwrap = nil
            }
            XCTAssertEqual(writer.data, before)
            XCTAssertEqual(try XCTUnwrap(authenticator.sessions.last).invalidated, true)
        }
    }

    func testCancellationBetweenDecryptionAndBridgeDeliveryRejectsTheOldGeneration() throws {
        _ = try set(gated: true)
        let ticket = cancellation.ticket(key: "a")
        let read = try get(authenticated: true)
        cancellation.cancel()
        cancellation.deliver(ticket, .success(read)) { result in
            assertFailure(result, .cancelled)
        }
        let current = cancellation.ticket(key: "a")
        cancellation.cancel(key: "b")
        cancellation.deliver(current, .success(read)) { result in
            XCTAssertEqual(try? result.get().value, "token")
        }
    }

    func testDocumentGenerationRejectsAnUnlockedResultWaitingForBridgeDelivery() throws {
        _ = try set(gated: true)
        let ticket = cancellation.ticket(key: "a")
        let read = try get(authenticated: true)
        // A commit can arrive after authentication/decryption, before the final main-thread check.
        cancellation.documentChanged()
        let current = cancellation.ticket(key: "a")
        XCTAssertEqual(current.generation, ticket.generation)
        XCTAssertNotEqual(current.documentGeneration, ticket.documentGeneration)
        cancellation.deliver(ticket, .success(read)) { result in
            assertFailure(result, .cancelled)
        }
        cancellation.deliver(current, .success(read)) { result in
            XCTAssertEqual(try? result.get().value, "token")
        }
    }

    func testQueuedCancellationCleanupDoesNotCancelANewerGeneration() throws {
        _ = try set(gated: true)
        cancellation.cancel()
        let done = expectation(description: "new generation succeeds")
        queue.sync {
            store.get(key: "a") { result in
                XCTAssertEqual(try? result.get().value, "token")
                done.fulfill()
            }
            store.cancelInvalidated()
            authenticator.sessions.last?.completion?(.success(()))
        }
        wait(for: [done], timeout: 2)
    }

    func testAnOldOperationIdCannotFinishANewRead() throws {
        _ = try set(gated: true)
        let first = expectation(description: "first cancelled")
        let second = expectation(description: "second succeeded")
        queue.sync {
            store.get(key: "a") { result in
                assertFailure(result, .cancelled)
                first.fulfill()
            }
            store.cancel()
            store.get(key: "a") { result in
                XCTAssertEqual(try? result.get().value, "token")
                second.fulfill()
            }
            authenticator.sessions[0].completion?(.success(()))
            authenticator.sessions[1].completion?(.success(()))
        }
        wait(for: [first, second], timeout: 2)
        XCTAssertEqual(keys.unwraps, 1)
    }

    func testRemoveCancelsOnlyItsKeyAndClearCancelsAllKeys() throws {
        for clear in [false, true] {
            writer.data = nil
            store = try makeStore()
            _ = try set("a", gated: true)
            _ = try set("b", "neighbor", gated: true)
            let a = expectation(description: "a cancelled")
            let b = expectation(description: "b settled")
            let start = authenticator.sessions.count
            try queue.sync {
                store.get(key: "a") { result in
                    assertFailure(result, .cancelled)
                    a.fulfill()
                }
                store.get(key: "b") { result in
                    if clear { assertFailure(result, .cancelled) }
                    else { XCTAssertEqual(try? result.get().value, "neighbor") }
                    b.fulfill()
                }
                if clear { try store.clear() }
                else {
                    try store.remove(key: "a")
                    XCTAssertFalse(authenticator.sessions[start + 1].invalidated)
                }
                authenticator.sessions[start].completion?(.success(()))
                authenticator.sessions[start + 1].completion?(.success(()))
            }
            wait(for: [a, b], timeout: 2)
        }
        XCTAssertEqual(keys.unwraps, 1)
    }

    func testRecoveryAfterAuthenticationStillDistinguishesMissingCorruptAndTransientFailures() throws {
        let errors: [Error] = [SecureStoreRecordFailure.missingKey, SecureStoreRecordFailure.corrupt,
                               SecureStoreFailure.unavailable, SecureStoreFailure.lockout, SecureStoreFailure.cancelled, SecureStoreFailure.failed]
        for error in errors {
            keys.readError = nil
            keys.retired = []
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            _ = try set("b", "neighbor")
            let before = writer.data
            let done = expectation(description: "unwrap failure")
            queue.sync {
                store.get(key: "a") { result in
                    if error is SecureStoreRecordFailure {
                        XCTAssertNil(try? result.get().value)
                        XCTAssertEqual(try? result.get().version, 2)
                    } else {
                        assertFailure(result, error as? SecureStoreFailure)
                    }
                    done.fulfill()
                }
                keys.readError = error
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [done], timeout: 2)
            if error is SecureStoreFailure { XCTAssertEqual(writer.data, before) }
            XCTAssertEqual(keys.retired.count, SecureStoreRecovery.shouldRetire(error) ? 1 : 0)
            keys.readError = nil
            XCTAssertEqual(try get("b").value, "neighbor")
        }
    }

    func testNativeErrorMappingContainsOnlyContractCodes() {
        XCTAssertEqual(SecureStoreFailure.code(NSError(domain: "secret native detail", code: 12)), .failed)
        XCTAssertEqual(SecureStoreAuthenticationSession.failure(NSError(domain: LAError.errorDomain, code: LAError.Code.systemCancel.rawValue)), .cancelled)
        XCTAssertEqual(SecureStoreAuthenticationSession.failure(NSError(domain: LAError.errorDomain, code: LAError.Code.biometryLockout.rawValue)), .lockout)
        XCTAssertEqual(SecureStoreAuthenticationSession.failure(NSError(domain: LAError.errorDomain, code: LAError.Code.passcodeNotSet.rawValue)), .unavailable)
        XCTAssertThrowsError(try SecureStoreKeyProvider.check(errSecInteractionNotAllowed)) {
            XCTAssertEqual($0 as? SecureStoreFailure, .unavailable)
        }
        for code in [SecureStoreFailure.cancelled, .background, .lockout, .unavailable, .stale, .full, .invalid, .failed] {
            XCTAssertFalse(SecureStoreRecovery.shouldRemove(code))
        }
    }

    func testRealAuthenticatorChecksForegroundBeforePromptingAndHonoursEarlyCancellation() throws {
        let access = try XCTUnwrap(SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [], nil))
        let authenticator = SecureStoreAuthenticator(isForeground: { false })
        let first = authenticator.makeSession()
        let second = authenticator.makeSession()
        XCTAssertFalse(first === second)
        XCTAssertEqual(first.context?.touchIDAuthenticationAllowableReuseDuration, 0)
        let background = expectation(description: "no foreground scene")
        first.authenticate(accessControl: access) { result in
            assertFailure(result, .background)
            first.invalidate()
            background.fulfill()
        }
        let cancelled = expectation(description: "cancel before presentation")
        second.invalidate()
        second.authenticate(accessControl: access) { result in
            assertFailure(result, .cancelled)
            cancelled.fulfill()
        }
        wait(for: [background, cancelled], timeout: 2)
    }
}
