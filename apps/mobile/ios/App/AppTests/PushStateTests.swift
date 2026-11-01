// AUTHORED-BY Codex GPT-6.1-Sol
import Foundation
import XCTest
@testable import App

final class PushStateTests: XCTestCase {
    var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: root) }
    static func json(id: String = "id", kind: String = "chat", registration: String = "b", index: Int = 1) -> String {
        "{\"v\":1,\"id\":\"\(id)\",\"kind\":\"\(kind)\",\"registrationId\":\"\(registration)\",\"topicIndex\":\(index),\"sentAt\":1}"
    }
    static func padded(_ json: String) -> Data { Data(json.utf8) + Data(repeating: 32, count: 512 - json.utf8.count) }
    static func payload(_ id: String, _ registration: String = "b", _ index: Int = 1) throws -> PushPayload {
        try PushPayload(padded(json(id: id, registration: registration, index: index)))
    }
    let topics = [PushStore.Topic(index: 1, kind: "chat", label: "Book club", route: "/chat/book", enabled: true),
                  PushStore.Topic(index: 2, kind: "inbox", label: "Inbox", route: "/notifications", enabled: true)]
    func testRouteVectors() {
        for route in ["/notifications", "/chat/book", "/chat/abc-_.~01"] { XCTAssertTrue(PushPolicy.route(route), route) }
        for route in ["", "/", "/chat/", "/chat/a/b", "/notifications/", "/chat/..", "/chat/a..b", "/chat/.",
                      "https://evil/chat/a", "//evil/chat/a", "chat:a", "/chat/%2f", "/chat/%2F", "/chat/%252f", "/chat/%5c",
                      "/chat/\\x", "/chat/a?x", "/chat/a#x", "/chat/a\n", "/chat/a\0", "/chat/你好", "/chat/../a",
                      "/chat/" + String(repeating: "a", count: 512)] { XCTAssertFalse(PushPolicy.route(route), route) }
    }
    func testStrictPlaintextAndPadding() throws {
        let valid = Self.json(); XCTAssertEqual(try PushPayload(Self.padded(valid)).id, "id")
        for invalid in [valid.replacingOccurrences(of: "\"v\":1", with: "\"v\":2"),
                        valid.replacingOccurrences(of: "\"v\":1", with: "\"v\":true"),
                        valid.replacingOccurrences(of: "\"v\":1", with: "\"v\":1.0"),
                        valid.replacingOccurrences(of: "\"v\":1", with: "\"v\":1,\"v\":1"),
                        valid.replacingOccurrences(of: "\"chat\"", with: "\"html\""),
                        valid.replacingOccurrences(of: "\"topicIndex\":1", with: "\"topicIndex\":16"),
                        valid.replacingOccurrences(of: "\"sentAt\":1", with: "\"sentAt\":-1"),
                        valid.replacingOccurrences(of: "\"id\":\"id\"", with: "\"id\":\"https://evil\""),
                        valid.replacingOccurrences(of: "}", with: ",\"url\":\"https://evil\"}"), valid + "\n", "[]", "null"] {
            XCTAssertThrowsError(try PushPayload(Self.padded(invalid)), invalid)
        }
        for size in [0, 511, 513, 4097] { XCTAssertThrowsError(try PushPayload(Data(repeating: 32, count: size))) }
        var invalidUTF8 = Self.padded(valid); invalidUTF8[10] = 255; XCTAssertThrowsError(try PushPayload(invalidUTF8))
        let escaped = valid.replacingOccurrences(of: "\"id\":\"id\"", with: "\"id\":\"\\u0069d\"")
        XCTAssertEqual(try PushPayload(Self.padded(escaped)).id, "id")
    }
    func testPersistentDedupeGroupingAndAccountIsolation() throws {
        let store = try PushStore(root: root); try store.setTopics(registration: "a", topics: topics); try store.setTopics(registration: "b", topics: topics)
        let first = try XCTUnwrap(store.accept(Self.payload("id")))
        XCTAssertEqual(first.body, "New message in Book club"); XCTAssertEqual(first.count, 1); XCTAssertEqual(first.group.count, 32); XCTAssertEqual(first.group, "34340f0e82d75a3446150f4a916c20c1")
        let reopened = try PushStore(root: root); XCTAssertNil(try reopened.accept(Self.payload("id")))
        XCTAssertEqual(try reopened.accept(Self.payload("next"))?.count, 2)
        XCTAssertNotEqual(first.group, try store.accept(Self.payload("other", "a"))?.group)
        XCTAssertNotEqual(PushPolicy.group("b", 1), PushPolicy.group("b", 2))
        let inbox = try PushPayload(Self.padded(Self.json(id: "inbox", kind: "inbox", index: 2)))
        XCTAssertEqual(try store.accept(inbox)?.body, "New item in your inbox")
        XCTAssertNil(try store.accept(Self.payload("unknown", "c"))); XCTAssertNil(try store.accept(Self.payload("topic", "b", 0)))
        XCTAssertNil(try store.accept(Self.payload("wrong-kind", "b", 2)))
        try store.silence("b"); XCTAssertNil(try reopened.accept(Self.payload("silenced")))
        XCTAssertNotNil(try store.accept(Self.payload("other-account", "a")))
        try store.silenceAll(); XCTAssertNil(try store.accept(Self.payload("all", "a")))
        try store.setTopics(registration: "a", topics: topics); XCTAssertNotNil(try store.accept(Self.payload("reenabled", "a")))
        for index in 0..<50 { _ = try store.accept(Self.payload("m\(index)", "a")) }
        XCTAssertNotNil(try store.accept(Self.payload("reenabled", "a")))
    }
    func testTopicValidationAndOneShotColdWarmTaps() throws {
        let store = try PushStore(root: root); try store.setTopics(registration: "b", topics: topics)
        for route in ["//evil", "/chat/%2f", "/chat/../a", "/notifications?x"] {
            XCTAssertThrowsError(try store.setTopics(registration: "b", topics: [PushStore.Topic(index: 1, kind: "chat", label: "Book", route: route, enabled: true)]))
        }
        XCTAssertThrowsError(try store.setTopics(registration: "b", topics: [topics[0], topics[0]]))
        XCTAssertNil(try store.consumeLaunch()); try store.launch(registration: "b", index: 1)
        let cold = try XCTUnwrap(PushStore(root: root).consumeLaunch())
        XCTAssertEqual(cold.registrationId, "b"); XCTAssertEqual(cold.route, "/chat/book"); XCTAssertNil(try store.consumeLaunch())
        try store.launch(registration: "b", index: 2); XCTAssertEqual(try store.consumeLaunch()?.route, "/notifications")
        try store.silence("b"); try store.launch(registration: "b", index: 1)
        XCTAssertEqual(try store.consumeLaunch()?.route, "/notifications")
        try store.clear(); XCTAssertNil(try store.accept(Self.payload("cleared")))
    }
    func testLockedDeviceFailureFilteringAndTimeoutSeams() throws {
        let noDecrypt: (String) throws -> Data = { _ in XCTFail("Read keys before unlock"); throw PushCrypto.Failure.invalid }
        let noState: (PushPayload) throws -> PushStore.Delivery? = { _ in XCTFail("Read labels before unlock"); return nil }
        if case .placeholder = PushReceiver.receive("p", readable: false, filtering: true, decrypt: noDecrypt, accept: noState) {} else { XCTFail("Expected placeholder") }
        for filtering in [false, true] {
            let result = PushReceiver.receive("p", readable: true, filtering: filtering, decrypt: { _ in throw PushCrypto.Failure.invalid }, accept: noState)
            switch result {
            case .hidden: XCTAssertTrue(filtering)
            case .placeholder: XCTAssertFalse(filtering)
            case .notify: XCTFail("Invalid push displayed")
            }
            XCTAssertFalse(PushPolicy.fallback(filtering: filtering, readable: true, expired: true))
            XCTAssertFalse(PushPolicy.fallback(filtering: filtering, readable: false))
        }
    }
    func testTimeoutCompletionIsGenericExactlyOnceAndIgnoresLateWork() {
        var delivered = [String]()
        let completion = PushCompletion(placeholder: PushPolicy.generic) { delivered.append($0) }
        XCTAssertTrue(completion.pending); XCTAssertTrue(completion.expire())
        XCTAssertFalse(completion.pending); XCTAssertFalse(completion.finish("New message in Book club"))
        XCTAssertFalse(completion.expire()); XCTAssertEqual(delivered, [PushPolicy.generic])
        let next = PushCompletion(placeholder: PushPolicy.generic) { delivered.append($0) }
        XCTAssertTrue(next.finish("New item in your inbox")); XCTAssertFalse(next.expire())
        XCTAssertEqual(delivered, [PushPolicy.generic, "New item in your inbox"])
    }
    func testFinalSilenceCheckAndForgottenRegistrationsFreeCapacity() throws {
        let store = try PushStore(root: root)
        for id in ["a", "b", "c", "d"] { try store.setTopics(registration: id, topics: topics) }
        XCTAssertThrowsError(try store.setTopics(registration: "e", topics: topics))
        let payload = try Self.payload("pending")
        XCTAssertNotNil(try store.accept(payload)); try store.silence("b")
        XCTAssertFalse(try store.withActive(payload) { XCTFail("Delivered after silence") })
        try store.setTopics(registration: "b", topics: [])
        try store.setTopics(registration: "e", topics: topics)
        XCTAssertNil(try store.accept(Self.payload("forgotten", "b")))
        let disabled = PushStore.Topic(index: 1, kind: "chat", label: "Book", route: "/chat/book", enabled: false)
        try store.setTopics(registration: "e", topics: [disabled])
        XCTAssertNil(try store.accept(Self.payload("disabled", "e")))
    }
    func testChallengeMailboxAndNonDisplayPaths() throws {
        let nonce = PushCrypto.b64(Data(repeating: 0, count: 16))
        let json = Self.json(id: "challenge", kind: "challenge", registration: "installation", index: 0)
            .replacingOccurrences(of: "}", with: ",\"nonce\":\"\(nonce)\"}")
        let bytes = Self.padded(json), payload = try PushPayload(bytes)
        XCTAssertEqual(try PushReceiver.background("p", decrypt: { _ in bytes })?.nonce, nonce)
        XCTAssertNil(try PushReceiver.background("p", decrypt: { _ in Self.padded(Self.json()) }))
        XCTAssertNil(try PushReceiver.background(nil, decrypt: { _ in XCTFail("Missing payload decrypted"); return bytes }))
        let mailbox = PushActivation(); mailbox.deliver(payload, now: 0)
        XCTAssertNil(mailbox.take("other", now: 1)); XCTAssertEqual(mailbox.take("installation", now: 59.999), nonce)
        XCTAssertNil(mailbox.take("installation", now: 59.999))
        mailbox.deliver(payload, now: 1); XCTAssertNil(mailbox.take("installation", now: 2)) // id dedupe
        mailbox.clear(); mailbox.deliver(payload, now: 0); XCTAssertNil(mailbox.take("installation", now: 60))
        mailbox.clear(); mailbox.deliver(payload, now: 0); mailbox.clear(); XCTAssertNil(mailbox.take("installation", now: 1))
        for filtering in [false, true] {
            let result = PushReceiver.receive("p", readable: true, filtering: filtering, decrypt: { _ in bytes },
                accept: { _ in XCTFail("Challenge reached display state"); return nil })
            switch result {
            case .hidden: XCTAssertTrue(filtering)
            case .placeholder: XCTAssertFalse(filtering)
            case .notify: XCTFail("Challenge displayed")
            }
        }
        XCTAssertThrowsError(try PushPayload(Self.padded(json.replacingOccurrences(of: nonce, with: "bad"))))
    }
}
