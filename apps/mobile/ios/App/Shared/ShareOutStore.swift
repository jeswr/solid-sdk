// AUTHORED-BY GPT-5.6 Codex
import Foundation

/// Outgoing files in tmp/share-out/<uuid>/<name>. The plugin owns one instance on a serial queue.
/// Active writes reserve their declared size; committed files survive chooser dismissal and restart.
final class ShareOutStore {
    static let maxBytes: Int64 = 100 * 1024 * 1024
    static let maxFiles = 20
    static let maxChunkBytes = 512 * 1024
    static let maxAge: TimeInterval = 24 * 60 * 60
    enum Failure: Error { case invalid, busy, notFound }

    private struct Upload {
        let file: URL
        let size: Int64
        var written: Int64 = 0
    }
    private let root: URL
    private let fm = FileManager.default
    private var uploads = [String: Upload]()

    init(root: URL = FileManager.default.temporaryDirectory.appendingPathComponent("share-out", isDirectory: true)) throws {
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
        try fm.createDirectory(at: self.root, withIntermediateDirectories: true)
    }

    static func isId(_ id: String) -> Bool {
        return id.count == 36 && UUID(uuidString: id)?.uuidString.lowercased() == id
    }

    private static func safeName(_ raw: String) -> String {
        let unsafe = CharacterSet(charactersIn: "/\\").union(.controlCharacters)
        var name = String(String.UnicodeScalarView(raw.unicodeScalars.map { unsafe.contains($0) ? "_" : $0 }))
        while let first = name.unicodeScalars.first, first == "." || CharacterSet.whitespacesAndNewlines.contains(first) {
            name.removeFirst()
        }
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        while name.utf8.count > 255 { name.removeLast() }
        return name.isEmpty ? "shared-file" : name
    }

    func begin(name: String, mimeType: String, size: Int64, now: Date = Date()) throws -> String {
        guard name.utf8.count <= 16384, mimeType.utf8.count <= 255,
              mimeType.range(of: "^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*/[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\\z", options: .regularExpression) != nil,
              size >= 0, size <= Self.maxBytes else { throw Failure.invalid }
        try evict(now: now)
        let dirs = try directories().sorted { (try modified($0)) < (try modified($1)) }
        var reserved: Int64 = 0
        for dir in dirs { reserved += try reservedBytes(dir) }
        var count = dirs.count
        for dir in dirs {
            if count < Self.maxFiles && reserved <= Self.maxBytes - size { break }
            if uploads[dir.lastPathComponent] != nil { continue }
            reserved -= try reservedBytes(dir)
            try fm.removeItem(at: dir)
            count -= 1
        }
        guard count < Self.maxFiles, reserved <= Self.maxBytes - size else { throw Failure.busy }
        let id = UUID().uuidString.lowercased()
        let dir = root.appendingPathComponent(id, isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: false)
        do {
            let file = dir.appendingPathComponent(Self.safeName(name))
            guard fm.createFile(atPath: file.path, contents: Data()) else { throw Failure.invalid }
            try fm.setAttributes([.modificationDate: now], ofItemAtPath: dir.path)
            uploads[id] = Upload(file: file, size: size)
            return id
        } catch { try? fm.removeItem(at: dir); throw error }
    }

    func writeChunk(id: String, offset: Int64, data: Data, now: Date = Date()) throws {
        do {
            try evict(now: now)
            var entry = try upload(id)
            guard !data.isEmpty, data.count <= Self.maxChunkBytes, offset == entry.written,
                  Int64(data.count) <= entry.size - offset else { throw Failure.invalid }
            let handle = try FileHandle(forWritingTo: entry.file)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
            entry.written += Int64(data.count)
            uploads[id] = entry
        } catch { try? abort(id); throw error }
    }

    func commit(id: String, now: Date = Date()) throws -> URL {
        do {
            try evict(now: now)
            let entry = try upload(id)
            guard entry.written == entry.size else { throw Failure.invalid }
            try fm.setAttributes([.modificationDate: now], ofItemAtPath: entry.file.deletingLastPathComponent().path)
            uploads.removeValue(forKey: id)
            // @capacitor/share 8.0.3 passes URL(string:) directly to UIActivityViewController.
            return entry.file
        } catch { try? abort(id); throw error }
    }

    func abort(_ id: String) throws {
        guard Self.isId(id) else { return }
        uploads.removeValue(forKey: id)
        let dir = root.appendingPathComponent(id, isDirectory: true)
        if fm.fileExists(atPath: dir.path) { try fm.removeItem(at: dir) }
    }

    func evict(now: Date = Date()) throws {
        for dir in try directories() where now.timeIntervalSince(try modified(dir)) > Self.maxAge {
            try abort(dir.lastPathComponent)
        }
        let dirs = try directories().sorted { (try modified($0)) < (try modified($1)) }
        var total: Int64 = 0
        for dir in dirs { total += try reservedBytes(dir) }
        var count = dirs.count
        for dir in dirs {
            if count <= Self.maxFiles && total <= Self.maxBytes { break }
            if uploads[dir.lastPathComponent] != nil { continue }
            total -= try reservedBytes(dir)
            try fm.removeItem(at: dir)
            count -= 1
        }
        guard count <= Self.maxFiles, total <= Self.maxBytes else { throw Failure.busy }
    }

    private func upload(_ id: String) throws -> Upload {
        guard Self.isId(id), let entry = uploads[id],
              try safe(entry.file.deletingLastPathComponent()), try safe(entry.file),
              try regularSize(entry.file) == entry.written else { throw Failure.notFound }
        return entry
    }

    private func safe(_ url: URL) throws -> Bool {
        return try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == false &&
            url.resolvingSymlinksInPath().standardizedFileURL.path == url.standardizedFileURL.path
    }

    private func directories() throws -> [URL] {
        var dirs = [URL]()
        for url in try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey]) {
            guard Self.isId(url.lastPathComponent), try safe(url),
                  try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
                try fm.removeItem(at: url)
                continue
            }
            dirs.append(url)
        }
        return dirs
    }

    private func modified(_ url: URL) throws -> Date {
        guard let date = try fm.attributesOfItem(atPath: url.path)[.modificationDate] as? Date else { throw Failure.invalid }
        return date
    }

    private func regularSize(_ url: URL) throws -> Int64 {
        let attrs = try fm.attributesOfItem(atPath: url.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular,
              let size = attrs[.size] as? NSNumber else { throw Failure.invalid }
        return size.int64Value
    }

    private func reservedBytes(_ dir: URL) throws -> Int64 {
        if let entry = uploads[dir.lastPathComponent] { return entry.size }
        var bytes: Int64 = 0
        for file in try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isSymbolicLinkKey]) {
            guard try safe(file) else { throw Failure.invalid }
            bytes += try regularSize(file)
            guard bytes <= Self.maxBytes else { return bytes }
        }
        return bytes
    }
}
