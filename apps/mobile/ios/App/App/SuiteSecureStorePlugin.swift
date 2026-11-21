// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import Foundation
import Capacitor
import UIKit
import WebKit

@objc(SuiteSecureStorePlugin)
public class SuiteSecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuiteSecureStorePlugin"
    public let jsName = "SuiteSecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takeMigrationNotice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "org.jeswr.suite.securestore")
    private let cancellation = SecureStoreCancellation()
    private let admissionLock = NSLock()
    private var admittedReads = [String: [SecureStoreCancellation.Ticket]]()
    private var loaded: Result<SecureStore, Error>?

    override public func load() {
        let origin = SuiteOrigin.app(serverURL: bridge?.config.serverURL, localURL: bridge?.config.localURL)
        let authenticator = SecureStoreAuthenticator { [weak self] in
            self?.bridge?.webView?.window?.windowScene?.activationState == .foregroundActive
        }
        loadStore { queue, cancellation in
            guard let origin = origin else { throw SecureStoreFailure.unavailable }
            let namespace = SecureStoreValidation.namespace(origin)
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                      appropriateFor: nil, create: true)
            return try SecureStore(namespace: namespace, queue: queue,
                                   installation: SecureStoreInstallation(support: support, keys: SecureStoreKeychainWiper()),
                                   writer: { try SecureStoreFileWriter(support: support, namespace: namespace) },
                                   keys: SecureStoreKeyProvider(namespace: namespace), authenticator: authenticator,
                                   cancellation: cancellation)
        }
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIScene.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIScene.didDisconnectNotification, object: nil)
    }

    /// Shares the serial store-loading path with native tests using injected keys/authentication.
    func loadStore(_ create: @escaping (DispatchQueue, SecureStoreCancellation) throws -> SecureStore) {
        queue.async { self.loaded = Result { try create(self.queue, self.cancellation) } }
    }

    /// Called only by BridgeOriginGuard after frame, origin and registered-plugin checks.
    func admitRead(_ body: Any) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let message = body as? [String: Any], message["type"] as? String == "message",
              message["pluginId"] as? String == jsName, message["methodName"] as? String == "get",
              let options = message["options"] as? [String: Any],
              let key = try? SecureStoreValidation.key(options["key"]) else { return }
        // Match Capacitor's callbackId default. Invalid keys fail validation without taking a ticket.
        let callbackId = message["callbackId"] as? String ?? ""
        admissionLock.lock()
        defer { admissionLock.unlock() }
        admittedReads[callbackId, default: []].append(cancellation.ticket(key: key))
    }

    private func takeReadTicket(callbackId: String) -> SecureStoreCancellation.Ticket? {
        admissionLock.lock()
        defer { admissionLock.unlock() }
        guard var tickets = admittedReads[callbackId], !tickets.isEmpty else { return nil }
        // Capacitor invokes plugins on its serial bridge queue, in admission order. Keep a FIFO
        // per callbackId, including stale entries across commits: a new document may reuse an id,
        // but must never overwrite or lend its ticket to the outgoing document's queued call.
        let ticket = tickets.removeFirst()
        admittedReads[callbackId] = tickets.isEmpty ? nil : tickets
        return ticket
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        cancellation.cancel()
        let result = loaded
        queue.async { if case .success(let store)? = result { store.teardown() } }
    }

    @objc private func backgrounded() { cancelReads() }

    func navigationChanged() {
        cancellation.documentChanged()
        queue.async { (try? self.loaded?.get())?.cancelInvalidated() }
    }

    func navigationCommitted() { navigationChanged() }

    private func cancelReads(key: String? = nil) {
        cancellation.cancel(key: key)
        queue.async { (try? self.loaded?.get())?.cancelInvalidated() }
    }

    private func store() throws -> SecureStore {
        guard case .success(let store)? = loaded else { throw SecureStoreFailure.unavailable }
        return store
    }

    private static func reject(_ call: CAPPluginCall, _ error: Error) {
        let code = SecureStoreFailure.code(error).rawValue
        call.reject(code, code)
    }

    @objc func takeMigrationNotice(_ call: CAPPluginCall) {
        // Capture configuration before moving to the storage queue. Remote builds do not consume it.
        let bundled = SuiteOrigin.isBundled(serverURL: bridge?.config.serverURL, localURL: bridge?.config.localURL)
        queue.async {
            do {
                guard bundled else { call.resolve(["signInAgain": false]); return }
                let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                          appropriateFor: nil, create: true)
                let notice = try SecureStoreMigration(support: support, keys: SecureStoreMigrationKeychain()).takeNotice()
                call.resolve(["signInAgain": notice])
            } catch { Self.reject(call, error) }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        queue.async {
            guard let store = try? self.store() else {
                call.resolve(["available": false, "userPresence": false, "hardwareBacked": false])
                return
            }
            call.resolve(["available": true, "userPresence": store.userPresence, "hardwareBacked": store.hardwareBacked])
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        let key: String
        do { key = try SecureStoreValidation.key(call.options["key"]) }
        catch { Self.reject(call, error); return }
        let cancellation = self.cancellation
        guard let ticket = takeReadTicket(callbackId: call.callbackId), ticket.key == key else {
            Self.reject(call, SecureStoreFailure.cancelled)
            return
        }
        do { try cancellation.check(ticket) }
        catch { Self.reject(call, error); return }
        queue.async {
            do {
                try self.store().get(key: key, ticket: ticket) { result in
                    DispatchQueue.main.async {
                        // Recheck the ticket's document generation on the main thread, including
                        // commits after provisional loading or after decryption completed.
                        // Accepted residual: Capacitor's call.resolve queues another main-thread hop.
                        // A commit after this check can expose the unlocked plaintext to a replacement
                        // document's Capacitor.fromNative wrapper before unknown callback ids are dropped.
                        // Navigation and bridge guards restrict both documents to the same allowed
                        // origin/principal (S4). S9 cancels prompts, but does not withdraw an unlocked value.
                        cancellation.deliver(ticket, result) { result in
                            switch result {
                            case .success(let read): call.resolve(["value": read.value.map { $0 as Any } ?? NSNull(), "version": read.version])
                            case .failure(let error): SuiteSecureStorePlugin.reject(call, error)
                            }
                        }
                    }
                }
            } catch { Self.reject(call, error) }
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        queue.async {
            do {
                let key = try SecureStoreValidation.key(call.options["key"])
                let value = try SecureStoreValidation.value(call.options["value"])
                let presence = try SecureStoreValidation.boolean(call.options["userPresence"])
                let version = try SecureStoreValidation.version(call.options["version"])
                call.resolve(["version": try self.store().set(key: key, value: value, userPresence: presence, version: version)])
            } catch { Self.reject(call, error) }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        let key: String
        do { key = try SecureStoreValidation.key(call.options["key"]) }
        catch { Self.reject(call, error); return }
        cancelReads(key: key)
        queue.async {
            do {
                try self.store().remove(key: key)
                call.resolve([:])
            } catch { Self.reject(call, error) }
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        cancelReads()
        queue.async {
            do { try self.store().clear(); call.resolve([:]) }
            catch { Self.reject(call, error) }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        cancelReads()
        queue.async {
            do { _ = try self.store(); call.resolve([:]) }
            catch { Self.reject(call, error) }
        }
    }
}

/// Cancels reads at every main-frame commit before forwarding to Capacitor. All other optional
/// callbacks keep Capacitor's selector availability and Objective-C message forwarding intact.
final class SecureStoreNavigationGuard: NSObject, WKNavigationDelegate {
    private weak var inner: (NSObject & WKNavigationDelegate)?
    private let committed: () -> Void

    init(inner: NSObject & WKNavigationDelegate, committed: @escaping () -> Void) {
        self.inner = inner
        self.committed = committed
    }

    override func responds(to selector: Selector!) -> Bool {
        return super.responds(to: selector) || (inner?.responds(to: selector) ?? false)
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        return inner?.responds(to: selector) == true ? inner : nil
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        committed()
        inner?.webView?(webView, didCommit: navigation)
    }
}

/// Adds early cancellation alongside the definitive commit hook. URL changes cover navigation,
/// redirects and history changes; loading covers reloads whose URL stays identical.
/// Cancellation is deliberately conservative and starts before commit. The callback invalidates
/// tickets synchronously, then enqueues prompt cleanup without waiting for the storage queue.
final class SecureStoreNavigationObserver {
    private let urlObservation: NSKeyValueObservation
    private let loadingObservation: NSKeyValueObservation

    init(webView: WKWebView, navigated: @escaping () -> Void) {
        urlObservation = webView.observe(\.url, options: [.new]) { _, _ in navigated() }
        loadingObservation = webView.observe(\.isLoading, options: [.new]) { _, change in
            if change.newValue == true { navigated() }
        }
    }
}
