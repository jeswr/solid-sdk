// AUTHORED-BY Claude Opus 5.5
import Foundation

/// Pending share batches in the App Group container (DESIGN D7): share/<uuid>/{batch.json, item-N}.
/// Compiled into the app and the Share Extension. Caps match the Android ShareStore. The manifest is
/// written last and atomically, so a batch without one is a copy in progress (or a killed one).
struct ShareStore {
    static let appGroup = "group.org.jeswr.suite"
    static let maxItemBytes: Int64 = 100 * 1024 * 1024
    static let maxBatchBytes: Int64 = 200 * 1024 * 1024
    static let maxPendingBytes: Int64 = 500 * 1024 * 1024
    static let maxItems = 20
    static let maxPendingBatches = 10
    static let maxTextChars = 100_000
    static let maxTitleChars = 1000
    static let maxChunkBytes = 512 * 1024
    static let maxAge: TimeInterval = 7 * 24 * 60 * 60
    private static let manifestName = "batch.json"
    /// Held (flock) by the process copying a batch; a copy whose holder died is abandoned.
    private static let writerName = ".writing"

    /// Calls `body` with a readable file URL that is valid only during the call.
    typealias FileSource = (_ body: @escaping (URL) throws -> Void) throws -> Void

    enum Incoming {
        case file(name: String?, mimeType: String?, source: FileSource)
        case url(String, title: String?)
        case text(String)
    }

    enum Failure: Error {
        case rejected(String)
        case notFound
    }

    struct Batch {
        let id: String
        let receivedAt: Date
        /// The batch exactly as JavaScript receives it: `{ id, receivedAt, items }`.
        let json: [String: Any]

        var items: [[String: Any]] { json["items"] as? [[String: Any]] ?? [] }
    }

    let root: URL

    /// The store in the App Group container, or nil when the entitlement is missing.
    static func shared() -> ShareStore? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            return nil
        }
        return ShareStore(root: container.appendingPathComponent("share", isDirectory: true))
    }

    // MARK: Validation shared with @jeswr/suite-native

    /// Reduces an untrusted file name to one safe path segment.
    static func sanitiseName(_ raw: String?) -> String {
        let unsafe = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\"))
        var cleaned = String(String.UnicodeScalarView((raw ?? "").unicodeScalars.map { unsafe.contains($0) ? "_" : $0 }))
        while let first = cleaned.unicodeScalars.first, first == "." || CharacterSet.whitespacesAndNewlines.contains(first) {
            cleaned.removeFirst()
        }
        cleaned = String(cleaned.trimmingCharacters(in: .whitespacesAndNewlines).prefix(255))
        return cleaned.isEmpty ? "shared-file" : cleaned
    }

    private static let mimePattern = try! NSRegularExpression(
        pattern: "^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")

    static func sanitiseMime(_ raw: String?) -> String {
        let lower = (raw ?? "").lowercased()
        let range = NSRange(lower.startIndex..., in: lower)
        return mimePattern.firstMatch(in: lower, range: range) == nil ? "application/octet-stream" : lower
    }

    /// The http(s) URL, or nil when it is not one or carries credentials.
    static func httpURL(_ raw: String?) -> String? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              let components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              let url = components.url else { return nil }
        return url.absoluteString
    }

    private static let idPattern = try! NSRegularExpression(
        pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    static func isBatchId(_ id: String?) -> Bool {
        guard let id = id else { return false }
        return idPattern.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil
    }

    private static func iso() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }

    // MARK: Locking

    /// Runs `body` holding an exclusive flock on share/.lock, which the app and the extension share,
    /// so publishing, quota eviction and acknowledgement never interleave across processes.
    @discardableResult
    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let fd = open(root.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0 else { return try body() }
        defer { close(fd) }
        flock(fd, LOCK_EX)
        defer { flock(fd, LOCK_UN) }
        return try body()
    }

    // MARK: Storing

    /// Copies the items into a new batch, enforcing every cap while copying. Nothing is kept on failure.
    func store(_ items: [Incoming], now: Date = Date()) throws -> Batch {
        guard !items.isEmpty else { throw Failure.rejected("no items") }
        guard items.count <= Self.maxItems else { throw Failure.rejected("too many items") }
        evict(now: now)
        let id = UUID().uuidString.lowercased()
        let dir = root.appendingPathComponent(id, isDirectory: true)
        let fm = FileManager.default
        // Created and claimed under the store lock, so evictors never see an unclaimed live copy.
        let writer: Int32 = try locked {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let fd = open(dir.appendingPathComponent(Self.writerName).path, O_CREAT | O_RDWR, 0o600)
            guard fd >= 0, flock(fd, LOCK_EX | LOCK_NB) == 0 else {
                if fd >= 0 { close(fd) }
                try? fm.removeItem(at: dir)
                throw Failure.rejected("cannot claim the batch")
            }
            return fd
        }
        defer { close(writer) }
        do {
            var batchBytes: Int64 = 0
            var json: [[String: Any]] = []
            for (index, item) in items.enumerated() {
                switch item {
                case let .file(name, mimeType, source):
                    let target = dir.appendingPathComponent("item-\(index)")
                    var written: Int64 = 0
                    try source { url in
                        written = try Self.copy(from: url, to: target, limit: min(Self.maxItemBytes, Self.maxBatchBytes - batchBytes))
                    }
                    batchBytes += written
                    json.append(["kind": "file", "name": Self.sanitiseName(name), "mimeType": Self.sanitiseMime(mimeType),
                                 "size": NSNumber(value: written)])
                case let .url(raw, title):
                    guard let url = Self.httpURL(raw) else { throw Failure.rejected("url must be http(s) without credentials") }
                    var entry: [String: Any] = ["kind": "url", "url": url]
                    if let title = title { entry["title"] = String(title.prefix(Self.maxTitleChars)) }
                    json.append(entry)
                case let .text(text):
                    guard text.utf16.count <= Self.maxTextChars else { throw Failure.rejected("text too long") }
                    json.append(["kind": "text", "text": text])
                }
            }
            let manifest: [String: Any] = ["id": id, "receivedAt": Self.iso().string(from: now), "items": json]
            let data = try JSONSerialization.data(withJSONObject: manifest)
            try locked {
                try data.write(to: dir.appendingPathComponent(Self.manifestName), options: .atomic)
                guard evictOverflow(keeping: id) else { throw Failure.rejected("no room for the share") }
            }
            return Batch(id: id, receivedAt: now, json: manifest)
        } catch {
            locked { try? fm.removeItem(at: dir) }
            throw error
        }
    }

    private static func copy(from source: URL, to target: URL, limit: Int64) throws -> Int64 {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        guard FileManager.default.createFile(atPath: target.path, contents: nil) else { throw Failure.rejected("cannot write") }
        let output = try FileHandle(forWritingTo: target)
        defer { try? output.close() }
        var total: Int64 = 0
        while true {
            let chunk = try autoreleasepool { try input.read(upToCount: 64 * 1024) } ?? Data()
            if chunk.isEmpty { break }
            total += Int64(chunk.count)
            if total > limit { throw Failure.rejected("share is too large") }
            try output.write(contentsOf: chunk)
        }
        return total
    }

    // MARK: Reading

    /// Valid pending batches, oldest first. Broken manifests are deleted.
    func pending() -> [Batch] {
        batchIds().compactMap { load($0) }.sorted { $0.receivedAt < $1.receivedAt }
    }

    /// Up to `length` bytes (capped at 512 KiB) of file item `index`, and whether that reaches its end.
    func readChunk(batchId: String, index: Int, offset: Int64, length: Int) throws -> (data: Data, eof: Bool) {
        guard let batch = load(batchId), index >= 0, index < batch.items.count,
              batch.items[index]["kind"] as? String == "file", offset >= 0, length >= 0 else { throw Failure.notFound }
        let file = root.appendingPathComponent(batchId, isDirectory: true).appendingPathComponent("item-\(index)")
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let end = try handle.seekToEnd()
        let size = Int64(end)
        guard offset < size else { return (Data(), true) }
        try handle.seek(toOffset: UInt64(offset))
        let data = try handle.read(upToCount: min(length, Self.maxChunkBytes)) ?? Data()
        return (data, offset + Int64(data.count) >= size)
    }

    func acknowledge(_ batchId: String?) {
        guard Self.isBatchId(batchId), let batchId = batchId else { return }
        locked { remove(batchId) }
    }

    private func remove(_ batchId: String) {
        try? FileManager.default.removeItem(at: root.appendingPathComponent(batchId, isDirectory: true))
    }

    // MARK: Eviction

    /// Drops batches older than seven days and copies a killed extension left without a manifest.
    func evict(now: Date = Date()) {
        locked { evictExpired(now: now) }
    }

    private func evictExpired(now: Date) {
        dropAbandoned()
        for batch in pending() where now.timeIntervalSince(batch.receivedAt) > Self.maxAge {
            remove(batch.id)
        }
    }

    /// Deletes copies without a manifest whose writer no longer holds `.writing`. Caller holds the lock.
    private func dropAbandoned() {
        let fm = FileManager.default
        for id in batchIds() {
            let dir = root.appendingPathComponent(id, isDirectory: true)
            guard !fm.fileExists(atPath: dir.appendingPathComponent(Self.manifestName).path) else { continue }
            let fd = open(dir.appendingPathComponent(Self.writerName).path, O_RDWR)
            if fd < 0 {
                try? fm.removeItem(at: dir)
                continue
            }
            if flock(fd, LOCK_EX | LOCK_NB) == 0 { try? fm.removeItem(at: dir) }
            close(fd)
        }
    }

    /// Deletes abandoned copies, then the oldest batches (never `keeping`), until at most 10 batches
    /// and 500 MB remain; copies in progress count towards the bytes. False when that cannot be
    /// reached, so the caller drops `keeping`. Caller holds the lock.
    private func evictOverflow(keeping: String) -> Bool {
        dropAbandoned()
        let batches = pending()
        var sizes: [String: Int64] = [:]
        for id in batchIds() { sizes[id] = bytes(id) }
        var total = sizes.values.reduce(0, +)
        var count = batches.count
        for batch in batches {
            if count <= Self.maxPendingBatches && total <= Self.maxPendingBytes { break }
            if batch.id == keeping { continue }
            total -= sizes[batch.id] ?? 0
            count -= 1
            remove(batch.id)
        }
        return count <= Self.maxPendingBatches && total <= Self.maxPendingBytes
    }

    private func bytes(_ id: String) -> Int64 {
        let dir = root.appendingPathComponent(id, isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return files.reduce(Int64(0)) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }

    private func batchIds() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return names.filter { Self.isBatchId($0) }
    }

    private func load(_ id: String) -> Batch? {
        guard Self.isBatchId(id) else { return nil }
        let dir = root.appendingPathComponent(id, isDirectory: true)
        guard let data = FileManager.default.contents(atPath: dir.appendingPathComponent(Self.manifestName).path) else {
            return nil
        }
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              json["id"] as? String == id,
              let stamp = json["receivedAt"] as? String, let receivedAt = Self.iso().date(from: stamp),
              json["items"] is [[String: Any]] else {
            try? FileManager.default.removeItem(at: dir)
            return nil
        }
        return Batch(id: id, receivedAt: receivedAt, json: json)
    }
}
