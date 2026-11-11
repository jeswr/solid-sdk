// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import CryptoKit
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
    func testRenewalRequiresFutureSafeIntegerMilliseconds() throws {
        let now = 1000000.0
        XCTAssertNil(try PushPolicy.renewalExpiry(NSNull(), now: now))
        XCTAssertEqual(try PushPolicy.renewalExpiry(NSNumber(value: now + 1), now: now), now + 1)
        XCTAssertEqual(try PushPolicy.renewalExpiry(NSNumber(value: 9007199254740991), now: now), 9007199254740991)
        let invalid: [Any] = [true, false, "2000000", 2000000.5, Double.nan, Double.infinity, now, now - 1, 9007199254740992.0]
        for value in invalid {
            XCTAssertThrowsError(try PushPolicy.renewalExpiry(value, now: now))
        }
        XCTAssertThrowsError(try PushPolicy.renewalExpiry(nil, now: now))
        XCTAssertEqual(PushPolicy.renewalTrigger(now + 7 * 86400000, now: now), now + 6 * 86400000)
        XCTAssertEqual(PushPolicy.renewalTrigger(now + 2000, now: now), now + 1000)
    }
    func testRenewalReplacementExpirySilenceAndGenericOneShotTap() throws {
        let store = try PushStore(root: root)
        try store.setTopics(registration: "a", topics: topics); try store.setTopics(registration: "b", topics: topics)
        try store.setRenewalExpiry(2000)
        XCTAssertTrue(try PushStore(root: root).withRenewalReminder(2000, now: 1000))
        XCTAssertFalse(try store.withRenewalReminder(1999, now: 1000))
        XCTAssertFalse(try store.withRenewalReminder(2000, now: 2000))
        try store.silence("a"); XCTAssertTrue(try store.withRenewalReminder(2000, now: 1000))
        try store.silence("b"); XCTAssertFalse(try store.withRenewalReminder(2000, now: 1000))
        XCTAssertFalse(try store.hasAnyActive())
        try store.setTopics(registration: "b", topics: topics); try store.setRenewalExpiry(nil)
        XCTAssertFalse(try store.withRenewalReminder(2000, now: 1000))
        try store.launch(registration: "b", index: 1); try store.launchNotifications()
        let launch = try XCTUnwrap(PushStore(root: root).consumeLaunch())
        XCTAssertNil(launch.registrationId); XCTAssertEqual(launch.route, "/notifications")
        XCTAssertNil(try store.consumeLaunch())
        try store.launchNotifications(); try store.launch(registration: "b", index: 1)
        XCTAssertEqual(try store.consumeLaunch()?.route, "/chat/book")
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
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("topics.json"))) as? [String: Any])
        XCTAssertEqual((saved["presentations"] as? [String: Any])?.count, 50)
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
    func testLaunchResolvesCurrentMapWhenConsumed() throws {
        let store = try PushStore(root: root); try store.setTopics(registration: "b", topics: topics)
        try store.launch(registration: "b", index: 1)
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("topics.json"))) as? [String: Any])
        let pending = try XCTUnwrap(saved["launch"] as? [String: Any])
        XCTAssertEqual(Set(pending.keys), Set(["registrationId", "topicIndex"]))
        try store.silence("b")
        let silenced = try XCTUnwrap(store.consumeLaunch())
        XCTAssertEqual(silenced.registrationId, "b"); XCTAssertEqual(silenced.route, "/notifications")
        try store.setTopics(registration: "b", topics: topics)
        try store.launch(registration: "b", index: 1); try store.silenceAll()
        XCTAssertEqual(try PushStore(root: root).consumeLaunch()?.route, "/notifications")
        try store.setTopics(registration: "b", topics: topics); try store.launch(registration: "b", index: 1)
        let changed = PushStore.Topic(index: 1, kind: "chat", label: "New", route: "/chat/new", enabled: true)
        try store.setTopics(registration: "b", topics: [changed])
        XCTAssertEqual(try store.consumeLaunch()?.route, "/chat/new")
        try store.launch(registration: "b", index: 1); try store.setTopics(registration: "b", topics: [topics[1]])
        XCTAssertEqual(try store.consumeLaunch()?.route, "/notifications")
        try store.setTopics(registration: "b", topics: topics); try store.launch(registration: "b", index: 1)
        let disabled = PushStore.Topic(index: 1, kind: "chat", label: "Book", route: "/chat/book", enabled: false)
        try store.setTopics(registration: "b", topics: [disabled])
        XCTAssertEqual(try store.consumeLaunch()?.route, "/notifications")
        try store.launch(registration: "b", index: 1); try store.setTopics(registration: "b", topics: [])
        let forgotten = try XCTUnwrap(store.consumeLaunch())
        XCTAssertNil(forgotten.registrationId); XCTAssertEqual(forgotten.route, "/notifications"); XCTAssertNil(try store.consumeLaunch())
        try store.launch(registration: "unknown", index: 1); XCTAssertNil(try store.consumeLaunch()?.registrationId)
    }
    func testLegacySavedRouteIsConsumedOnlyWithSafeFallback() throws {
        let store = try PushStore(root: root); try store.setTopics(registration: "b", topics: topics)
        let url = root.appendingPathComponent("topics.json")
        var state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        state["launch"] = ["registrationId": "b", "route": "/chat/stale"]
        try JSONSerialization.data(withJSONObject: state).write(to: url)
        let launch = try XCTUnwrap(store.consumeLaunch())
        XCTAssertEqual(launch.registrationId, "b"); XCTAssertEqual(launch.route, "/notifications")
    }
    func testDisablePersistsSilenceBeforeInvalidatingPermissionAndTokenCallbacks() throws {
        for waitingForToken in [false, true] {
            let store = try PushStore(root: root); try store.setTopics(registration: "b", topics: topics)
            let enablement = PushEnablement<NSObject>(), old = NSObject(), next = NSObject()
            XCTAssertTrue(enablement.begin(old)); XCTAssertFalse(enablement.begin(next))
            var tokenRequests = 0, keyCreations = 0
            if waitingForToken { enablement.withCurrent(old) { tokenRequests += 1 } }
            let cancelled = try enablement.disable {
                try store.silenceAll()
                XCTAssertNil(try PushStore(root: root).accept(Self.payload("during-disable")))
                XCTAssertTrue(enablement.withCurrent(old) {})
            }
            XCTAssertTrue(cancelled === old)
            XCTAssertFalse(enablement.withCurrent(old) { tokenRequests += 1 })
            XCTAssertFalse(enablement.finish(old) { keyCreations += 1 })
            XCTAssertTrue(enablement.begin(next))
            XCTAssertFalse(enablement.finish(old) { keyCreations += 1 })
            XCTAssertTrue(enablement.finish(next) { keyCreations += 1 })
            XCTAssertEqual(tokenRequests, waitingForToken ? 1 : 0); XCTAssertEqual(keyCreations, 1)
            XCTAssertNil(try store.accept(Self.payload("late-token")))
        }
    }
    func testEnableTimeoutIgnoresLateTokensAndOldDeadlines() {
        let enablement = PushEnablement<NSObject>(), expired = NSObject(), next = NSObject()
        XCTAssertTrue(enablement.begin(expired)); XCTAssertTrue(enablement.finish(expired) {})
        XCTAssertTrue(enablement.begin(next))
        XCTAssertFalse(enablement.finish(expired) { XCTFail("Old token/deadline affected the new enable") })
        XCTAssertTrue(enablement.finish(next) {})
    }
    func testLateAPNsCallbackAfterDisableCannotResolveCancelledEnable() throws {
        let store = try PushStore(root: root); try store.setTopics(registration: "b", topics: topics)
        let enablement = PushEnablement<NSObject>(), call = NSObject(), registration = PushTokenRegistration()
        var requests = 0, callbacks = 0
        XCTAssertTrue(enablement.begin(call))
        registration.register({ _ in enablement.finish(call) { callbacks += 1 } }, request: { requests += 1 })
        try enablement.disable { try store.silenceAll() }; registration.cancel()
        registration.registered("late-token"); registration.failed(PushCrypto.Failure.invalid)
        XCTAssertEqual(callbacks, 0); XCTAssertNil(try store.accept(Self.payload("after-late-token")))
        registration.register({ result in
            XCTAssertEqual(try? result.get(), "fresh-token"); callbacks += 1
        }, request: { requests += 1 })
        XCTAssertEqual(requests, 2); XCTAssertEqual(callbacks, 0)
        registration.registered("fresh-token"); XCTAssertEqual(callbacks, 1)
        registration.clear(); registration.registered("late-after-unregister"); XCTAssertNil(registration.token)
        registration.register({ _ in XCTFail("Cached token after unregister") }, request: { requests += 1 })
        XCTAssertEqual(requests, 3); registration.cancel()
    }
    func testEveryEnableWaitsForAPNsAfterSuccessfulRegistrationAndUnsolicitedRotation() throws {
        let store = try PushStore(root: root)
        let registration = PushTokenRegistration(recordToken: store.recordToken)
        var requests = 0, returned = [String]()
        let complete: (Result<String, Error>) -> Void = { result in
            guard let token = try? result.get() else { return XCTFail("APNs registration failed") }
            returned.append(token)
        }
        registration.register(complete, request: { requests += 1 })
        XCTAssertTrue(returned.isEmpty); registration.registered("old-apns")
        XCTAssertEqual(returned, ["old-apns"])
        try store.setTopics(registration: "b", topics: topics, pushToken: "old-apns")
        XCTAssertFalse(try store.registrationStale())

        registration.registered("new-apns") // No enable pending: preserve rotation across restart.
        XCTAssertEqual(registration.token, "new-apns"); XCTAssertEqual(returned, ["old-apns"])
        XCTAssertTrue(try PushStore(root: root).registrationStale())
        registration.register(complete, request: { requests += 1 })
        XCTAssertEqual(requests, 2); XCTAssertEqual(returned, ["old-apns"])
        registration.registered("new-apns")
        XCTAssertEqual(returned, ["old-apns", "new-apns"])
        XCTAssertTrue(try store.registrationStale()) // enable alone does not acknowledge relay activation.
        XCTAssertThrowsError(try store.setTopics(registration: "b", topics: [], pushToken: "old-apns"))
        XCTAssertTrue(try store.registrationStale()) // Rejected acknowledgment cannot remove the map.
        try store.setTopics(registration: "b", topics: topics, pushToken: "new-apns")
        XCTAssertFalse(try PushStore(root: root).registrationStale())
        let saved = try String(contentsOf: root.appendingPathComponent("topics.json"), encoding: .utf8)
        XCTAssertFalse(saved.contains("old-apns")); XCTAssertFalse(saved.contains("new-apns"))
    }
    func testRotationDoesNotUnsilenceOrForgetStalenessAndLegacyMapsRequireRefresh() throws {
        let store = try PushStore(root: root)
        XCTAssertFalse(try store.registrationStale())
        try store.setTopics(registration: "b", topics: topics)
        XCTAssertTrue(try store.registrationStale()) // Legacy map has no acknowledged token.
        try store.recordToken("old"); try store.setTopics(registration: "b", topics: topics, pushToken: "old")
        try store.recordToken("old"); XCTAssertFalse(try store.registrationStale())
        try store.silenceAll(); try store.recordToken("rotated")
        XCTAssertFalse(try store.registrationStale()); XCTAssertNil(try store.accept(Self.payload("silenced-rotation")))
        try store.setTopics(registration: "b", topics: topics)
        XCTAssertTrue(try store.registrationStale()) // Updating topics cannot acknowledge an unknown token.
        try store.clear(); XCTAssertFalse(try store.registrationStale())
    }
    func testCachedAPNsTokenCannotBypassFailureTimeoutOrSinglePendingEnable() {
        let registration = PushTokenRegistration(); var requests = 0, successes = 0, failures = 0
        let complete: (Result<String, Error>) -> Void = { result in
            if case .success = result { successes += 1 } else { failures += 1 }
        }
        registration.register(complete, request: { requests += 1 }); registration.registered("old")
        registration.register(complete, request: { requests += 1 })
        registration.register(complete, request: { XCTFail("Second pending request reached APNs") })
        XCTAssertEqual(successes, 1); XCTAssertEqual(failures, 1)
        registration.failed(PushCrypto.Failure.invalid)
        XCTAssertEqual(successes, 1); XCTAssertEqual(failures, 2)
        registration.register(complete, request: { requests += 1 }); registration.cancel() // Inject timeout.
        registration.registered("late")
        XCTAssertEqual(successes, 1); XCTAssertEqual(failures, 2)
        registration.register(complete, request: { requests += 1 }); registration.registered("current")
        XCTAssertEqual(requests, 4); XCTAssertEqual(successes, 2)
    }
    func testForegroundRevalidatesPayloadAndCurrentStateWithoutTrustingProviderText() throws {
        let store = try PushStore(root: root); try store.setTopics(registration: "b", topics: topics)
        var bodies = [String]()
        let present: (PushPayload) throws -> Bool = { payload in
            try store.withPresentation(payload, source: .remote(request: "remote", token: nil)) { bodies.append($0.body) }
        }
        XCTAssertTrue(PushReceiver.foreground("p", decrypt: { _ in Self.padded(Self.json()) }, present: present))
        XCTAssertEqual(bodies, ["New message in Book club"])
        try store.silence("b")
        XCTAssertFalse(PushReceiver.foreground("p", decrypt: { _ in Self.padded(Self.json(id: "silenced")) }, present: present))
        try store.setTopics(registration: "b", topics: [])
        XCTAssertFalse(PushReceiver.foreground("p", decrypt: { _ in Self.padded(Self.json(id: "forgotten")) }, present: present))
        XCTAssertFalse(PushReceiver.foreground(nil, decrypt: { _ in XCTFail("Decrypted absent data"); return Data() }, present: present))
        XCTAssertFalse(PushReceiver.foreground("bad", decrypt: { _ in throw PushCrypto.Failure.invalid }, present: present))
        XCTAssertFalse(PushReceiver.foreground("bad", decrypt: { _ in Data("unvalidated".utf8) }, present: present))
        XCTAssertEqual(bodies.count, 1)
    }
    private func encryptedFixture() throws -> (String, (String) throws -> Data) {
        let key = P256.KeyAgreement.PrivateKey(), auth = Data(repeating: 1, count: 16)
        let encoded = try PushCryptoTests.encrypt(Self.padded(Self.json()), receiver: key, auth: auth)
        return (encoded, { try PushCrypto.decrypt($0, key: key, auth: auth) })
    }
    private func nse(_ encoded: String, request: String, filtering: Bool = false,
                     decrypt: (String) throws -> Data) -> PushReceiver.Outcome {
        PushReceiver.receive(encoded, readable: true, filtering: filtering, decrypt: decrypt,
            accept: { try PushStore(root: self.root).accept($0, request: request, localReplacement: filtering) })
    }
    private func foreground(_ encoded: String?, source: PushStore.PresentationSource,
                            decrypt: (String) throws -> Data, action: (PushStore.Delivery) -> Void) -> Bool {
        PushReceiver.foreground(encoded, decrypt: decrypt, present: { payload in
            try PushStore(root: self.root).withPresentation(payload, source: source, action: action)
        })
    }
    func testNSEThenForegroundPresentsIdenticalPayloadOnce() throws {
        let store = try PushStore(root: root), (encoded, decrypt) = try encryptedFixture()
        try store.setTopics(registration: "b", topics: topics)
        guard case let .notify(accepted) = nse(encoded, request: "first", decrypt: decrypt) else { return XCTFail("First NSE delivery rejected") }
        var replacement: PushStore.Delivery?, bodies = [String]()
        XCTAssertTrue(foreground(encoded, source: .remote(request: "first", token: accepted.presentationToken), decrypt: decrypt) { replacement = $0 })
        let local = try XCTUnwrap(replacement)
        XCTAssertNotEqual(local.presentationToken, accepted.presentationToken); XCTAssertEqual(local.count, 1)
        XCTAssertTrue(foreground(encoded, source: .local(request: local.group, token: local.presentationToken), decrypt: decrypt) { bodies.append($0.body) })
        // A second delivery of identical ciphertext cannot schedule or present again, even with old native metadata.
        for request in ["first", "second"] {
            XCTAssertFalse(foreground(encoded, source: .remote(request: request, token: accepted.presentationToken), decrypt: decrypt) { _ in XCTFail("Replayed NSE handoff") })
        }
        XCTAssertFalse(foreground(encoded, source: .local(request: local.group, token: local.presentationToken), decrypt: decrypt) { _ in XCTFail("Replayed local handoff") })
        XCTAssertEqual(bodies, ["New message in Book club"])
        XCTAssertEqual(try PushStore(root: root).accept(Self.payload("next"))?.count, 2)
    }
    func testForegroundThenForegroundClaimsAndCountsIdenticalPayloadOnce() throws {
        let store = try PushStore(root: root), (encoded, decrypt) = try encryptedFixture()
        try store.setTopics(registration: "b", topics: topics)
        var scheduled = [PushStore.Delivery](), presented = [String]()
        XCTAssertTrue(foreground(encoded, source: .remote(request: "first", token: nil), decrypt: decrypt) { scheduled.append($0) })
        XCTAssertFalse(foreground(encoded, source: .remote(request: "second", token: nil), decrypt: decrypt) { scheduled.append($0) })
        XCTAssertEqual(scheduled.count, 1)
        let local = try XCTUnwrap(scheduled.first); XCTAssertEqual(local.count, 1)
        XCTAssertTrue(foreground(encoded, source: .local(request: local.group, token: local.presentationToken), decrypt: decrypt) { presented.append($0.body) })
        XCTAssertFalse(foreground(encoded, source: .local(request: local.group, token: local.presentationToken), decrypt: decrypt) { presented.append($0.body) })
        // Foreground claims are visible to the NSE too.
        if case .placeholder = nse(encoded, request: "third", decrypt: decrypt) {} else { XCTFail("NSE accepted foreground duplicate") }
        XCTAssertEqual(presented, ["New message in Book club"])
        XCTAssertEqual(try PushStore(root: root).accept(Self.payload("next"))?.count, 2)
    }
    func testNSEDuplicateThenForegroundCannotStealPendingReplacement() throws {
        let store = try PushStore(root: root), (encoded, decrypt) = try encryptedFixture()
        try store.setTopics(registration: "b", topics: topics)
        guard case let .notify(first) = nse(encoded, request: "first", decrypt: decrypt) else { return XCTFail("First NSE delivery rejected") }
        let info: [AnyHashable: Any] = ["p": encoded, PushReceiver.presentationKey: first.presentationToken, "suitePushGroup": first.group]
        for filtering in [false, true] {
            switch nse(encoded, request: "duplicate", filtering: filtering, decrypt: decrypt) {
            case .placeholder: XCTAssertFalse(filtering)
            case .hidden: XCTAssertTrue(filtering)
            case .notify: XCTFail("NSE accepted duplicate")
            }
            let placeholder = PushReceiver.placeholderInfo(info)
            XCTAssertNil(placeholder["p"]); XCTAssertNil(placeholder[PushReceiver.presentationKey]); XCTAssertNil(placeholder["suitePushGroup"])
            XCTAssertFalse(foreground(placeholder["p"] as? String, source: .remote(request: "duplicate", token: nil),
                decrypt: { _ in XCTFail("Rejected placeholder decrypted again"); return Data() }) { _ in XCTFail("Duplicate presented") })
        }
        // Defence in depth if a duplicate still carries p, or copies the original handoff onto a different request.
        for token in [nil, first.presentationToken] as [String?] {
            XCTAssertFalse(foreground(encoded, source: .remote(request: "duplicate", token: token), decrypt: decrypt) { _ in XCTFail("Duplicate claimed pending ID") })
        }
        var replacement: PushStore.Delivery?, presentations = 0
        XCTAssertTrue(foreground(encoded, source: .remote(request: "first", token: first.presentationToken), decrypt: decrypt) { replacement = $0 })
        let local = try XCTUnwrap(replacement)
        XCTAssertTrue(foreground(encoded, source: .local(request: local.group, token: local.presentationToken), decrypt: decrypt) { _ in presentations += 1 })
        XCTAssertFalse(foreground(encoded, source: .remote(request: "duplicate", token: nil), decrypt: decrypt) { _ in presentations += 1 })
        XCTAssertEqual(presentations, 1); XCTAssertEqual(try store.accept(Self.payload("next"))?.count, 2)
    }
    func testFilteringNSEAuthorizesOnlyOneLocalPresentation() throws {
        let store = try PushStore(root: root), (encoded, decrypt) = try encryptedFixture()
        try store.setTopics(registration: "b", topics: topics)
        guard case let .notify(local) = nse(encoded, request: "nse", filtering: true, decrypt: decrypt) else { return XCTFail("First NSE delivery rejected") }
        XCTAssertFalse(foreground(encoded, source: .remote(request: "nse", token: local.presentationToken), decrypt: decrypt) { _ in XCTFail("Local permit used remotely") })
        var presentations = 0
        XCTAssertTrue(foreground(encoded, source: .local(request: local.group, token: local.presentationToken), decrypt: decrypt) { _ in presentations += 1 })
        XCTAssertFalse(foreground(encoded, source: .local(request: local.group, token: local.presentationToken), decrypt: decrypt) { _ in presentations += 1 })
        XCTAssertFalse(foreground(encoded, source: .remote(request: "duplicate", token: nil), decrypt: decrypt) { _ in presentations += 1 })
        XCTAssertEqual(presentations, 1); XCTAssertEqual(try store.accept(Self.payload("next"))?.count, 2)
    }
    func testPresentationRequiresNativePermitRequestAndCurrentSilenceState() throws {
        let store = try PushStore(root: root), payload = try Self.payload("id")
        try store.setTopics(registration: "b", topics: topics)
        let group = PushPolicy.group("b", 1)
        XCTAssertFalse(try store.withPresentation(payload, source: .local(request: group, token: "forged")) { _ in XCTFail("Local delivery claimed unseen ID") })
        let accepted = try XCTUnwrap(store.accept(payload, request: "nse"))
        for source in [PushStore.PresentationSource.remote(request: "nse", token: nil),
                       .remote(request: "nse", token: "forged"), .remote(request: "other", token: accepted.presentationToken),
                       .local(request: group, token: accepted.presentationToken)] {
            XCTAssertFalse(try store.withPresentation(payload, source: source) { _ in XCTFail("Invalid handoff accepted") })
        }
        var local: PushStore.Delivery?
        XCTAssertTrue(try store.withPresentation(payload, source: .remote(request: "nse", token: accepted.presentationToken)) { local = $0 })
        let replacement = try XCTUnwrap(local)
        XCTAssertFalse(try store.withPresentation(payload, source: .local(request: "other", token: replacement.presentationToken)) { _ in XCTFail("Wrong local request") })
        try store.silence("b")
        XCTAssertFalse(try PushStore(root: root).withPresentation(payload, source: .local(request: group, token: replacement.presentationToken)) { _ in XCTFail("Presented after silence") })
    }
    func testConcurrentNSEAndForegroundClaimsUseOneDurableDecision() throws {
        let store = try PushStore(root: root), payload = try Self.payload("race")
        try store.setTopics(registration: "b", topics: topics)
        let resultsLock = NSLock()
        var deliveries = [PushStore.Delivery](), errors = [Error]()
        func record(_ delivery: PushStore.Delivery) { resultsLock.lock(); deliveries.append(delivery); resultsLock.unlock() }
        DispatchQueue.concurrentPerform(iterations: 16) { index in
            do {
                let participant = try PushStore(root: self.root)
                if index % 2 == 0 {
                    if let delivery = try participant.accept(payload, request: "nse-\(index)") { record(delivery) }
                } else {
                    _ = try participant.withPresentation(payload, source: .remote(request: "foreground-\(index)", token: nil), action: record)
                }
            } catch { resultsLock.lock(); errors.append(error); resultsLock.unlock() }
        }
        XCTAssertTrue(errors.isEmpty); XCTAssertEqual(deliveries.count, 1); XCTAssertEqual(deliveries.first?.count, 1)
        XCTAssertEqual(try PushStore(root: root).accept(Self.payload("next"))?.count, 2)
    }
    func testConcurrentHandoffConsumptionPresentsOnce() throws {
        let store = try PushStore(root: root), payload = try Self.payload("race-local")
        try store.setTopics(registration: "b", topics: topics)
        let accepted = try XCTUnwrap(store.accept(payload, request: "nse"))
        let resultsLock = NSLock(); var scheduled = [PushStore.Delivery](), presentations = 0, errors = [Error]()
        DispatchQueue.concurrentPerform(iterations: 16) { _ in
            do {
                _ = try PushStore(root: self.root).withPresentation(payload, source: .remote(request: "nse", token: accepted.presentationToken)) { delivery in
                    resultsLock.lock(); scheduled.append(delivery); resultsLock.unlock()
                }
            } catch { resultsLock.lock(); errors.append(error); resultsLock.unlock() }
        }
        XCTAssertTrue(errors.isEmpty); XCTAssertEqual(scheduled.count, 1)
        let local = try XCTUnwrap(scheduled.first)
        DispatchQueue.concurrentPerform(iterations: 16) { _ in
            do {
                _ = try PushStore(root: self.root).withPresentation(payload, source: .local(request: local.group, token: local.presentationToken)) { _ in
                    resultsLock.lock(); presentations += 1; resultsLock.unlock()
                }
            } catch { resultsLock.lock(); errors.append(error); resultsLock.unlock() }
        }
        XCTAssertTrue(errors.isEmpty); XCTAssertEqual(presentations, 1)
        XCTAssertEqual(try store.accept(Self.payload("next"))?.count, 2)
    }
    func testForegroundDecisionsArePersistedBeforeSchedulingAndPresentation() throws {
        let store = try PushStore(root: root), payload = try Self.payload("durable")
        try store.setTopics(registration: "b", topics: topics)
        var scheduled: PushStore.Delivery?
        // Read the file directly: re-entering the store while holding flock would deadlock.
        let url = root.appendingPathComponent("topics.json")
        XCTAssertTrue(try store.withPresentation(payload, source: .remote(request: "first", token: nil)) { delivery in
            let saved = try? JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
            XCTAssertTrue((saved?["seen"] as? [String])?.contains(payload.id) == true)
            XCTAssertEqual((saved?["counts"] as? [String: Int])?[delivery.group], 1)
            let claim = (saved?["presentations"] as? [String: [String: Any]])?[payload.id]
            XCTAssertEqual(claim?["token"] as? String, delivery.presentationToken)
            XCTAssertEqual(claim?["local"] as? Bool, true); scheduled = delivery
        })
        let local = try XCTUnwrap(scheduled)
        XCTAssertTrue(try store.withPresentation(payload, source: .local(request: local.group, token: local.presentationToken)) { _ in
            let saved = try? JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
            XCTAssertTrue((saved?["seen"] as? [String])?.contains(payload.id) == true)
            let claims = saved?["presentations"] as? [String: Any]
            XCTAssertNotNil(claims); XCTAssertNil(claims?[payload.id])
        })
    }
    func testLegacySeenIDsCannotAcquireNewPresentationPermits() throws {
        let store = try PushStore(root: root), payload = try Self.payload("legacy")
        try store.setTopics(registration: "b", topics: topics); XCTAssertNotNil(try store.accept(payload))
        let url = root.appendingPathComponent("topics.json")
        var state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        state.removeValue(forKey: "presentations"); try JSONSerialization.data(withJSONObject: state).write(to: url)
        let migrated = try PushStore(root: root)
        XCTAssertFalse(try migrated.withPresentation(payload, source: .remote(request: "retry", token: nil)) { _ in XCTFail("Legacy duplicate presented") })
        XCTAssertEqual(try migrated.accept(Self.payload("next"))?.count, 2)
    }
}
