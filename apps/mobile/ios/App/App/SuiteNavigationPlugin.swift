// AUTHORED-BY Claude Opus 5.5
import Capacitor
import UIKit
import WebKit

/// Keeps the main frame on the exact suite origin (scheme, host and port); Capacitor's own
/// allowNavigation check is host-only. Other http(s)/mailto/tel links open outside the app.
@objc(SuiteNavigationPlugin)
public class SuiteNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuiteNavigationPlugin"
    public let jsName = "SuiteNavigation"
    public let pluginMethods: [CAPPluginMethod] = []

    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard navigationAction.targetFrame?.isMainFrame ?? true,
              let url = navigationAction.request.url,
              let allowed = SuiteOrigin(url: bridge?.config.serverURL) else {
            return nil
        }
        // The bundled offline page (server.errorPath) is the only local page; its frame gets no
        // bridge or prompt channel because those guards admit only the suite origin.
        if let local = bridge?.config.localURL, url.scheme == local.scheme, url.host == local.host,
           url.path == "/offline.html" {
            return nil
        }
        if SuiteOrigin(url: url) == allowed { return nil }
        if SuiteOrigin.mayOpenExternally(url) {
            DispatchQueue.main.async { UIApplication.shared.open(url) }
        }
        return NSNumber(value: true)
    }
}
