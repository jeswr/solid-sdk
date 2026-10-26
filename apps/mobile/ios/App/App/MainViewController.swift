// AUTHORED-BY Claude Opus 5.5
import Capacitor
import UIKit

/// The suite shell: registers the local plugins and puts the bridge behind the origin guard.
class MainViewController: CAPBridgeViewController {
    private var bridgeGuard: BridgeOriginGuard?
    // WKWebView.uiDelegate is weak, so the controller keeps the guard alive.
    private var uiGuard: UIDelegateOriginGuard?

    override open func capacitorDidLoad() {
        guard let bridge = bridge else { return }
        bridge.registerPluginInstance(SuiteNavigationPlugin())
        bridge.registerPluginInstance(SuiteAuthSessionPlugin())
        guard let allowed = SuiteOrigin(url: bridge.config.serverURL) else {
            fatalError("server.url must be the https suite origin")
        }
        let handler = bridge.webViewDelegationHandler
        let controller = handler.contentController
        controller.removeScriptMessageHandler(forName: "bridge")
        let wrapper = BridgeOriginGuard(inner: handler, allowed: allowed)
        controller.add(wrapper, name: "bridge")
        bridgeGuard = wrapper
        let ui = UIDelegateOriginGuard(inner: handler, allowed: allowed)
        bridge.webView?.uiDelegate = ui
        uiGuard = ui
    }
}
