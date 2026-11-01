// AUTHORED-BY Claude Opus 5.5
import Foundation
import WebKit

/// Exact-origin rules shared by the bridge guard and the navigation guard (DESIGN D2, D3).
struct SuiteOrigin: Equatable {
    let scheme: String
    let host: String
    let port: Int

    init?(url: URL?) {
        guard let url = url, let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              scheme == "https" || scheme == "http", url.user == nil, url.password == nil else {
            return nil
        }
        self.scheme = scheme
        self.host = host
        self.port = url.port ?? (scheme == "https" ? 443 : 80)
    }

    init?(securityOrigin: WKSecurityOrigin) {
        let scheme = securityOrigin.protocol.lowercased()
        guard scheme == "https" || scheme == "http" else { return nil }
        self.scheme = scheme
        self.host = securityOrigin.host.lowercased()
        self.port = securityOrigin.port == 0 ? (scheme == "https" ? 443 : 80) : securityOrigin.port
    }

    /// Schemes the app may hand to another app when a link leaves the suite.
    static func mayOpenExternally(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return ["https", "http", "mailto", "tel"].contains(scheme)
    }
}
