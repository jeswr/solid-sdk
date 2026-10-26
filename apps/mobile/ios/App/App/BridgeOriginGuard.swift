// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY GPT-5.6 Codex
import WebKit

/// Wraps Capacitor's `bridge` script-message handler: Capacitor does not check which frame sent a
/// message, so only the main frame on the exact suite origin may reach plugins (DESIGN D3).
final class BridgeOriginGuard: NSObject, WKScriptMessageHandler {
    private weak var inner: WKScriptMessageHandler?
    private let allowed: SuiteOrigin

    init(inner: WKScriptMessageHandler, allowed: SuiteOrigin) {
        self.inner = inner
        self.allowed = allowed
    }

    /// Shared by the plugin and prompt channels; testable without constructing a WKWebView.
    static func allows(isMainFrame: Bool, origin: SuiteOrigin?, allowed: SuiteOrigin) -> Bool {
        return isMainFrame && origin == allowed
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard Self.allows(isMainFrame: message.frameInfo.isMainFrame,
                          origin: SuiteOrigin(securityOrigin: message.frameInfo.securityOrigin), allowed: allowed) else {
            NSLog("Solid Suite: dropped a bridge message from a frame outside the suite origin")
            return
        }
        inner?.userContentController(userContentController, didReceive: message)
    }
}

/// Wraps Capacitor's `WKUIDelegate`: its JavaScript prompt handler doubles as a native channel
/// (CapacitorCookies get/set) that also ignores the calling frame. Prompts from anything but the
/// main frame on the suite origin get no answer; every other delegate call is forwarded unchanged.
final class UIDelegateOriginGuard: NSObject, WKUIDelegate {
    private weak var inner: (NSObject & WKUIDelegate)?
    private let allowed: SuiteOrigin

    init(inner: NSObject & WKUIDelegate, allowed: SuiteOrigin) {
        self.inner = inner
        self.allowed = allowed
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        return inner?.responds(to: aSelector) == true ? inner : nil
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard BridgeOriginGuard.allows(isMainFrame: frame.isMainFrame,
                                      origin: SuiteOrigin(securityOrigin: frame.securityOrigin), allowed: allowed),
              let inner = inner else {
            completionHandler(nil)
            return
        }
        if inner.responds(to: #selector(WKUIDelegate.webView(_:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))) {
            inner.webView?(webView, runJavaScriptTextInputPanelWithPrompt: prompt, defaultText: defaultText,
                           initiatedByFrame: frame, completionHandler: completionHandler)
        } else {
            completionHandler(nil)
        }
    }
}
