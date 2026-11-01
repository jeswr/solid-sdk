// AUTHORED-BY Claude Opus 5.5
import CoreFoundation
import Foundation

/// The PDF preview handoff's cache (MOB-P3 E5): Caches/pdf-preview/<handle>/<name>.pdf, at most one
/// file. The 25 MiB cap applies to the declared size and to every append, the first bytes must be
/// `%PDF-`, one handle is live at a time, and a handle idle for 60 seconds is dropped (checked on
/// the next call or `sweep`). A call naming any other handle is refused without touching the live
/// one. Times are monotonic seconds (system uptime). Not thread-safe: SuiteFilesPlugin calls it on
/// one serial queue.
final class PdfPreviewStore {
    static let maxBytes: Int64 = 25 * 1024 * 1024
    static let maxChunkBytes = 1024 * 1024
    static let idle: TimeInterval = 60
    /// Longest display name accepted, in UTF-16 code units (the Android store uses the same bound).
    static let maxNameUnits = 4096
    /// Monotonic, so changing the wall clock neither extends nor cuts short a handle's life.
    static func uptime() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
    private static let signature = Data("%PDF-".utf8)

    /// A refusal; `code` is what the plugin rejects with.
    struct Refused: Error, Equatable {
        let code: String
    }

    private let root: URL
    private var handle: String?
    private var file: URL?
    private var size: Int64 = 0
    private var written: Int64 = 0
    private var touched = -TimeInterval.infinity
    private var finished = false

    static func defaultRoot() throws -> URL {
        try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("pdf-preview", isDirectory: true)
    }

    /// Creates the store and empties its directory, which also clears files a killed process left.
    init(root: URL) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
        try clear()
    }

    /// Starts a preview, discarding the previous handle and its file.
    func begin(name: String, size: Int64, now: TimeInterval = PdfPreviewStore.uptime()) throws -> String {
        try clear()
        guard size <= PdfPreviewStore.maxBytes else { throw Refused(code: "too-large") }
        guard name.utf16.count <= PdfPreviewStore.maxNameUnits, size >= Int64(PdfPreviewStore.signature.count) else {
            throw Refused(code: "invalid")
        }
        let id = UUID().uuidString.lowercased()
        let dir = root.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
        let created = dir.appendingPathComponent(PdfPreviewStore.fileName(name), isDirectory: false)
        guard FileManager.default.createFile(atPath: created.path, contents: nil) else {
            throw Refused(code: "failed")
        }
        handle = id
        file = created
        self.size = size
        written = 0
        touched = now
        finished = false
        return id
    }

    /// Appends one decoded chunk. Any refusal discards the preview.
    func append(handle id: String, data: Data, now: TimeInterval = PdfPreviewStore.uptime()) throws {
        let target = try current(id, now: now)
        do {
            guard !data.isEmpty, data.count <= PdfPreviewStore.maxChunkBytes else { throw Refused(code: "invalid") }
            guard written + Int64(data.count) <= size else { throw Refused(code: "too-large") }
            if written == 0, !data.starts(with: PdfPreviewStore.signature) { throw Refused(code: "not-pdf") }
            let out = try FileHandle(forWritingTo: target)
            defer { try? out.close() }
            try out.seekToEnd()
            try out.write(contentsOf: data)
            written += Int64(data.count)
            touched = now
        } catch {
            try? clear()
            throw error
        }
    }

    /// The complete file, ready for the viewer. Later appends to this handle are refused.
    func finish(handle id: String, now: TimeInterval = PdfPreviewStore.uptime()) throws -> URL {
        let target = try current(id, now: now)
        guard written == size else {
            try? clear()
            throw Refused(code: "invalid")
        }
        finished = true
        touched = now
        return target
    }

    /// Deletes `url` when it is the finished preview (the viewer closed); anything else is ignored.
    func release(_ url: URL) {
        guard finished, let file, file == url else { return }
        try? clear()
    }

    /// Deletes the preview, finished or not, when `id` is live (no viewer took the file).
    func release(handle id: String) {
        guard let handle, handle == id else { return }
        try? clear()
    }

    /// Deletes an abandoned transfer after the idle limit. A finished file is either on screen or
    /// already released, and QuickLook's dismissal deletes it.
    func sweep(now: TimeInterval = PdfPreviewStore.uptime()) {
        guard handle != nil, !finished, now - touched > PdfPreviewStore.idle else { return }
        try? clear()
    }

    /// Drops the handle and empties the directory.
    func clear() throws {
        handle = nil
        file = nil
        finished = false
        for entry in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            try FileManager.default.removeItem(at: entry)
        }
    }

    private func current(_ id: String, now: TimeInterval) throws -> URL {
        // Another handle, or this one after finish: refuse without disturbing the live preview.
        guard let handle, let file, !finished, handle == id else { throw Refused(code: "invalid") }
        guard now - touched <= PdfPreviewStore.idle else {
            try? clear()
            throw Refused(code: "invalid")
        }
        return file
    }

    /// The declared size from the bridge: a whole, non-negative JS number that is not a boolean
    /// (Capacitor's numeric accessors would coerce both). Sizes past the cap become cap + 1.
    static func declaredSize(_ raw: Any?) -> Int64? {
        guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let value = number.doubleValue
        guard value.isFinite, value >= 0, value.rounded() == value else { return nil }
        return value > Double(maxBytes) ? maxBytes + 1 : Int64(value)
    }

    /// One chunk of canonical padded base64 (it re-encodes to the same text), at most one chunk long.
    static func decodeChunk(_ encoded: String) -> Data? {
        guard !encoded.isEmpty, encoded.utf8.count <= 4 * ((maxChunkBytes + 2) / 3),
              let data = Data(base64Encoded: encoded), data.base64EncodedString() == encoded else { return nil }
        return data
    }

    /// A filesystem-safe display name that always ends in .pdf.
    static func fileName(_ raw: String) -> String {
        let unsafe = CharacterSet(charactersIn: "/\\").union(.controlCharacters)
        var name = String(String.UnicodeScalarView(raw.unicodeScalars.map { unsafe.contains($0) ? "_" : $0 }))
        while let first = name.unicodeScalars.first,
              first == "." || CharacterSet.whitespacesAndNewlines.contains(first) {
            name.removeFirst()
        }
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        var suffix = ".pdf"
        if name.lowercased().hasSuffix(".pdf") {
            suffix = String(name.suffix(4))
            name.removeLast(4)
        }
        if name.isEmpty { name = "document" }
        while name.utf8.count > 255 - suffix.utf8.count { name.removeLast() }
        return name + suffix
    }
}
