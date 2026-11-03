// AUTHORED-BY Claude Opus 5.5
import Foundation
import WebKit

/// Exact-origin rules shared by the bridge guard and the navigation guard (DESIGN D2, D3). In
/// bundled mode (MOB-P3 E6) the trusted origin is the app's own `capacitor://localhost`.
struct SuiteOrigin: Equatable {
    /// The bundled local origin, served only by SuiteSchemeHandler.
    static let bundledScheme = "capacitor"
    static let bundledHost = "localhost"

    let scheme: String
    let host: String
    let port: Int

    private init(scheme: String, host: String, port: Int) {
        self.scheme = scheme
        self.host = host
        self.port = port
    }

    /// An http(s) origin; any other scheme (including the bundled one) is nil.
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
        self.init(securityScheme: securityOrigin.protocol, host: securityOrigin.host, port: securityOrigin.port)
    }

    /// A frame's security origin: http(s), or exactly the bundled `capacitor://localhost` (port 0).
    init?(securityScheme: String, host: String, port: Int) {
        let scheme = securityScheme.lowercased()
        let host = host.lowercased()
        if scheme == SuiteOrigin.bundledScheme {
            guard host == SuiteOrigin.bundledHost, port == 0 else { return nil }
            self.init(scheme: scheme, host: host, port: 0)
            return
        }
        guard scheme == "https" || scheme == "http" else { return nil }
        self.init(scheme: scheme, host: host, port: port == 0 ? (scheme == "https" ? 443 : 80) : port)
    }

    /// Exactly `capacitor://localhost` (any path), with no port or credentials; otherwise nil.
    static func local(_ url: URL?) -> SuiteOrigin? {
        guard let url = url, url.scheme?.lowercased() == bundledScheme, url.host?.lowercased() == bundledHost,
              url.port == nil, url.user == nil, url.password == nil else {
            return nil
        }
        return SuiteOrigin(scheme: bundledScheme, host: bundledHost, port: 0)
    }

    /// The origin of a navigation target, for comparison with the trusted app origin.
    static func of(_ url: URL?) -> SuiteOrigin? {
        SuiteOrigin(url: url) ?? local(url)
    }

    /// The trusted app origin: `server.url` when it is http(s) (remote mode), else the local
    /// origin when Capacitor has no remote server, so its serverURL is its localURL (bundled mode).
    static func app(serverURL: URL?, localURL: URL?) -> SuiteOrigin? {
        if let remote = SuiteOrigin(url: serverURL) { return remote }
        guard let serverURL = serverURL, serverURL == localURL else { return nil }
        return local(serverURL)
    }

    /// True when the configuration is bundled mode (no remote server).
    static func isBundled(serverURL: URL?, localURL: URL?) -> Bool {
        SuiteOrigin(url: serverURL) == nil && app(serverURL: serverURL, localURL: localURL) != nil
    }

    /// Schemes the app may hand to another app when a link leaves the suite.
    static func mayOpenExternally(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return ["https", "http", "mailto", "tel"].contains(scheme)
    }
}
