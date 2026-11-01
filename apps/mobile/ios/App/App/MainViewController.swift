// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import Capacitor
import UIKit

/// The suite shell: registers the local plugins and puts the bridge behind the origin guard.
class MainViewController: CAPBridgeViewController {
    private var bridgeGuard: BridgeOriginGuard?
    // WKWebView.uiDelegate is weak, so the controller keeps the guard alive.
    private var uiGuard: UIDelegateOriginGuard?
    // WKWebView.navigationDelegate is weak too; retain the forwarding proxy alongside KVO.
    private var navigationGuard: SecureStoreNavigationGuard?
    private var navigationObserver: SecureStoreNavigationObserver?

    override open func capacitorDidLoad() {
        // The protocol hides the delegation handler; the concrete bridge exposes it.
        guard let bridge = bridge as? CapacitorBridge else {
            fatalError("Capacitor bridge is not a CapacitorBridge")
        }
        bridge.registerPluginInstance(SuiteNavigationPlugin())
        bridge.registerPluginInstance(SuiteAuthSessionPlugin())
        bridge.registerPluginInstance(SuiteShareIntakePlugin())
        bridge.registerPluginInstance(SuiteShareStagingPlugin())
        let secureStore = SuiteSecureStorePlugin()
        bridge.registerPluginInstance(secureStore)
        // Takes over the "Share" name from @capacitor/share so only staged files can be shared.
        bridge.registerPluginInstance(SuiteSharePlugin())
        guard let allowed = SuiteOrigin(url: bridge.config.serverURL) else {
            fatalError("server.url must be the https suite origin")
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
