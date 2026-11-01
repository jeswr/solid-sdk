// AUTHORED-BY Claude Opus 5.5
import Foundation

/// The PDF preview handoff's cache (MOB-P3 E5): Caches/pdf-preview/<handle>/<name>.pdf, at most one
/// file. The 25 MiB cap applies to the declared size and to every append, the first bytes must be
/// `%PDF-`, one handle is live at a time, and a handle idle for 60 seconds is dropped. Not
/// thread-safe: SuiteFilesPlugin calls it on one serial queue.
final class PdfPreviewStore {
    static let maxBytes: Int64 = 25 * 1024 * 1024
    static let maxChunkBytes = 1024 * 1024
    static let idle: TimeInterval = 60
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
    private var touched = Date.distantPast
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
    func begin(name: String, size: Int64, now: Date = Date()) throws -> String {
        try clear()
        guard size <= PdfPreviewStore.maxBytes else { throw Refused(code: "too-large") }
        guard name.utf8.count <= 16384, size >= Int64(PdfPreviewStore.signature.count) else {
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
    func append(handle id: String, data: Data, now: Date = Date()) throws {
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
    func finish(handle id: String, now: Date = Date()) throws -> URL {
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

    /// Drops the handle and empties the directory.
    func clear() throws {
        handle = nil
        file = nil
        finished = false
        for entry in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            try FileManager.default.removeItem(at: entry)
        }
    }

    private func current(_ id: String, now: Date) throws -> URL {
        guard let handle, let file, !finished, handle == id else { throw Refused(code: "invalid") }
        guard now.timeIntervalSince(touched) <= PdfPreviewStore.idle else {
            try? clear()
            throw Refused(code: "invalid")
        }
        return file
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
