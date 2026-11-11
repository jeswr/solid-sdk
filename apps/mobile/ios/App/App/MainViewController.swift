// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import Capacitor
import UIKit
import WebKit

/// The suite shell: registers the local plugins and puts the bridge behind the origin guard.
class MainViewController: CAPBridgeViewController {
    private var bridgeGuard: BridgeOriginGuard?
    // WKWebView.uiDelegate is weak, so the controller keeps the guard alive.
    private var uiGuard: UIDelegateOriginGuard?
    // WKWebView.navigationDelegate is weak too; retain the forwarding proxy alongside KVO.
    private var navigationGuard: SecureStoreNavigationGuard?
    private var navigationObserver: SecureStoreNavigationObserver?

    /// Bundled mode (MOB-P3 E4): SuiteSchemeHandler takes over the local scheme, wrapping
    /// Capacitor's handler for device files. It refuses to start without a valid route manifest.
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let base = super.webViewConfiguration(for: instanceConfiguration)
        guard SuiteOrigin.isBundled(serverURL: instanceConfiguration.serverURL,
                                    localURL: instanceConfiguration.localURL) else {
            return base
        }
        let root = instanceConfiguration.appLocation
        do {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                      appropriateFor: nil, create: true)
            let info = try Data(contentsOf: root.appendingPathComponent("build-info.json"))
            guard info.count <= 65536 else { throw SecureStoreFailure.invalid }
            try SecureStoreMigration(support: support, keys: SecureStoreMigrationKeychain()).run(info)
        } catch {
            // Stop before CapacitorBridge is constructed; never include plan or storage details.
            fatalError("Secure store migration failed")
        }
        guard let data = try? Data(contentsOf: root.appendingPathComponent("route-manifest.json")),
              let resolver = try? RouteResolver(manifest: data) else {
            fatalError("Bundled mode needs public/route-manifest.json")
        }
        let config = SuiteBundledWebViewConfiguration.adopting(base)
        config.wrapLocalHandler = { capacitor in
            SuiteSchemeHandler(capacitor: capacitor, resolver: resolver, root: root)
        }
        return config
    }

    override open func capacitorDidLoad() {
        // The protocol hides the delegation handler; the concrete bridge exposes it.
        guard let bridge = bridge as? CapacitorBridge else {
            fatalError("Capacitor bridge is not a CapacitorBridge")
        }
        #if !DEBUG
        // MOBILE_DEBUG=1 writes webContentsDebuggingEnabled into capacitor.config.json and the
        // bridge has already applied it. A Release build is never inspectable, whatever config was
        // bundled (sst-8wx.17).
        if #available(iOS 16.4, *) {
            webView?.isInspectable = false
        }
        #endif
        bridge.registerPluginInstance(SuiteNavigationPlugin())
        bridge.registerPluginInstance(SuiteAuthSessionPlugin())
        bridge.registerPluginInstance(SuitePushPlugin())
        bridge.registerPluginInstance(SuiteShareIntakePlugin())
        bridge.registerPluginInstance(SuiteShareStagingPlugin())
        bridge.registerPluginInstance(SuiteFilesPlugin())
        let secureStore = SuiteSecureStorePlugin()
        bridge.registerPluginInstance(secureStore)
        // Takes over the "Share" name from @capacitor/share so only staged files can be shared.
        bridge.registerPluginInstance(SuiteSharePlugin())
        guard let allowed = SuiteOrigin.app(serverURL: bridge.config.serverURL, localURL: bridge.config.localURL) else {
            fatalError("server.url must be the https suite origin, or unset for bundled mode")
        }
        let handler = bridge.webViewDelegationHandler
        let controller = handler.contentController
        controller.removeScriptMessageHandler(forName: "bridge")
        let wrapper = BridgeOriginGuard(inner: handler, allowed: allowed, admitted: { [weak secureStore] body in
            secureStore?.admitRead(body)
        }) { [weak bridge] name in
            bridge?.plugin(withName: name) != nil
        }
        controller.add(wrapper, name: "bridge")
        bridgeGuard = wrapper
        let ui = UIDelegateOriginGuard(inner: handler, allowed: allowed)
        bridge.webView?.uiDelegate = ui
        uiGuard = ui
        if let webView = bridge.webView {
            let navigation = SecureStoreNavigationGuard(inner: handler) { [weak secureStore] in
                secureStore?.navigationCommitted()
            }
            webView.navigationDelegate = navigation
            navigationGuard = navigation
            navigationObserver = SecureStoreNavigationObserver(webView: webView) { [weak secureStore] in
                secureStore?.navigationChanged()
            }
        }
    }
}
