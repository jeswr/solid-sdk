// AUTHORED-BY Claude Opus 5.5
import Foundation
import XCTest
@testable import App

final class ShareOutStoreTests: XCTestCase {
    private var temporary: URL!
    // Not created up front: the store must normalise its root only after creating it.
    private var root: URL { temporary.appendingPathComponent("share-out", isDirectory: true) }

    override func setUpWithError() throws {
        try super.setUpWithError()
        temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: temporary)
        temporary = nil
        try super.tearDownWithError()
    }

    private func staged(_ store: ShareOutStore, _ bytes: Data) throws -> URL {
        let id = try store.begin(name: "a.txt", mimeType: "text/plain", size: Int64(bytes.count))
        if !bytes.isEmpty { try store.writeChunk(id: id, offset: 0, data: bytes) }
        return try store.commit(id: id)
    }

    func testCommittedFilesAreShareableFromAFreshRoot() throws {
        let store = try ShareOutStore(root: root)
        let file = try staged(store, Data("hi".utf8))
        let parsed = try XCTUnwrap(URL(string: file.absoluteString))
        XCTAssertEqual(store.committedFile(parsed)?.path, file.path)
        XCTAssertEqual(try Data(contentsOf: file), Data("hi".utf8))
    }

    func testUnfinishedUploadsNeverCountAsCommittedAcrossRestart() throws {
        let first = try ShareOutStore(root: root)
        let id = try first.begin(name: "b.txt", mimeType: "text/plain", size: 4)
        try first.writeChunk(id: id, offset: 0, data: Data("ab".utf8))
        let partial = root.appendingPathComponent(id, isDirectory: true).appendingPathComponent("b.txt")
        XCTAssertNil(first.committedFile(partial))
        let restarted = try ShareOutStore(root: root)
        XCTAssertNil(restarted.committedFile(partial))
        try restarted.evict()
        XCTAssertFalse(FileManager.default.fileExists(atPath: partial.deletingLastPathComponent().path))
    }

    func testRejectsFilesOutsideTheStagingDirectories() throws {
        let store = try ShareOutStore(root: root)
        let file = try staged(store, Data([1]))
        let dir = file.deletingLastPathComponent()
        for raw in [
            root.appendingPathComponent("not-an-id/a.txt").absoluteString,
            dir.appendingPathComponent(ShareOutStore.uploadingMarker).absoluteString,
            dir.appendingPathComponent("../../outside.txt").absoluteString,
            "file:///etc/hosts", "https://example.org/a.txt", file.absoluteString + "?x=1"
        ] {
            XCTAssertNil(store.committedFile(try XCTUnwrap(URL(string: raw))), raw)
        }
        let link = dir.appendingPathComponent("link.txt")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: URL(fileURLWithPath: "/etc/hosts"))
        XCTAssertNil(store.committedFile(link))
    }

    func testKeptFilesSurviveCapacityEviction() throws {
        let store = try ShareOutStore(root: root)
        let kept = try staged(store, Data())
        var others = [URL]()
        for _ in 1..<ShareOutStore.maxFiles { others.append(try staged(store, Data())) }
        let id = try store.begin(name: "c.txt", mimeType: "text/plain", size: 0,
                                 keep: [kept.deletingLastPathComponent().lastPathComponent])
        XCTAssertTrue(FileManager.default.fileExists(atPath: kept.path))
        XCTAssertEqual(others.filter { !FileManager.default.fileExists(atPath: $0.path) }.count, 1)
        try store.abort(id)
    }
}
