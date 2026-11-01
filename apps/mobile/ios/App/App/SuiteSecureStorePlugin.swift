// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import Foundation
import Capacitor
import UIKit
import WebKit

@objc(SuiteSecureStorePlugin)
public class SuiteSecureStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuiteSecureStorePlugin"
    public let jsName = "SuiteSecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "org.jeswr.suite.securestore")
    private let cancellation = SecureStoreCancellation()
    private var loaded: Result<SecureStore, Error>?

    override public func load() {
        let origin = SuiteOrigin(url: bridge?.config.serverURL)
        let authenticator = SecureStoreAuthenticator { [weak self] in
            self?.bridge?.webView?.window?.windowScene?.activationState == .foregroundActive
        }
        queue.async {
            self.loaded = Result {
                guard let origin = origin else { throw SecureStoreFailure.unavailable }
                let namespace = SecureStoreValidation.namespace(origin)
                let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                          appropriateFor: nil, create: true)
                return try SecureStore(namespace: namespace, queue: self.queue,
                                       installation: SecureStoreInstallation(support: support, keys: SecureStoreKeychainWiper()),
                                       writer: { try SecureStoreFileWriter(support: support, namespace: namespace) },
                                       keys: SecureStoreKeyProvider(namespace: namespace), authenticator: authenticator,
                                       cancellation: self.cancellation)
            }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIScene.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(backgrounded), name: UIScene.didDisconnectNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        cancellation.cancel()
        let result = loaded
        queue.async { if case .success(let store)? = result { store.teardown() } }
    }

    @objc private func backgrounded() { cancelReads() }

    func navigationChanged() { cancelReads() }

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
        let ticket = cancellation.ticket(key: key)
        queue.async {
            do {
                try self.store().get(key: key, ticket: ticket) { result in
                    DispatchQueue.main.async {
                        // The last check the shell can make. Capacitor's call.resolve queues one more
                        // main-thread hop before evaluateJavaScript, which this plugin cannot reach. A
                        // commit landing in that hop can only be a same-origin document (the navigation
                        // policy blocks every other origin), and Capacitor's bridge drops a result whose
                        // callback id that document never issued. S9 cancels prompts; it does not promise
                        // to withdraw a value the user already unlocked.
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

/// Observes the main page without replacing Capacitor's navigation delegate. URL changes cover
/// navigation, redirects and history changes; loading covers reloads whose URL stays identical.
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
