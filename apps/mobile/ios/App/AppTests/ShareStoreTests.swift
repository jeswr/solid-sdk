// AUTHORED-BY GPT-5.6 Codex
import Foundation
import XCTest
@testable import App

final class ShareStoreTests: XCTestCase {
    private var temporary: URL!
    private var store: ShareStore!
    private var root: URL { temporary.appendingPathComponent("share", isDirectory: true) }
    private let instant = Date(timeIntervalSince1970: 1000)

    override func setUpWithError() throws {
        try super.setUpWithError()
        temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        store = ShareStore(root: root)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: temporary)
        store = nil
        temporary = nil
        try super.tearDownWithError()
    }

    private func file(_ name: String, data: Data) throws -> ShareStore.Incoming {
        let source = temporary.appendingPathComponent(UUID().uuidString)
        try data.write(to: source)
        return .file(name: name, mimeType: "text/plain") { body in try body(source) }
    }

    /// A sparse source avoids allocating 100 MB in memory; the real store still copies every byte.
    private func zeros(_ size: Int64) throws -> ShareStore.Incoming {
        let source = temporary.appendingPathComponent(UUID().uuidString)
        XCTAssertTrue(FileManager.default.createFile(atPath: source.path, contents: nil))
        let handle = try FileHandle(forWritingTo: source)
        defer { try? handle.close() }
        try handle.truncate(atOffset: UInt64(size))
        return .file(name: "big", mimeType: nil) { body in try body(source) }
    }

    private func storeOne(_ stamp: TimeInterval) throws -> ShareStore.Batch {
        return try store.store([.text("hi")], now: Date(timeIntervalSince1970: stamp))
    }

    private func directory(_ id: String) -> URL {
        return root.appendingPathComponent(id, isDirectory: true)
    }

    /// Batch directories only: the cross-process `.lock` file lives beside them.
    private func entries() throws -> [String] {
        return try FileManager.default.contentsOfDirectory(atPath: root.path).filter { !$0.hasPrefix(".") }
    }

    private func assertRejected(_ items: [ShareStore.Incoming], file: StaticString = #filePath, line: UInt = #line) throws {
        XCTAssertThrowsError(try store.store(items, now: instant), file: file, line: line)
        XCTAssertEqual(try entries(), [], file: file, line: line)
    }

    func testCapsMatchTheSharedContract() {
        XCTAssertEqual(ShareStore.maxItemBytes, 100 * 1024 * 1024)
        XCTAssertEqual(ShareStore.maxBatchBytes, 200 * 1024 * 1024)
        XCTAssertEqual(ShareStore.maxPendingBytes, 500 * 1024 * 1024)
        XCTAssertEqual(ShareStore.maxItems, 20)
        XCTAssertEqual(ShareStore.maxPendingBatches, 10)
        XCTAssertEqual(ShareStore.maxTextChars, 100_000)
        XCTAssertEqual(ShareStore.maxTitleChars, 1000)
        XCTAssertEqual(ShareStore.maxChunkBytes, 512 * 1024)
        XCTAssertEqual(ShareStore.maxAge, 7 * 24 * 60 * 60)
    }

    func testStoresAMixedBatchReadsChunksAndAcknowledges() throws {
        let batch = try store.store([
            try file("../../etc/passwd", data: Data("hello world".utf8)),
            .url(" https://example.org/a?b=c ", title: "Example"), .text("note")
        ], now: instant)
        let read = try XCTUnwrap(store.pending().first)
        XCTAssertEqual(store.pending().count, 1)
        XCTAssertTrue(ShareStore.isBatchId(batch.id))
        XCTAssertEqual(read.id, batch.id)
        XCTAssertEqual(read.receivedAt, instant)
        XCTAssertEqual(read.items.count, 3)
        XCTAssertEqual(read.items[0]["kind"] as? String, "file")
        XCTAssertEqual(read.items[0]["name"] as? String, "_.._etc_passwd")
        XCTAssertEqual(read.items[0]["mimeType"] as? String, "text/plain")
        XCTAssertEqual((read.items[0]["size"] as? NSNumber)?.int64Value, 11)
        XCTAssertEqual(read.items[1]["url"] as? String, "https://example.org/a?b=c")
        XCTAssertEqual(read.items[1]["title"] as? String, "Example")
        XCTAssertEqual(read.items[2]["text"] as? String, "note")

        let first = try store.readChunk(batchId: batch.id, index: 0, offset: 0, length: 5)
        XCTAssertEqual(first.data, Data("hello".utf8))
        XCTAssertFalse(first.eof)
        let last = try store.readChunk(batchId: batch.id, index: 0, offset: 5, length: 100)
        XCTAssertEqual(last.data, Data(" world".utf8))
        XCTAssertTrue(last.eof)
        for offset in [Int64(11), 12, Int64.max] {
            let end = try store.readChunk(batchId: batch.id, index: 0, offset: offset, length: 10)
            XCTAssertTrue(end.data.isEmpty)
            XCTAssertTrue(end.eof)
        }
        let empty = try store.readChunk(batchId: batch.id, index: 0, offset: 0, length: 0)
        XCTAssertTrue(empty.data.isEmpty)
        XCTAssertFalse(empty.eof)

        store.acknowledge(batch.id)
        XCTAssertTrue(store.pending().isEmpty())
        XCTAssertEqual(try entries(), [])
    }

    func testCapsChunksAt512KiBAndHandlesEmptyFiles() throws {
        let batch = try store.store([try zeros(Int64(ShareStore.maxChunkBytes + 10)), try zeros(0)], now: instant)
        XCTAssertEqual(batch.items[0]["mimeType"] as? String, "application/octet-stream")
        let chunk = try store.readChunk(batchId: batch.id, index: 0, offset: 0, length: Int.max)
        XCTAssertEqual(chunk.data.count, ShareStore.maxChunkBytes)
        XCTAssertFalse(chunk.eof)
        let tail = try store.readChunk(batchId: batch.id, index: 0, offset: Int64(chunk.data.count), length: Int.max)
        XCTAssertEqual(tail.data.count, 10)
        XCTAssertTrue(tail.eof)
        let empty = try store.readChunk(batchId: batch.id, index: 1, offset: 0, length: 1)
        XCTAssertTrue(empty.data.isEmpty)
        XCTAssertTrue(empty.eof)
    }

    func testReadChunkRejectsBadTargetsAndNegativeBounds() throws {
        let batch = try store.store([try file("a", data: Data([1, 2, 3])), .text("t")], now: instant)
        for index in [-1, 1, 2, Int.max] {
            XCTAssertThrowsError(try store.readChunk(batchId: batch.id, index: index, offset: 0, length: 1))
        }
        for id in ["../share", "", "ABCDEF00-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"] {
            XCTAssertThrowsError(try store.readChunk(batchId: id, index: 0, offset: 0, length: 1))
        }
        XCTAssertThrowsError(try store.readChunk(batchId: batch.id, index: 0, offset: -1, length: 1))
        XCTAssertThrowsError(try store.readChunk(batchId: batch.id, index: 0, offset: 0, length: -1))
        try FileManager.default.removeItem(at: directory(batch.id).appendingPathComponent("item-0"))
        XCTAssertThrowsError(try store.readChunk(batchId: batch.id, index: 0, offset: 0, length: 1))
    }

    func testRejectsTooManyItemsAndOversizedTextWithoutKeepingPartials() throws {
        try assertRejected([])
        try assertRejected(Array(repeating: .text("x"), count: ShareStore.maxItems + 1))
        try assertRejected([.text(String(repeating: "x", count: ShareStore.maxTextChars + 1))])
        try assertRejected([.text(String(repeating: "😀", count: ShareStore.maxTextChars / 2 + 1))])
    }

    func testAcceptsExactlyTheItemCountAndTextCapsAndTruncatesTitles() throws {
        let text = String(repeating: "x", count: ShareStore.maxTextChars)
        let items = Array(repeating: ShareStore.Incoming.text(text), count: ShareStore.maxItems)
        let batch = try store.store(items, now: instant)
        XCTAssertEqual(batch.items.count, ShareStore.maxItems)
        XCTAssertEqual(batch.items[19]["text"] as? String, text)
        let url = try store.store([.url("http://example.org/", title: String(repeating: "t", count: 1001))], now: instant)
        XCTAssertEqual((url.items[0]["title"] as? String)?.count, ShareStore.maxTitleChars)
        let untitled = try store.store([.url("https://example.org/", title: nil)], now: instant)
        XCTAssertNil(untitled.items[0]["title"])
    }

    func testRejectsOversizedFilesAndBatchesWhileCopying() throws {
        try assertRejected([try zeros(ShareStore.maxItemBytes + 1)])
        let full = try zeros(ShareStore.maxItemBytes)
        try assertRejected([full, full, try zeros(1)])
    }

    func testAcceptsExactlyTheFileAndBatchByteCaps() throws {
        let full = try zeros(ShareStore.maxItemBytes)
        let batch = try store.store([full, full], now: instant)
        XCTAssertEqual(batch.items.count, 2)
        for item in batch.items {
            XCTAssertEqual((item["size"] as? NSNumber)?.int64Value, ShareStore.maxItemBytes)
        }
        let tail = try store.readChunk(batchId: batch.id, index: 1, offset: ShareStore.maxItemBytes - 1, length: 10)
        XCTAssertEqual(tail.data, Data([0]))
        XCTAssertTrue(tail.eof)
    }

    func testRejectsMalformedURLsAndStopsBeforeOpeningLaterItems() throws {
        for raw in [
            "javascript:alert(1)", "file:///tmp/private", "ftp://example.org/", "https://user:pw@example.org/",
            "https://user@example.org/", "https://", "not a url", ""
        ] {
            try assertRejected([.url(raw, title: nil)])
        }
        var opened = false
        let later = ShareStore.Incoming.file(name: "later", mimeType: nil) { _ in opened = true }
        try assertRejected([.url("ftp://example.org/", title: nil), later])
        XCTAssertFalse(opened)
    }

    func testCleansUpWhenAFileSourceFails() throws {
        let broken = ShareStore.Incoming.file(name: "broken", mimeType: nil) { _ in
            throw ShareStore.Failure.rejected("unreadable source")
        }
        try assertRejected([try file("first", data: Data([1])), broken])
        let missing = temporary.appendingPathComponent("missing")
        try assertRejected([.file(name: "missing", mimeType: nil) { body in try body(missing) }])
    }

    func testEvictsTheOldestBeyondTenBatchesAndKeepsTheNewBatch() throws {
        let first = try storeOne(1).id
        for stamp in 2...ShareStore.maxPendingBatches { _ = try storeOne(TimeInterval(stamp)) }
        XCTAssertEqual(store.pending().count, 10)
        let newest = try storeOne(100).id
        let pending = store.pending()
        XCTAssertEqual(pending.count, 10)
        XCTAssertFalse(pending.contains { $0.id == first })
        XCTAssertEqual(pending.last?.id, newest)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory(first).path))
        // A batch with an older timestamp must also survive the overflow it causes.
        let backdated = try storeOne(0).id
        XCTAssertEqual(store.pending().count, 10)
        XCTAssertEqual(store.pending().first?.id, backdated)
    }

    func testEvictsTheOldestBeyondThePendingByteCap() throws {
        let full = try zeros(ShareStore.maxItemBytes)
        let first = try store.store([full], now: Date(timeIntervalSince1970: 1)).id
        let second = try store.store([full], now: Date(timeIntervalSince1970: 2)).id
        let third = try store.store([full], now: Date(timeIntervalSince1970: 3)).id
        let newest = try store.store([full, full], now: Date(timeIntervalSince1970: 4)).id
        // Manifests also count: 500 MiB of files plus metadata exceeds the pending cap.
        let ids = store.pending().map { $0.id }
        XCTAssertEqual(ids, [second, third, newest])
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory(first).path))
    }

    func testEvictsWeekOldBatchesAndOnlyAbandonedCopies() throws {
        let old = try storeOne(0).id
        let fresh = try storeOne(ShareStore.maxAge).id
        XCTAssertEqual(store.pending().count, 2, "a batch exactly seven days old survives")
        let now = Date(timeIntervalSince1970: ShareStore.maxAge + 1)
        let unclaimed = directory("11111111-1111-1111-1111-111111111111")
        let released = directory("22222222-2222-2222-2222-222222222222")
        let active = directory("33333333-3333-3333-3333-333333333333")
        let unrelated = directory("keep-me")
        for dir in [unclaimed, released, active, unrelated] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        // A writer that exited leaves `.writing` unlocked; a live writer still holds its flock.
        for dir in [released, active] {
            XCTAssertTrue(FileManager.default.createFile(atPath: dir.appendingPathComponent(".writing").path, contents: nil))
        }
        let writer = open(active.appendingPathComponent(".writing").path, O_RDWR)
        XCTAssertGreaterThanOrEqual(writer, 0)
        XCTAssertEqual(flock(writer, LOCK_EX | LOCK_NB), 0)
        defer { close(writer) }
        store.evict(now: now)
        XCTAssertEqual(store.pending().map { $0.id }, [fresh])
        for dir in [directory(old), unclaimed, released] { XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path)) }
        for dir in [active, unrelated] { XCTAssertTrue(FileManager.default.fileExists(atPath: dir.path)) }
    }

    func testNeverMutatesWithoutTheCrossProcessLock() throws {
        let kept = try storeOne(0).id
        // A directory cannot be opened read-write, so taking the lock fails.
        let lock = root.appendingPathComponent(".lock")
        try FileManager.default.removeItem(at: lock)
        try FileManager.default.createDirectory(at: lock, withIntermediateDirectories: false)
        XCTAssertThrowsError(try store.store([.text("hi")], now: instant))
        store.acknowledge(kept)
        store.evict(now: Date(timeIntervalSince1970: ShareStore.maxAge + 1))
        XCTAssertEqual(try entries(), [kept])
    }

    func testDropsCorruptManifestsAndRefusesReads() throws {
        let variants: [(String, Any)] = [
            ("id", "00000000-0000-0000-0000-000000000000"), ("id", NSNull()),
            ("receivedAt", "soon"), ("receivedAt", NSNull()), ("items", "bad"), ("items", ["bad"])
        ]
        for (key, value) in variants {
            let batch = try storeOne(5)
            var json = batch.json
            json[key] = value
            try JSONSerialization.data(withJSONObject: json).write(to: directory(batch.id).appendingPathComponent("batch.json"))
            XCTAssertTrue(store.pending().isEmpty(), key)
            XCTAssertFalse(FileManager.default.fileExists(atPath: directory(batch.id).path), key)
            XCTAssertThrowsError(try store.readChunk(batchId: batch.id, index: 0, offset: 0, length: 1))
        }
        for raw in ["{", "[]", "null"] {
            let batch = try storeOne(5)
            try Data(raw.utf8).write(to: directory(batch.id).appendingPathComponent("batch.json"))
            XCTAssertTrue(store.pending().isEmpty(), raw)
            XCTAssertFalse(FileManager.default.fileExists(atPath: directory(batch.id).path), raw)
        }
    }

    func testAcknowledgeIgnoresNonBatchNames() throws {
        let unrelated = directory("keep-me")
        try FileManager.default.createDirectory(at: unrelated, withIntermediateDirectories: true)
        let invalid: [String?] = ["keep-me", "../share", "", nil]
        for id in invalid { store.acknowledge(id) }
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.path))
    }

    func testSanitisesNamesAndTypesLikeSuiteNative() {
        XCTAssertEqual(ShareStore.sanitiseName(nil), "shared-file")
        XCTAssertEqual(ShareStore.sanitiseName(" .. "), "shared-file")
        XCTAssertEqual(ShareStore.sanitiseName("a/b\\c"), "a_b_c")
        XCTAssertEqual(ShareStore.sanitiseName("x\u{0000}y"), "x_y")
        XCTAssertEqual(ShareStore.sanitiseName(" .hidden "), "hidden")
        XCTAssertEqual(ShareStore.sanitiseName(String(repeating: "n", count: 300)).count, 255)
        XCTAssertEqual(ShareStore.sanitiseMime("IMAGE/PNG"), "image/png")
        XCTAssertEqual(ShareStore.sanitiseMime("text/html; charset=utf-8"), "application/octet-stream")
        XCTAssertEqual(ShareStore.sanitiseMime("text/plain\n"), "application/octet-stream")
        XCTAssertEqual(ShareStore.sanitiseMime(nil), "application/octet-stream")
        XCTAssertNil(ShareStore.httpURL(nil))
        XCTAssertTrue(ShareStore.isBatchId("11111111-1111-1111-1111-111111111111"))
        for id in ["../share", "", "ABCDEF00-1111-1111-1111-111111111111", "11111111-1111-1111-1111-111111111111\n"] {
            XCTAssertFalse(ShareStore.isBatchId(id), id)
        }
        XCTAssertFalse(ShareStore.isBatchId(nil))
    }
}
