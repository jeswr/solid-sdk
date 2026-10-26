// AUTHORED-BY Claude Opus 5.5
import AuthenticationServices
import Capacitor
import UIKit

/// The system-browser leg of Solid-OIDC sign-in (DESIGN D4) on ASWebAuthenticationSession. Protocol
/// checks (state, PKCE, iss) happen in @jeswr/suite-native; this side validates its inputs too.
@objc(SuiteAuthSessionPlugin)
public class SuiteAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "SuiteAuthSessionPlugin"
    public let jsName = "SuiteAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    static let callbackScheme = "org.jeswr.suite"
    static let callbackPath = "/oauth/callback"
    private var session: ASWebAuthenticationSession?

    @objc func authenticate(_ call: CAPPluginCall) {
        guard call.getString("callbackScheme") == Self.callbackScheme else {
            call.reject("Unsupported callback scheme", "INVALID_ARGUMENT")
            return
        }
        guard let raw = call.getString("url"), let url = URL(string: raw), Self.isAuthorizationURL(url) else {
            call.reject("Authorization URL must be https", "INVALID_ARGUMENT")
            return
        }
        DispatchQueue.main.async {
            guard self.session == nil else {
                call.reject("A sign-in is already in progress", "BUSY")
                return
            }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.callbackScheme) { callback, error in
                DispatchQueue.main.async {
                    self.session = nil
                    if let callback = callback, Self.isCallback(callback) {
                        call.resolve(["url": callback.absoluteString])
                    } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                        call.reject("Sign-in was cancelled", "USER_CANCELLED")
                    } else if error == nil {
                        call.reject("Unexpected callback", "INVALID_CALLBACK")
                    } else {
                        call.reject("The system browser sign-in failed", "NATIVE_ERROR")
                    }
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Could not start the sign-in session", "NATIVE_ERROR")
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // The pending authenticate call then completes with canceledLogin.
            self.session?.cancel()
            call.resolve()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }

    static func isAuthorizationURL(_ url: URL) -> Bool {
        guard url.host != nil, url.user == nil, url.password == nil else { return false }
        if url.scheme == "https" { return true }
        #if DEBUG
        return url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host ?? "")
        #else
        return false
        #endif
    }

    /// Exact scheme, empty authority, path /oauth/callback, no fragment (DESIGN D5).
    static func isCallback(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return components.scheme == callbackScheme
            && (components.host ?? "").isEmpty
            && components.percentEncodedPath == callbackPath
            && components.fragment == nil
    }
}
