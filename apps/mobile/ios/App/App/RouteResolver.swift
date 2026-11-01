// AUTHORED-BY Claude Opus 5.5
import Foundation

/// Bundled-mode route resolution (MOB-P3 E3): maps a raw, still percent-encoded request path to a
/// file in the static export, using the build-time `route-manifest.json`. A port of
/// `apps/suite/scripts/route-resolver.mjs`; both run the shared vectors in
/// `apps/mobile/test/vectors/routes.json`. It never lists directories and never guesses from a
/// path's shape: a path either matches a whole route (or an exact asset) or is 404.
struct RouteResolver {
    static let maxPathBytes = 2048
    static let notFoundPath = "404.html"

    enum Segment: Equatable {
        case fixed(String)
        case param
        case catchAll(optional: Bool)
    }

    struct Route {
        let segments: [Segment]
        let directory: String
        let files: Set<String>
    }

    /// The bundle file to serve, its status, and the MIME type of the resolved file.
    struct Resolution: Equatable {
        let path: String
        let status: Int
        var mimeType: String { RouteResolver.mimeType(path) }
    }

    enum ManifestError: Error {
        case invalid
    }

    let routes: [Route]
    let assets: Set<String>

    init(routes: [Route], assets: Set<String>) {
        self.routes = routes
        self.assets = assets
    }

    /// Parse `route-manifest.json`; any shape error rejects the whole manifest.
    init(manifest data: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = object["version"] as? Int, version == 1,
              let routeArray = object["routes"] as? [[String: Any]],
              let assetArray = object["assets"] as? [String]
        else { throw ManifestError.invalid }
        var routes: [Route] = []
        for route in routeArray {
            guard let segmentArray = route["segments"] as? [[String: Any]],
                  let directory = route["directory"] as? String,
                  let files = route["files"] as? [String]
            else { throw ManifestError.invalid }
            var segments: [Segment] = []
            for segment in segmentArray {
                switch segment["type"] as? String {
                case "static":
                    guard let value = segment["value"] as? String else { throw ManifestError.invalid }
                    segments.append(.fixed(value))
                case "param":
                    segments.append(.param)
                case "catch-all":
                    segments.append(.catchAll(optional: segment["optional"] as? Bool ?? false))
                default:
                    throw ManifestError.invalid
                }
            }
            routes.append(Route(segments: segments, directory: directory, files: Set(files)))
        }
        self.init(routes: routes, assets: Set(assetArray))
    }

    /// Resolve a raw encoded path (as from `URL.path(percentEncoded: true)`); never throws.
    func resolve(_ encodedPath: String) -> Resolution {
        guard let values = RouteResolver.requestSegments(encodedPath) else { return RouteResolver.notFound }
        let exact = values.joined(separator: "/")
        if assets.contains(exact) { return Resolution(path: exact, status: 200) }
        let last = values.last ?? ""
        let transport = RouteResolver.reservedSuffix(last)
        let routeValues = transport ? Array(values.dropLast()) : values
        let file = transport ? last : "index.html"
        var best: (route: Route, rank: [Int])?
        for route in routes where route.files.contains(file) {
            guard let rank = RouteResolver.matchRoute(route, routeValues) else { continue }
            if best == nil || RouteResolver.compareRank(rank, best!.rank) > 0 {
                best = (route, rank)
            }
        }
        guard let match = best else { return RouteResolver.notFound }
        let path = match.route.directory.isEmpty ? file : "\(match.route.directory)/\(file)"
        return Resolution(path: path, status: 200)
    }

    static let notFound = Resolution(path: notFoundPath, status: 404)

    /// Exported transport file names: never a route parameter (E3).
    static func reservedSuffix(_ name: String) -> Bool {
        if name == "index.html" || name == "index.txt" { return true }
        return name.hasPrefix("__next.") && name.hasSuffix(".txt") && name.count > "__next.".count + ".txt".count
    }

    private static let fixedRank = 3
    private static let paramRank = 2
    private static let catchAllRank = 1

    /// The per-segment precedence rank of a complete match, or nil for no match.
    static func matchRoute(_ route: Route, _ values: [String]) -> [Int]? {
        var index = 0
        var rank: [Int] = []
        for segment in route.segments {
            switch segment {
            case let .catchAll(optional):
                if index == values.count && !optional { return nil }
                while index < values.count {
                    rank.append(catchAllRank)
                    index += 1
                }
            case let .fixed(value):
                if index == values.count || values[index] != value { return nil }
                rank.append(fixedRank)
                index += 1
            case .param:
                if index == values.count { return nil }
                rank.append(paramRank)
                index += 1
            }
        }
        return index == values.count ? rank : nil
    }

    /// Static beats param beats catch-all at the earliest differing segment.
    static func compareRank(_ left: [Int], _ right: [Int]) -> Int {
        for i in 0..<max(left.count, right.count) {
            let l = i < left.count ? left[i] : fixedRank
            let r = i < right.count ? right[i] : fixedRank
            if l != r { return l - r }
        }
        return 0
    }

    /// Validate the raw path before decoding each segment exactly once. Rejects (nil) relative
    /// paths, paths over 2,048 UTF-8 bytes, backslashes, NUL, query or fragment characters,
    /// encoded slash/backslash/NUL, malformed escapes or UTF-8, and empty, `.` or `..` segments.
    /// A trailing slash is dropped.
    static func requestSegments(_ path: String) -> [String]? {
        guard path.hasPrefix("/"), path.utf8.count <= maxPathBytes else { return nil }
        if path.unicodeScalars.contains(where: { $0 == "\\" || $0 == "\0" || $0 == "?" || $0 == "#" }) {
            return nil
        }
        let lower = path.lowercased()
        if lower.contains("%2f") || lower.contains("%5c") || lower.contains("%00") { return nil }
        var parts = path.dropFirst().split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if parts.last == "" { parts.removeLast() }
        var decoded: [String] = []
        for part in parts {
            guard let value = decodeSegment(part), !value.isEmpty, value != ".", value != "..",
                  !value.unicodeScalars.contains(where: { $0 == "\\" || $0 == "/" || $0 == "\0" })
            else { return nil }
            decoded.append(value)
        }
        return decoded
    }

    /// decodeURIComponent semantics: strict escapes and strict UTF-8; "+" stays "+".
    static func decodeSegment(_ segment: String) -> String? {
        let raw = Array(segment.utf8)
        var bytes: [UInt8] = []
        bytes.reserveCapacity(raw.count)
        var i = 0
        while i < raw.count {
            if raw[i] != UInt8(ascii: "%") {
                bytes.append(raw[i])
                i += 1
                continue
            }
            guard i + 2 < raw.count, let high = hexValue(raw[i + 1]), let low = hexValue(raw[i + 2]) else {
                return nil
            }
            bytes.append(high << 4 | low)
            i += 3
        }
        // Lossy decoding replaces invalid UTF-8 (overlong forms, surrogates, truncation) with
        // U+FFFD, so a round trip that changes the bytes means the input was not valid UTF-8.
        let value = String(decoding: bytes, as: UTF8.self)
        return Array(value.utf8) == bytes ? value : nil
    }

    private static func hexValue(_ byte: UInt8) -> UInt8? {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return byte - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return byte - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): return byte - UInt8(ascii: "A") + 10
        default: return nil
        }
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html",
        // Next's static-export client accepts text/plain as Flight data.
        "txt": "text/plain",
        "js": "text/javascript",
        "mjs": "text/javascript",
        "css": "text/css",
        "json": "application/json",
        "map": "application/json",
        "webmanifest": "application/manifest+json",
        "wasm": "application/wasm",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "avif": "image/avif",
        "ico": "image/x-icon",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
        "otf": "font/otf",
    ]

    /// The MIME type of a resolved bundle file, from its own extension (never the request's).
    static func mimeType(_ path: String) -> String {
        let name = path.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? path
        guard let dot = name.lastIndex(of: "."), dot != name.startIndex else {
            return "application/octet-stream"
        }
        let ext = name[name.index(after: dot)...].lowercased()
        return mimeTypes[ext] ?? "application/octet-stream"
    }
}
