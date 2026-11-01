// AUTHORED-BY Claude Opus 5.5
import Foundation
import XCTest
@testable import App

final class PdfPreviewStoreTests: XCTestCase {
    private var root: URL!
    private var store: PdfPreviewStore!
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private let pdf = Data("%PDF-1.7\n%%EOF\n".utf8)

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("pdf-preview-\(UUID().uuidString)", isDirectory: true)
        store = try PdfPreviewStore(root: root)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func refusal(_ action: () throws -> Void) -> String? {
        do { try action() } catch let refused as PdfPreviewStore.Refused { return refused.code } catch { return "other" }
        return nil
    }

    private func files() throws -> Int {
        try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).reduce(0) { count, dir in
            count + ((try? FileManager.default.contentsOfDirectory(atPath: dir.path).count) ?? 1)
        }
    }

    func testWritesAndFinishesOnePdf() throws {
        let handle = try store.begin(name: "Report", size: Int64(pdf.count), now: now)
        try store.append(handle: handle, data: pdf, now: now)
        let file = try store.finish(handle: handle, now: now)
        XCTAssertEqual(file.lastPathComponent, "Report.pdf")
        XCTAssertEqual(try Data(contentsOf: file), pdf)
        XCTAssertEqual(refusal { try store.append(handle: handle, data: pdf, now: now) }, "invalid")
        XCTAssertEqual(refusal { _ = try store.finish(handle: handle, now: now) }, "invalid")
        store.release(file)
        XCTAssertEqual(try files(), 0)
    }

    func testCapsTheDeclaredSizeAndEveryAppend() throws {
        XCTAssertEqual(refusal { _ = try store.begin(name: "a.pdf", size: PdfPreviewStore.maxBytes + 1, now: now) }, "too-large")
        let handle = try store.begin(name: "a.pdf", size: Int64(pdf.count), now: now)
        XCTAssertEqual(refusal { try store.append(handle: handle, data: pdf + Data([0]), now: now) }, "too-large")
        XCTAssertEqual(try files(), 0)
        let big = try store.begin(name: "a.pdf", size: PdfPreviewStore.maxBytes, now: now)
        let oversized = Data(count: PdfPreviewStore.maxChunkBytes + 1)
        XCTAssertEqual(refusal { try store.append(handle: big, data: oversized, now: now) }, "invalid")
    }

    func testRequiresTheSignatureOnTheFirstBytes() throws {
        let handle = try store.begin(name: "a.pdf", size: 16, now: now)
        XCTAssertEqual(refusal { try store.append(handle: handle, data: Data("<html>evil</html".utf8), now: now) }, "not-pdf")
        XCTAssertEqual(try files(), 0)
        let split = try store.begin(name: "a.pdf", size: 10, now: now)
        try store.append(handle: split, data: Data("%PDF-".utf8), now: now)
        try store.append(handle: split, data: Data("<html".utf8), now: now)
        XCTAssertEqual(try Data(contentsOf: store.finish(handle: split, now: now)).count, 10)
    }

    func testANewBeginReplacesThePreviousHandleAndFile() throws {
        let first = try store.begin(name: "first.pdf", size: Int64(pdf.count), now: now)
        try store.append(handle: first, data: pdf, now: now)
        let firstFile = try store.finish(handle: first, now: now)
        let second = try store.begin(name: "second.pdf", size: Int64(pdf.count), now: now)
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstFile.path))
        XCTAssertEqual(refusal { try store.append(handle: first, data: pdf, now: now) }, "invalid")
        try store.append(handle: second, data: pdf, now: now)
        XCTAssertEqual(try store.finish(handle: second, now: now).lastPathComponent, "second.pdf")
        // Releasing the old file must not delete the current one.
        store.release(firstFile)
        XCTAssertEqual(try files(), 1)
    }

    func testDropsAHandleIdleForSixtySeconds() throws {
        let handle = try store.begin(name: "a.pdf", size: Int64(pdf.count * 2), now: now)
        try store.append(handle: handle, data: pdf, now: now.addingTimeInterval(PdfPreviewStore.idle))
        let late = now.addingTimeInterval(2 * PdfPreviewStore.idle + 1)
        XCTAssertEqual(refusal { try store.append(handle: handle, data: pdf, now: late) }, "invalid")
        XCTAssertEqual(try files(), 0)
    }

    func testEmptiesTheDirectoryOnLaunch() throws {
        let stale = root.appendingPathComponent("left-by-a-killed-process", isDirectory: true)
        try FileManager.default.createDirectory(at: stale, withIntermediateDirectories: true)
        XCTAssertTrue(FileManager.default.createFile(atPath: stale.appendingPathComponent("x.pdf").path, contents: pdf))
        _ = try PdfPreviewStore(root: root)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }

    func testNamesEndInPdf() {
        XCTAssertEqual(PdfPreviewStore.fileName("a.PDF"), "a.PDF")
        XCTAssertEqual(PdfPreviewStore.fileName("notes.txt"), "notes.txt.pdf")
        XCTAssertEqual(PdfPreviewStore.fileName("/../x"), "_.._x.pdf")
        XCTAssertEqual(PdfPreviewStore.fileName("..."), "document.pdf")
        let long = PdfPreviewStore.fileName(String(repeating: "é", count: 200) + ".pdf")
        XCTAssertTrue(long.hasSuffix(".pdf"))
        XCTAssertLessThanOrEqual(long.utf8.count, 255)
    }
}
