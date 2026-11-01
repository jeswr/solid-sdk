// AUTHORED-BY Claude Opus 5.5
import Foundation
import WebKit

/// Serves the bundled export for `capacitor://localhost` in bundled mode (MOB-P3 E4). Capacitor's
/// own handler hands its router an already-decoded path and types responses by the requested
/// URL's extension, so this handler validates the raw percent-encoded path, resolves it with
/// RouteResolver and answers with the resolved file's MIME type. Device-file requests
/// (`/_capacitor_file_`) are delegated to Capacitor's handler unchanged (E5).
final class SuiteSchemeHandler: NSObject, WKURLSchemeHandler {
    static let nativeFilePrefixes = ["/_capacitor_file_", "/_capacitor_content_"]

    /// The plain response the handler sends; separate from WebKit so tests can check it.
    struct Response: Equatable {
        let status: Int
        let headers: [String: String]
        let body: Data
    }

    private let capacitor: WKURLSchemeHandler
    private let resolver: RouteResolver
    private let root: URL
    /// Tasks handed to Capacitor, so a stop reaches the handler that started them (main thread only).
    private var delegated = Set<ObjectIdentifier>()

    init(capacitor: WKURLSchemeHandler, resolver: RouteResolver, root: URL) {
        self.capacitor = capacitor
        self.resolver = resolver
        self.root = root.standardizedFileURL
        super.init()
    }

    /// True when Capacitor would serve `decodedPath` as a device file (it matches with a prefix test).
    static func isNativeFilePath(_ decodedPath: String) -> Bool {
        nativeFilePrefixes.contains { decodedPath.hasPrefix($0) }
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        if SuiteSchemeHandler.isNativeFilePath(url.path) {
            delegated.insert(ObjectIdentifier(urlSchemeTask))
            capacitor.webView(webView, start: urlSchemeTask)
            return
        }
        let response = respond(method: urlSchemeTask.request.httpMethod ?? "GET", encodedPath: url.path(percentEncoded: true))
        guard let http = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1",
                                         headerFields: response.headers) else {
            urlSchemeTask.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        urlSchemeTask.didReceive(http)
        urlSchemeTask.didReceive(response.body)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        if delegated.remove(ObjectIdentifier(urlSchemeTask)) != nil {
            capacitor.webView(webView, stop: urlSchemeTask)
        }
    }

    /// Resolve and read one request. GET and HEAD only; the file must stay under the bundle root;
    /// a missing file is an empty 404 (never a fall-through to anything else).
    func respond(method: String, encodedPath: String) -> Response {
        let upper = method.uppercased()
        guard upper == "GET" || upper == "HEAD" else { return SuiteSchemeHandler.empty(405) }
        let resolution = resolver.resolve(encodedPath.isEmpty ? "/" : encodedPath)
        let file = root.appendingPathComponent(resolution.path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            return SuiteSchemeHandler.empty(404)
        }
        let mime = resolution.mimeType
        let textual = mime.hasPrefix("text/") || mime == "application/json"
            || mime == "application/manifest+json" || mime == "image/svg+xml"
        return Response(status: resolution.status, headers: [
            "Content-Type": textual ? "\(mime); charset=utf-8" : mime,
            "Content-Length": String(data.count),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
        ], body: upper == "HEAD" ? Data() : data)
    }

    static func empty(_ status: Int) -> Response {
        Response(status: status, headers: [
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Length": "0",
            "X-Content-Type-Options": "nosniff",
        ], body: Data())
    }
}

/// A web view configuration that wraps the handler Capacitor registers for its local scheme.
/// Capacitor sets its handler after `webViewConfiguration(for:)` returns and WebKit refuses a
/// second registration for a scheme, so the wrap happens at registration time.
final class SuiteBundledWebViewConfiguration: WKWebViewConfiguration {
    var wrapLocalHandler: ((WKURLSchemeHandler) -> WKURLSchemeHandler)?

    override func setURLSchemeHandler(_ urlSchemeHandler: (any WKURLSchemeHandler)?, forURLScheme urlScheme: String) {
        if let handler = urlSchemeHandler, urlScheme.lowercased() == SuiteOrigin.bundledScheme,
           let wrap = wrapLocalHandler {
            super.setURLSchemeHandler(wrap(handler), forURLScheme: urlScheme)
        } else {
            super.setURLSchemeHandler(urlSchemeHandler, forURLScheme: urlScheme)
        }
    }

    /// Copies what Capacitor's `webViewConfiguration(for:)` sets onto a new instance of this class.
    static func adopting(_ base: WKWebViewConfiguration) -> SuiteBundledWebViewConfiguration {
        let config = SuiteBundledWebViewConfiguration()
        config.processPool = base.processPool
        config.websiteDataStore = base.websiteDataStore
        config.preferences = base.preferences
        config.defaultWebpagePreferences = base.defaultWebpagePreferences
        config.userContentController = base.userContentController
        config.allowsInlineMediaPlayback = base.allowsInlineMediaPlayback
        config.suppressesIncrementalRendering = base.suppressesIncrementalRendering
        config.allowsAirPlayForMediaPlayback = base.allowsAirPlayForMediaPlayback
        config.mediaTypesRequiringUserActionForPlayback = base.mediaTypesRequiringUserActionForPlayback
        config.limitsNavigationsToAppBoundDomains = base.limitsNavigationsToAppBoundDomains
        config.applicationNameForUserAgent = base.applicationNameForUserAgent
        return config
    }
}
