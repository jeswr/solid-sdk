// AUTHORED-BY GPT-5.6 Codex
import Foundation
import CryptoKit
import LocalAuthentication
import Security
import XCTest
@testable import App

struct FakeSecureStoreInstallation: SecureStoreInstallChecking {
    var error: Error?
    func prepare() throws { if let error = error { throw error } }
}

final class FakeSecureStoreWriter: SecureStoreFileWriting {
    var data: Data?
    var fail = false
    var backing: SecureStoreFileWriting?
    func read() throws -> Data? { return try backing?.read() ?? data }
    func write(_ data: Data) throws {
        if fail { throw SecureStoreFailure.failed }
        try backing?.write(data)
        self.data = data
    }
}

final class FakeSecureStoreAuthentication: SecureStoreAuthentication {
    var context: LAContext? { return nil }
    var completion: ((Result<Void, SecureStoreFailure>) -> Void)?
    var invalidated = false
    func authenticate(accessControl: SecAccessControl, completion: @escaping (Result<Void, SecureStoreFailure>) -> Void) {
        self.completion = completion
    }
    func invalidate() { invalidated = true }
}

final class FakeSecureStoreAuthenticator: SecureStoreAuthenticating {
    var sessions = [FakeSecureStoreAuthentication]()
    func makeSession() -> SecureStoreAuthentication {
        let session = FakeSecureStoreAuthentication()
        sessions.append(session)
        return session
    }
}

final class FakeSecureStoreKeys: SecureStoreKeyProviding {
    var userPresence = true
    var hardwareBacked = false
    var key = Data(repeating: 7, count: 32)
    var missing = Set<String>()
    var retired = [String]()
    var ungatedExists = true
    var creates = 0
    var unwraps = 0
    var readError: Error?
    var duringUnwrap: (() -> Void)?
    var eciesKey: SecKey?

    func ungated(create: Bool) throws -> Data {
        if let error = readError { throw error }
        if !ungatedExists {
            if !create { throw SecureStoreRecordFailure.missingKey }
            creates += 1
            ungatedExists = true
        }
        return key
    }

    func wrap(_ data: Data, currentKeyId: String?) throws -> SecureStoreWrappedKey {
        var id = currentKeyId
        if let current = id, missing.contains(current) { try retire(keyId: current); id = nil }
        if id == nil { creates += 1; id = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() }
        if let key = eciesKey {
            guard let publicKey = SecKeyCopyPublicKey(key),
                  let wrapped = SecKeyCreateEncryptedData(publicKey, .eciesEncryptionCofactorVariableIVX963SHA256AESGCM,
                                                          data as CFData, nil) else { throw SecureStoreFailure.failed }
            return SecureStoreWrappedKey(keyId: id!, data: wrapped as Data)
        }
        return SecureStoreWrappedKey(keyId: id!, data: data)
    }

    func accessControl(keyId: String) throws -> SecAccessControl {
        if let error = readError { throw error }
        if missing.contains(keyId) { throw SecureStoreRecordFailure.missingKey }
        return SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [], nil)!
    }

    func unwrap(_ data: Data, keyId: String, authentication: SecureStoreAuthentication) throws -> Data {
        unwraps += 1
        duringUnwrap?()
        if let error = readError { throw error }
        if missing.contains(keyId) { throw SecureStoreRecordFailure.missingKey }
        if let key = eciesKey { return try SecureStoreKeyProvider.unwrap(data, using: key) }
        return data
    }

    func retire(keyId: String) throws { retired.append(keyId) }
}

final class SecureStoreTests: XCTestCase {
    private let queue = DispatchQueue(label: "securestore-tests")
    private let namespace = String(repeating: "a", count: 64)
    private var writer: FakeSecureStoreWriter!
    private var keys: FakeSecureStoreKeys!
    private var authenticator: FakeSecureStoreAuthenticator!
    private var store: SecureStore!
    private var cancellation: SecureStoreCancellation!

    override func setUpWithError() throws {
        try super.setUpWithError()
        writer = FakeSecureStoreWriter()
        keys = FakeSecureStoreKeys()
        authenticator = FakeSecureStoreAuthenticator()
        cancellation = SecureStoreCancellation()
        store = try makeStore()
    }

    override func tearDownWithError() throws {
        queue.sync { store.teardown() }
        store = nil
        try super.tearDownWithError()
    }

    private func makeStore() throws -> SecureStore {
        return try SecureStore(namespace: namespace, queue: queue, installation: FakeSecureStoreInstallation(),
                               writer: { self.writer }, keys: keys, authenticator: authenticator, cancellation: cancellation)
    }

    @discardableResult
    private func set(_ key: String = "a", _ value: String = "token", gated: Bool = false, version: Int64 = 0) throws -> Int64 {
        return try queue.sync { try store.set(key: key, value: value, userPresence: gated, version: version) }
    }

    private func get(_ key: String = "a", authenticated: Bool = false) throws -> SecureStoreRead {
        let done = expectation(description: "read")
        var result: Result<SecureStoreRead, Error>?
        queue.sync {
            store.get(key: key) { result = $0; done.fulfill() }
            if authenticated { authenticator.sessions.last?.completion?(.success(())) }
        }
        wait(for: [done], timeout: 2)
        return try XCTUnwrap(result).get()
    }

    private func state() throws -> SecureStoreState { return try JSONDecoder().decode(SecureStoreState.self, from: XCTUnwrap(writer.data)) }

    private func replaceState(_ state: SecureStoreState) throws {
        writer.data = try JSONEncoder().encode(state)
        store = try makeStore()
    }

    private func failure(_ code: SecureStoreFailure, _ operation: () throws -> Void, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try operation(), file: file, line: line) {
            XCTAssertEqual($0 as? SecureStoreFailure, code, file: file, line: line)
        }
    }

    func testValidationIsExactAndCountsUTF8Bytes() throws {
        for key in ["a", "pod-auth:refresh:012._-", String(repeating: "z", count: 128)] {
            XCTAssertEqual(try SecureStoreValidation.key(key), key)
        }
        for key in ["", "A", "_a", "a/b", "a\n", " a", "a\u{0}", "é", String(repeating: "a", count: 129)] {
            failure(.invalid) { _ = try SecureStoreValidation.key(key) }
        }
        failure(.invalid) { _ = try SecureStoreValidation.key(NSNull()) }
        XCTAssertEqual(try SecureStoreValidation.value(""), "")
        _ = try SecureStoreValidation.value(String(repeating: "é", count: 8192))
        failure(.invalid) { _ = try SecureStoreValidation.value(String(repeating: "é", count: 8193)) }
        failure(.invalid) { _ = try SecureStoreValidation.value(12) }
        for raw in [true, "1", -1, 1.5, Double.nan, Double.infinity, 9_007_199_254_740_992.0, NSNull()] as [Any] {
            failure(.invalid) { _ = try SecureStoreValidation.version(raw) }
        }
        XCTAssertEqual(try SecureStoreValidation.version(0), 0)
        XCTAssertEqual(try SecureStoreValidation.version(SecureStoreValidation.maxVersion), SecureStoreValidation.maxVersion)
        XCTAssertTrue(try SecureStoreValidation.boolean(true))
        XCTAssertFalse(try SecureStoreValidation.boolean(false))
        for raw in [0, 1, "true", NSNull()] as [Any] { failure(.invalid) { _ = try SecureStoreValidation.boolean(raw) } }
    }

    func testVersionsTombstonesAndEpochPersistAndRejectLateRefreshes() throws {
        XCTAssertNil(try get().value)
        XCTAssertEqual(try get().version, 0)
        XCTAssertEqual(try set(), 1)
        XCTAssertEqual(try set("a", "rotated", version: 1), 2)
        failure(.stale) { _ = try set(version: 1) }
        try queue.sync { try store.remove(key: "a") }
        XCTAssertNil(try get().value)
        XCTAssertEqual(try get().version, 3)
        failure(.stale) { _ = try set(version: 2) }
        _ = try set("b")
        XCTAssertEqual(try get("b").value, "token")
        store = try makeStore()
        XCTAssertEqual(try get().version, 3)
        try queue.sync { try store.clear() }
        XCTAssertEqual(try get().version, 4)
        XCTAssertEqual(try get("never-written").version, 4)
        failure(.stale) { _ = try set("never-written") }
        store = try makeStore()
        XCTAssertEqual(try set("a", version: 4), 5)
        try queue.sync { try store.remove(key: "missing") }
        XCTAssertEqual(try get("missing").version, 5)
    }

    func testCapacityCountsBothModesWithoutReadingKeysAndAllowsReplacement() throws {
        for index in 0..<32 { _ = try set("k\(index)", gated: index.isMultiple(of: 2)) }
        XCTAssertTrue(authenticator.sessions.isEmpty)
        let before = writer.data
        failure(.full) { _ = try set("overflow") }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try set("k0", gated: false, version: 1), 2)
        XCTAssertEqual(try set("k1", gated: true, version: 1), 2)
        keys.readError = SecureStoreFailure.unavailable
        failure(.full) { _ = try set("overflow") }
        keys.readError = nil
        try queue.sync { try store.remove(key: "k2") }
        XCTAssertEqual(try set("new"), 1)
        XCTAssertEqual(try state().records.count, 32)
        XCTAssertEqual(try state().version("k2"), 2)
    }

    func testAssociatedDataUsesTheSharedBigEndianLengthPrefixedVector() {
        let bytes = SecureStoreRecordCodec.associatedData(namespace: "ns", key: "a:b", mode: 1, keyId: "id")
        XCTAssertEqual(Array(bytes), [83, 83, 83, 49, 0, 2, 110, 115, 0, 3, 97, 58, 98, 1, 0, 2, 105, 100])
        let long = SecureStoreRecordCodec.associatedData(namespace: String(repeating: "a", count: 256), key: "x", mode: 0, keyId: "ungated")
        XCTAssertEqual(Array(Array(long)[4...5]), [1, 0])
        XCTAssertNotEqual(SecureStoreRecordCodec.associatedData(namespace: "ab", key: "c", mode: 0, keyId: "d"),
                          SecureStoreRecordCodec.associatedData(namespace: "a", key: "bc", mode: 0, keyId: "d"))
    }

    func testAEADRejectsEveryChangedBindingAndHasFreshNonces() throws {
        let codec = SecureStoreRecordCodec()
        let first = try codec.seal("secret", namespace: namespace, key: "a", mode: 0, keyId: "ungated", dataKey: keys.key, wrappedKey: nil)
        let second = try codec.seal("secret", namespace: namespace, key: "a", mode: 0, keyId: "ungated", dataKey: keys.key, wrappedKey: nil)
        XCTAssertNotEqual(first.nonce, second.nonce)
        XCTAssertEqual(first.nonce.count, 12)
        XCTAssertEqual(first.tag.count, 16)
        XCTAssertEqual(try codec.open(first, dataKey: keys.key), "secret")
        for (ns, key, mode, id) in [("other", "a", UInt8(0), "ungated"), (namespace, "b", 0, "ungated"),
                                    (namespace, "a", 1, "ungated"), (namespace, "a", 0, "other")] {
            let moved = SecureStoreRecord(namespace: ns, key: key, mode: mode, keyId: id, wrappedKey: nil,
                                          nonce: first.nonce, ciphertext: first.ciphertext, tag: first.tag)
            XCTAssertThrowsError(try codec.open(moved, dataKey: keys.key)) {
                XCTAssertTrue($0 is SecureStoreRecordFailure)
            }
        }
    }

    func testCorruptParsingLocationAndTagRecoverOnlyTheAffectedRecord() throws {
        for damage in ["parse", "namespace", "location", "mode", "keyId", "tag"] {
            writer.data = nil
            store = try makeStore()
            _ = try set("a")
            _ = try set("b", "neighbor")
            var changed = try state()
            if damage == "parse" { changed.records["a"] = Data("broken".utf8) }
            else if damage == "location" { changed.records["a"] = changed.records["b"] }
            else {
                var record = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(changed.records["a"])) as? [String: Any])
                if damage == "mode" { record[damage] = 2 }
                else if damage == "tag" { record[damage] = Data(repeating: 0, count: 16).base64EncodedString() }
                else { record[damage] = "wrong" }
                changed.records["a"] = try JSONSerialization.data(withJSONObject: record)
            }
            try replaceState(changed)
            XCTAssertNil(try get().value, damage)
            XCTAssertEqual(try get().version, 2)
            XCTAssertEqual(try get("b").value, "neighbor")
            XCTAssertTrue(keys.retired.isEmpty)
        }
    }

    func testMissingKeysRecoverWithoutGeneratingKeysAndRotateOnlyOnSet() throws {
        _ = try set(gated: true)
        _ = try set("b", "neighbor")
        let id = try XCTUnwrap(state().wrappingKeyId)
        keys.missing.insert(id)
        let creates = keys.creates
        XCTAssertNil(try get().value)
        XCTAssertEqual(keys.retired, [id])
        XCTAssertEqual(keys.creates, creates)
        XCTAssertEqual(try get("b").value, "neighbor")
        _ = try set("a", gated: true, version: 2)
        XCTAssertNotEqual(try state().wrappingKeyId, id)
        XCTAssertEqual(keys.creates, creates + 1)
        keys.ungatedExists = false
        XCTAssertNil(try get("b").value)
        XCTAssertEqual(keys.creates, creates + 1)
    }

    func testRealECIESWrappersRoundTripAndCorruptionRecoversOnlyThatRecord() throws {
        let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                                        kSecAttrKeySizeInBits as String: 256]
        // A software P-256 key exercises Security's real ECIES framing and tag checks on a simulator too.
        keys.eciesKey = try XCTUnwrap(SecKeyCreateRandomKey(attributes as CFDictionary, nil))
        for damage in ["truncated", "tag", "point"] {
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            _ = try set("b", "neighbor")
            XCTAssertEqual(try get(authenticated: true).value, "token")
            var changed = try state()
            var record = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(changed.records["a"])) as? [String: Any])
            var wrapper = try XCTUnwrap(Data(base64Encoded: XCTUnwrap(record["wrappedKey"] as? String)))
            if damage == "truncated" { wrapper = Data(wrapper.prefix(80)) }
            else if damage == "point" { wrapper[0] = 0x02 }
            else { wrapper[wrapper.count - 1] ^= 1 }
            record["wrappedKey"] = wrapper.base64EncodedString()
            changed.records["a"] = try JSONSerialization.data(withJSONObject: record)
            try replaceState(changed)
            let creates = keys.creates
            let recovered = try get(authenticated: true)
            XCTAssertNil(recovered.value, damage)
            XCTAssertEqual(recovered.version, 2)
            XCTAssertNil(try state().records["a"])
            XCTAssertEqual(try get("b").value, "neighbor")
            XCTAssertTrue(keys.retired.isEmpty)
            XCTAssertEqual(keys.creates, creates)
        }
    }

    func testECIESUnwrapErrorMappingPreservesAuthenticationAndInteractionFailures() throws {
        for status in [errSecDecode, errSecParam] {
            let error = try XCTUnwrap(CFErrorCreate(nil, kCFErrorDomainOSStatus, Int(status), nil))
            XCTAssertTrue(SecureStoreKeyProvider.unwrapFailure(error) is SecureStoreRecordFailure)
        }
        for (status, code) in [(errSecUserCanceled, SecureStoreFailure.cancelled),
                                (errSecAuthFailed, .failed), (errSecInteractionNotAllowed, .unavailable)] {
            let error = try XCTUnwrap(CFErrorCreate(nil, kCFErrorDomainOSStatus, Int(status), nil))
            XCTAssertEqual(SecureStoreKeyProvider.unwrapFailure(error) as? SecureStoreFailure, code)
        }
        for (status, code) in [(LAError.Code.systemCancel, SecureStoreFailure.cancelled),
                                (.biometryLockout, .lockout), (.notInteractive, .unavailable)] {
            let error = try XCTUnwrap(CFErrorCreate(nil, LAError.errorDomain as CFString, status.rawValue, nil))
            XCTAssertEqual(SecureStoreKeyProvider.unwrapFailure(error) as? SecureStoreFailure, code)
        }
    }

    func testMalformedOuterRecordEncodingAlsoRecoversOnlyThatRecord() throws {
        for corrupt in ["not base64", NSNull(), ["unexpected": "object"]] as [Any] {
            writer.data = nil
            store = try makeStore()
            _ = try set("a")
            _ = try set("b", "neighbor")
            var root = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(writer.data)) as? [String: Any])
            var records = try XCTUnwrap(root["records"] as? [String: Any])
            records["a"] = corrupt
            root["records"] = records
            writer.data = try JSONSerialization.data(withJSONObject: root)
            store = try makeStore()
            XCTAssertNil(try get().value)
            XCTAssertEqual(try get().version, 2)
            XCTAssertEqual(try get("b").value, "neighbor")
        }
    }

    func testTransientKeyErrorsPreserveTheFileAndEveryVersion() throws {
        _ = try set()
        let before = writer.data
        for error in [SecureStoreFailure.lockout, .unavailable, .cancelled, .failed] {
            keys.readError = error
            failure(error) { _ = try get() }
            XCTAssertEqual(writer.data, before)
        }
        keys.readError = nil
        XCTAssertEqual(try get().value, "token")
        XCTAssertEqual(try get().version, 1)
    }

    func testFailedCommitsKeepDiskAndMemoryForSetRemoveClearAndRecovery() throws {
        _ = try set()
        let before = writer.data
        writer.fail = true
        failure(.failed) { _ = try set("a", "changed", version: 1) }
        failure(.failed) { _ = try queue.sync { try store.remove(key: "a") } }
        failure(.failed) { _ = try queue.sync { try store.clear() } }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try get().value, "token")
        XCTAssertEqual(try get().version, 1)
        keys.ungatedExists = false
        failure(.failed) { _ = try get() }
        XCTAssertEqual(writer.data, before)
        keys.ungatedExists = true
        writer.fail = false
        store = try makeStore()
        XCTAssertEqual(try get().value, "token")
        XCTAssertEqual(try set("a", "next", version: 1), 2)
    }

    func testSafeIntegerExhaustionNeverWrapsOrPartiallyChangesState() throws {
        var exhausted = SecureStoreState()
        exhausted.epoch = SecureStoreValidation.maxVersion
        try replaceState(exhausted)
        let before = writer.data
        failure(.failed) { _ = try set(version: SecureStoreValidation.maxVersion) }
        failure(.failed) { _ = try queue.sync { try store.remove(key: "a") } }
        failure(.failed) { _ = try queue.sync { try store.clear() } }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try get().version, SecureStoreValidation.maxVersion)
    }

    func testMalformedNamespaceStateFailsClosedInsteadOfResettingVersions() throws {
        writer.data = Data("broken state".utf8)
        XCTAssertThrowsError(try makeStore())
        var invalid = SecureStoreState()
        invalid.epoch = -1
        writer.data = try JSONEncoder().encode(invalid)
        XCTAssertThrowsError(try makeStore())
        invalid.epoch = 5
        invalid.versions["a"] = 4
        writer.data = try JSONEncoder().encode(invalid)
        XCTAssertThrowsError(try makeStore())
        XCTAssertEqual(try get().version, 0)
    }

    func testGatedWritesNeverAuthenticateAndUnavailableNeverDowngrades() throws {
        _ = try set(gated: true)
        XCTAssertTrue(authenticator.sessions.isEmpty)
        let before = writer.data
        keys.userPresence = false
        failure(.unavailable) { _ = try set("a", "rotation", gated: true, version: 1) }
        XCTAssertEqual(writer.data, before)
        XCTAssertEqual(try state().records.count, 1)
    }

    func testEachReadHasAFreshSessionAndFinishingInvalidatesIt() throws {
        _ = try set(gated: true)
        for _ in 0..<2 {
            let done = expectation(description: "authenticated read")
            queue.sync {
                store.get(key: "a") { result in
                    do { XCTAssertEqual(try result.get().value, "token") }
                    catch { XCTFail("Unexpected read failure: \(error)") }
                    done.fulfill()
                }
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [done], timeout: 2)
            XCTAssertTrue(try XCTUnwrap(authenticator.sessions.last).invalidated)
        }
        XCTAssertEqual(authenticator.sessions.count, 2)
        XCTAssertFalse(authenticator.sessions[0] === authenticator.sessions[1])
        XCTAssertEqual(keys.unwraps, 2)
    }

    func testPromptFailuresDoNotDeleteRecordsOrAllowLateSuccess() throws {
        _ = try set(gated: true)
        let before = writer.data
        for code in [SecureStoreFailure.background, .cancelled, .lockout, .unavailable, .failed] {
            let done = expectation(description: "prompt failure")
            var completions = 0
            queue.sync {
                store.get(key: "a") { result in
                    completions += 1
                    XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, code) }
                    done.fulfill()
                }
                authenticator.sessions.last?.completion?(.failure(code))
            }
            wait(for: [done], timeout: 2)
            queue.sync { authenticator.sessions.last?.completion?(.success(())) }
            queue.sync { XCTAssertEqual(completions, 1) }
            XCTAssertEqual(writer.data, before)
        }
        XCTAssertEqual(keys.unwraps, 0)
    }

    func testCancelBackgroundNavigationRemoveClearAndTeardownDropLateCallbacks() throws {
        for trigger in ["cancel", "background", "navigation", "remove", "clear", "teardown"] {
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            let done = expectation(description: trigger)
            var completions = 0
            try queue.sync {
                store.get(key: "a") { result in
                    completions += 1
                    XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .cancelled) }
                    done.fulfill()
                }
                switch trigger {
                case "background": store.background()
                case "navigation": store.navigationCommitted()
                case "remove": try store.remove(key: "a")
                case "clear": try store.clear()
                case "teardown": store.teardown()
                default: store.cancel()
                }
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [done], timeout: 2)
            queue.sync { XCTAssertEqual(completions, 1) }
            XCTAssertTrue(try XCTUnwrap(authenticator.sessions.last).invalidated)
        }
        XCTAssertEqual(keys.unwraps, 0)
    }

    func testRemovingAnotherKeyDoesNotCancelAndARotationMakesTheOldReadStale() throws {
        _ = try set(gated: true)
        let done = expectation(description: "rotated during prompt")
        try queue.sync {
            store.get(key: "a") { result in
                XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .stale) }
                done.fulfill()
            }
            try store.remove(key: "b")
            XCTAssertFalse(authenticator.sessions[0].invalidated)
            _ = try store.set(key: "a", value: "new", userPresence: false, version: 1)
            authenticator.sessions[0].completion?(.success(()))
        }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(try get().value, "new")
        XCTAssertEqual(keys.unwraps, 0)
    }

    func testSynchronousCancellationDuringDecryptionCannotReturnPlaintextOrDeleteTheRecord() throws {
        for trigger in ["background", "navigation", "cancel", "remove", "clear", "teardown"] {
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            let before = writer.data
            let decrypting = expectation(description: "decrypting: \(trigger)")
            let done = expectation(description: "cancelled: \(trigger)")
            let resume = DispatchSemaphore(value: 0)
            keys.duringUnwrap = {
                decrypting.fulfill()
                XCTAssertEqual(resume.wait(timeout: .now() + 2), .success)
            }
            var completions = 0
            queue.sync {
                store.get(key: "a") { result in
                    completions += 1
                    XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .cancelled) }
                    done.fulfill()
                }
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [decrypting], timeout: 2)
            // The bridge records this on the calling thread before enqueuing prompt cleanup.
            cancellation.cancel(key: trigger == "remove" ? "a" : nil)
            queue.async { self.store.cancelInvalidated() }
            resume.signal()
            wait(for: [done], timeout: 2)
            queue.sync {
                XCTAssertEqual(completions, 1)
                keys.duringUnwrap = nil
            }
            XCTAssertEqual(writer.data, before)
            XCTAssertEqual(try XCTUnwrap(authenticator.sessions.last).invalidated, true)
        }
    }

    func testCancellationBetweenDecryptionAndBridgeDeliveryRejectsTheOldGeneration() throws {
        _ = try set(gated: true)
        let ticket = cancellation.ticket(key: "a")
        let read = try get(authenticated: true)
        cancellation.cancel()
        cancellation.deliver(ticket, .success(read)) { result in
            XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .cancelled) }
        }
        let current = cancellation.ticket(key: "a")
        cancellation.cancel(key: "b")
        cancellation.deliver(current, .success(read)) { result in
            XCTAssertEqual(try? result.get().value, "token")
        }
    }

    func testQueuedCancellationCleanupDoesNotCancelANewerGeneration() throws {
        _ = try set(gated: true)
        cancellation.cancel()
        let done = expectation(description: "new generation succeeds")
        queue.sync {
            store.get(key: "a") { result in
                XCTAssertEqual(try? result.get().value, "token")
                done.fulfill()
            }
            store.cancelInvalidated()
            authenticator.sessions.last?.completion?(.success(()))
        }
        wait(for: [done], timeout: 2)
    }

    func testAnOldOperationIdCannotFinishANewRead() throws {
        _ = try set(gated: true)
        let first = expectation(description: "first cancelled")
        let second = expectation(description: "second succeeded")
        queue.sync {
            store.get(key: "a") { result in
                XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .cancelled) }
                first.fulfill()
            }
            store.cancel()
            store.get(key: "a") { result in
                XCTAssertEqual(try? result.get().value, "token")
                second.fulfill()
            }
            authenticator.sessions[0].completion?(.success(()))
            authenticator.sessions[1].completion?(.success(()))
        }
        wait(for: [first, second], timeout: 2)
        XCTAssertEqual(keys.unwraps, 1)
    }

    func testRemoveCancelsOnlyItsKeyAndClearCancelsAllKeys() throws {
        for clear in [false, true] {
            writer.data = nil
            store = try makeStore()
            _ = try set("a", gated: true)
            _ = try set("b", "neighbor", gated: true)
            let a = expectation(description: "a cancelled")
            let b = expectation(description: "b settled")
            let start = authenticator.sessions.count
            try queue.sync {
                store.get(key: "a") { result in
                    XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .cancelled) }
                    a.fulfill()
                }
                store.get(key: "b") { result in
                    if clear { XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .cancelled) } }
                    else { XCTAssertEqual(try? result.get().value, "neighbor") }
                    b.fulfill()
                }
                if clear { try store.clear() }
                else {
                    try store.remove(key: "a")
                    XCTAssertFalse(authenticator.sessions[start + 1].invalidated)
                }
                authenticator.sessions[start].completion?(.success(()))
                authenticator.sessions[start + 1].completion?(.success(()))
            }
            wait(for: [a, b], timeout: 2)
        }
        XCTAssertEqual(keys.unwraps, 1)
    }

    func testRecoveryAfterAuthenticationStillDistinguishesMissingCorruptAndTransientFailures() throws {
        let errors: [Error] = [SecureStoreRecordFailure.missingKey, SecureStoreRecordFailure.corrupt,
                               SecureStoreFailure.unavailable, SecureStoreFailure.lockout, SecureStoreFailure.cancelled, SecureStoreFailure.failed]
        for error in errors {
            keys.readError = nil
            keys.retired = []
            writer.data = nil
            store = try makeStore()
            _ = try set(gated: true)
            _ = try set("b", "neighbor")
            let before = writer.data
            let done = expectation(description: "unwrap failure")
            queue.sync {
                store.get(key: "a") { result in
                    if error is SecureStoreRecordFailure {
                        XCTAssertNil(try? result.get().value)
                        XCTAssertEqual(try? result.get().version, 2)
                    } else {
                        XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, error as? SecureStoreFailure) }
                    }
                    done.fulfill()
                }
                keys.readError = error
                authenticator.sessions.last?.completion?(.success(()))
            }
            wait(for: [done], timeout: 2)
            if error is SecureStoreFailure { XCTAssertEqual(writer.data, before) }
            XCTAssertEqual(keys.retired.count, SecureStoreRecovery.shouldRetire(error) ? 1 : 0)
            keys.readError = nil
            XCTAssertEqual(try get("b").value, "neighbor")
        }
    }

    func testNativeErrorMappingContainsOnlyContractCodes() {
        XCTAssertEqual(SecureStoreFailure.code(NSError(domain: "secret native detail", code: 12)), .failed)
        XCTAssertEqual(SecureStoreAuthenticationSession.failure(NSError(domain: LAError.errorDomain, code: LAError.Code.systemCancel.rawValue)), .cancelled)
        XCTAssertEqual(SecureStoreAuthenticationSession.failure(NSError(domain: LAError.errorDomain, code: LAError.Code.biometryLockout.rawValue)), .lockout)
        XCTAssertEqual(SecureStoreAuthenticationSession.failure(NSError(domain: LAError.errorDomain, code: LAError.Code.passcodeNotSet.rawValue)), .unavailable)
        XCTAssertThrowsError(try SecureStoreKeyProvider.check(errSecInteractionNotAllowed)) {
            XCTAssertEqual($0 as? SecureStoreFailure, .unavailable)
        }
        for code in [SecureStoreFailure.cancelled, .background, .lockout, .unavailable, .stale, .full, .invalid, .failed] {
            XCTAssertFalse(SecureStoreRecovery.shouldRemove(code))
        }
    }

    func testRealAuthenticatorChecksForegroundBeforePromptingAndHonoursEarlyCancellation() throws {
        let access = try XCTUnwrap(SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [], nil))
        let authenticator = SecureStoreAuthenticator(isForeground: { false })
        let first = authenticator.makeSession()
        let second = authenticator.makeSession()
        XCTAssertFalse(first === second)
        XCTAssertEqual(first.context?.touchIDAuthenticationAllowableReuseDuration, 0)
        let background = expectation(description: "no foreground scene")
        first.authenticate(accessControl: access) { result in
            XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .background) }
            first.invalidate()
            background.fulfill()
        }
        let cancelled = expectation(description: "cancel before presentation")
        second.invalidate()
        second.authenticate(accessControl: access) { result in
            XCTAssertThrowsError(try result.get()) { XCTAssertEqual($0 as? SecureStoreFailure, .cancelled) }
            cancelled.fulfill()
        }
        wait(for: [background, cancelled], timeout: 2)
    }
}
