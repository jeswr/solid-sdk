// AUTHORED-BY Claude Opus 5.5
import Foundation
import WebKit

/// Serves the bundled export for `capacitor://localhost` in bundled mode (MOB-P3 E4). Capacitor's
/// own handler hands its router an already-decoded path and types responses by the requested
/// URL's extension, so this handler validates the raw percent-encoded path, resolves it with
/// RouteResolver and answers with the resolved file's MIME type. Device-file requests
/// (`/_capacitor_file_`) go to Capacitor's handler through SandboxedFileTask, which lets only
/// image, audio and video responses through, with a CSP sandbox and nosniff (E5). Any host but
/// `localhost` (without a port) is refused, so no second local origin exists.
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
    /// Device-file tasks handed to Capacitor, by WebKit's task, until they finish or stop.
    private var delegated: [ObjectIdentifier: SandboxedFileTask] = [:]
    private let lock = NSLock()

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
        let response: Response
        if !SuiteSchemeHandler.isLocalHost(url) {
            response = SuiteSchemeHandler.empty(403)
        } else if SuiteSchemeHandler.isNativeFilePath(url.path) {
            let key = ObjectIdentifier(urlSchemeTask)
            let task = SandboxedFileTask(urlSchemeTask) { [weak self] in self?.forget(key) }
            lock.lock()
            delegated[key] = task
            lock.unlock()
            capacitor.webView(webView, start: task)
            return
        } else {
            response = respond(method: urlSchemeTask.request.httpMethod ?? "GET", encodedPath: url.path(percentEncoded: true))
        }
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
        lock.lock()
        let task = delegated.removeValue(forKey: ObjectIdentifier(urlSchemeTask))
        lock.unlock()
        guard let task else { return }
        task.stop()
        capacitor.webView(webView, stop: task)
    }

    private func forget(_ key: ObjectIdentifier) {
        lock.lock()
        delegated.removeValue(forKey: key)
        lock.unlock()
    }

    /// Only `localhost`, with no port, is the bundled origin's host.
    static func isLocalHost(_ url: URL) -> Bool {
        url.host?.lowercased() == SuiteOrigin.bundledHost && url.port == nil
    }

    /// Device files are served only as images, audio or video (E5). SVG can carry script.
    static func nativeFileTypeAllowed(_ mimeType: String?) -> Bool {
        guard let raw = mimeType else { return false }
        let type = (raw.split(separator: ";", maxSplits: 1).first.map(String.init) ?? "")
            .trimmingCharacters(in: .whitespaces).lowercased()
        if type == "image/svg+xml" { return false }
        return type.hasPrefix("image/") || type.hasPrefix("audio/") || type.hasPrefix("video/")
    }

    /// The device file's response with a CSP sandbox and nosniff (any existing values replaced).
    static func sandboxed(_ response: URLResponse) -> URLResponse {
        guard let url = response.url else { return response }
        var headers: [String: String] = [:]
        if let http = response as? HTTPURLResponse {
            for (key, value) in http.allHeaderFields {
                guard let name = key as? String, let text = value as? String else { continue }
                let lower = name.lowercased()
                if lower == "content-security-policy" || lower == "x-content-type-options" { continue }
                headers[name] = text
            }
        } else if let mime = response.mimeType {
            headers["Content-Type"] = mime
        }
        headers["Content-Security-Policy"] = "sandbox"
        headers["X-Content-Type-Options"] = "nosniff"
        let status = (response as? HTTPURLResponse)?.statusCode ?? 200
        return HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) ?? response
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

/// Stands between WebKit's task and Capacitor's handler for one device file. A response that is
/// not image, audio or video becomes an empty 403; others gain the sandbox headers. After a stop,
/// a refusal or the end of the response, nothing more reaches WebKit (which raises on a stopped task).
final class SandboxedFileTask: NSObject, WKURLSchemeTask {
    private let inner: WKURLSchemeTask
    private let onClose: () -> Void
    private let lock = NSLock()
    private var open = true

    init(_ inner: WKURLSchemeTask, onClose: @escaping () -> Void) {
        self.inner = inner
        self.onClose = onClose
    }

    var request: URLRequest { inner.request }

    func didReceive(_ response: URLResponse) {
        lock.lock()
        defer { lock.unlock() }
        guard open else { return }
        guard SuiteSchemeHandler.nativeFileTypeAllowed(response.mimeType), response.url != nil else {
            let refusal = SuiteSchemeHandler.empty(403)
            if let url = response.url ?? inner.request.url,
               let http = HTTPURLResponse(url: url, statusCode: refusal.status, httpVersion: "HTTP/1.1",
                                          headerFields: refusal.headers) {
                inner.didReceive(http)
                inner.didFinish()
            } else {
                inner.didFailWithError(URLError(.cannotParseResponse))
            }
            close()
            return
        }
        inner.didReceive(SuiteSchemeHandler.sandboxed(response))
    }

    func didReceive(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        if open { inner.didReceive(data) }
    }

    func didFinish() {
        lock.lock()
        defer { lock.unlock() }
        guard open else { return }
        inner.didFinish()
        close()
    }

    func didFailWithError(_ error: Error) {
        lock.lock()
        defer { lock.unlock() }
        guard open else { return }
        inner.didFailWithError(error)
        close()
    }

    /// WebKit stopped the task; Capacitor may still call back.
    func stop() {
        lock.lock()
        open = false
        lock.unlock()
    }

    private func close() {
        open = false
        onClose()
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
