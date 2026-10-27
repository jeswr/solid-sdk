// AUTHORED-BY GPT-5.6 Codex
import Foundation
import CryptoKit
import Security
import XCTest
@testable import App

final class SecureStorePersistenceTests: XCTestCase {
    private var support: URL!
    private var namespace: String!
    private var services = [String]()
    private var tags = [Data]()
    private let queue = DispatchQueue(label: "securestore-persistence-tests")

    override func setUpWithError() throws {
        try super.setUpWithError()
        support = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        namespace = SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: URL(string: "https://\(UUID().uuidString.lowercased()).example"))))
        services = [SecureStoreKeychainWiper.prefix + namespace]
        tags = []
    }

    override func tearDownWithError() throws {
        for service in services { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary) }
        for tag in tags { SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag] as CFDictionary) }
        try? FileManager.default.removeItem(at: support)
        try super.tearDownWithError()
    }

    private func makeStore(_ namespace: String? = nil, writer: SecureStoreFileWriting? = nil) throws -> SecureStore {
        let ns = namespace ?? self.namespace!
        return try SecureStore(namespace: ns, queue: queue, installation: FakeSecureStoreInstallation(),
                               writer: {
                                   if let writer = writer { return writer }
                                   return try SecureStoreFileWriter(support: self.support, namespace: ns)
                               },
                               keys: SecureStoreKeyProvider(namespace: ns), authenticator: FakeSecureStoreAuthenticator())
    }

    private func get(_ store: SecureStore, _ key: String = "a") throws -> SecureStoreRead {
        let done = expectation(description: "real ungated read")
        var result: Result<SecureStoreRead, Error>?
        queue.sync { store.get(key: key) { result = $0; done.fulfill() } }
        wait(for: [done], timeout: 2)
        return try XCTUnwrap(result).get()
    }

    private func set(_ store: SecureStore, _ value: String, version: Int64) throws -> Int64 {
        return try queue.sync { try store.set(key: "a", value: value, userPresence: false, version: version) }
    }

    func testRealFileAndKeychainRoundTripReplaceTombstoneAndEpoch() throws {
        var store = try makeStore()
        XCTAssertEqual(try set(store, "refresh-token-that-must-not-be-on-disk", version: 0), 1)
        let file = try SecureStoreFileWriter(support: support, namespace: namespace).file
        let bytes = try Data(contentsOf: file)
        XCTAssertNil(bytes.range(of: Data("refresh-token-that-must-not-be-on-disk".utf8)))
        XCTAssertEqual(file.lastPathComponent, "\(namespace!).bin")
        let directory = file.deletingLastPathComponent()
        XCTAssertTrue(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        let protection = try FileManager.default.attributesOfItem(atPath: file.path)[.protectionKey] as? FileProtectionType
        XCTAssertEqual(protection, .completeUntilFirstUserAuthentication)
        store = try makeStore()
        XCTAssertEqual(try get(store).value, "refresh-token-that-must-not-be-on-disk")
        XCTAssertEqual(try get(store).version, 1)
        XCTAssertEqual(try set(store, "rotated", version: 1), 2)
        store = try makeStore()
        XCTAssertEqual(try get(store).value, "rotated")
        try queue.sync { try store.remove(key: "a") }
        store = try makeStore()
        XCTAssertNil(try get(store).value)
        XCTAssertEqual(try get(store).version, 3)
        XCTAssertEqual(try set(store, "signed-in-again", version: 3), 4)
        try queue.sync { try store.clear() }
        store = try makeStore()
        XCTAssertNil(try get(store).value)
        XCTAssertEqual(try get(store).version, 5)
        XCTAssertEqual(try get(store, "never-written").version, 5)
        XCTAssertThrowsError(try set(store, "late-refresh", version: 4)) { XCTAssertEqual($0 as? SecureStoreFailure, .stale) }
        XCTAssertEqual(try set(store, "fresh", version: 5), 6)
        var result: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: services[0], kSecAttrAccount as String: "record",
                                    kSecReturnAttributes as String: true]
        XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, &result), errSecSuccess)
        let attributes = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(attributes[kSecAttrAccessible as String] as? String, kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
        XCTAssertNotEqual(attributes[kSecAttrSynchronizable as String] as? Bool, true)
    }

    func testNamespaceSplitIncludesStateKeysAndEveryMutation() throws {
        let origin = try XCTUnwrap(SuiteOrigin(url: URL(string: "https://suite.example")))
        XCTAssertEqual(SecureStoreValidation.namespace(origin), SHA256.hash(data: Data("https://suite.example".utf8)).map { String(format: "%02x", $0) }.joined())
        XCTAssertEqual(SecureStoreValidation.namespace(origin), SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: URL(string: "https://suite.example:443/path")))))
        for url in ["https://suite.example:444", "http://suite.example", "https://other.example"] {
            XCTAssertNotEqual(SecureStoreValidation.namespace(origin), SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: URL(string: url)))))
        }
        let other = SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: URL(string: "https://\(UUID().uuidString.lowercased()).example:444"))))
        services.append(SecureStoreKeychainWiper.prefix + other)
        let a = try makeStore()
        let b = try makeStore(other)
        _ = try set(a, "origin-a", version: 0)
        XCTAssertNil(try get(b).value)
        _ = try set(b, "origin-b", version: 0)
        XCTAssertNotEqual(try SecureStoreKeyProvider(namespace: namespace).ungated(create: false), try SecureStoreKeyProvider(namespace: other).ungated(create: false))
        try queue.sync { try b.remove(key: "a"); try b.clear() }
        XCTAssertEqual(try get(a).value, "origin-a")
        let aFile = try SecureStoreFileWriter(support: support, namespace: namespace)
        let bFile = try SecureStoreFileWriter(support: support, namespace: other)
        try bFile.write(try XCTUnwrap(aFile.read()))
        let copied = try makeStore(other)
        XCTAssertNil(try get(copied).value)
        XCTAssertEqual(try get(a).value, "origin-a")
    }

    func testFailingWriterLeavesTheRealFileAndInMemoryStateUnchanged() throws {
        let real = try SecureStoreFileWriter(support: support, namespace: namespace)
        let failing = FakeSecureStoreWriter()
        failing.backing = real
        let store = try makeStore(writer: failing)
        _ = try set(store, "old", version: 0)
        let old = try real.read()
        failing.fail = true
        XCTAssertThrowsError(try set(store, "new", version: 1))
        XCTAssertThrowsError(try queue.sync { try store.remove(key: "a") })
        XCTAssertThrowsError(try queue.sync { try store.clear() })
        XCTAssertEqual(try real.read(), old)
        XCTAssertEqual(try get(store).value, "old")
        XCTAssertEqual(try get(makeStore()).value, "old")
        XCTAssertEqual(try get(store).version, 1)
    }

    private func addPassword(service: String) throws {
        services.append(service)
        let item: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                   kSecAttrAccount as String: "record", kSecValueData as String: Data(repeating: 3, count: 32),
                                   kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                   kSecAttrSynchronizable as String: false]
        XCTAssertEqual(SecItemAdd(item as CFDictionary, nil), errSecSuccess)
    }

    private func addKey(tag: Data) throws {
        tags.append(tag)
        let attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                                         kSecAttrKeySizeInBits as String: 256,
                                         kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag]]
        var error: Unmanaged<CFError>?
        XCTAssertNotNil(SecKeyCreateRandomKey(attributes as CFDictionary, &error))
        if let error = error { throw error.takeRetainedValue() as Error }
    }

    private func passwordStatus(_ service: String) -> OSStatus {
        return SecItemCopyMatching([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary, nil)
    }

    private func keyStatus(_ tag: Data) -> OSStatus {
        return SecItemCopyMatching([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag] as CFDictionary, nil)
    }

    func testMissingInstallMarkerWipesAllNamespacesAndBothKeychainClassesByPrefix() throws {
        let service = SecureStoreKeychainWiper.prefix + namespace!
        let otherService = SecureStoreKeychainWiper.prefix + UUID().uuidString.lowercased()
        let neighbor = "org.jeswr.suite.securestore-neighbor.\(UUID().uuidString)"
        try addPassword(service: service)
        try addPassword(service: otherService)
        try addPassword(service: neighbor)
        let tag = Data("\(service).0123456789abcdef0123456789abcdef".utf8)
        let otherTag = Data("\(otherService).0123456789abcdef0123456789abcdef".utf8)
        let neighborTag = Data(neighbor.utf8)
        try addKey(tag: tag)
        try addKey(tag: otherTag)
        try addKey(tag: neighborTag)
        let file = try SecureStoreFileWriter(support: support, namespace: namespace)
        try file.write(Data("old-state".utf8))
        let otherFile = try SecureStoreFileWriter(support: support, namespace: "other")
        try otherFile.write(Data("another-origin".utf8))
        let installation = SecureStoreInstallation(support: support, keys: SecureStoreKeychainWiper())
        try installation.prepare()
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.file.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: otherFile.file.path))
        XCTAssertEqual(passwordStatus(service), errSecItemNotFound)
        XCTAssertEqual(passwordStatus(otherService), errSecItemNotFound)
        XCTAssertEqual(keyStatus(tag), errSecItemNotFound)
        XCTAssertEqual(keyStatus(otherTag), errSecItemNotFound)
        XCTAssertEqual(passwordStatus(neighbor), errSecSuccess)
        XCTAssertEqual(keyStatus(neighborTag), errSecSuccess)
        XCTAssertTrue(try installation.marker.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        try addPassword(service: service)
        let kept = try SecureStoreFileWriter(support: support, namespace: namespace)
        try kept.write(Data("new-install".utf8))
        try installation.prepare()
        XCTAssertEqual(passwordStatus(service), errSecSuccess)
        XCTAssertEqual(try kept.read(), Data("new-install".utf8))
    }

    func testInstallFailureDoesNotPublishAMarkerAndCallsCannotReadUntilItSucceeds() throws {
        struct FailingWiper: SecureStoreKeyWiping { func wipe() throws { throw SecureStoreFailure.failed } }
        let installation = SecureStoreInstallation(support: support, keys: FailingWiper())
        var opened = false
        XCTAssertThrowsError(try SecureStore(namespace: namespace, queue: queue, installation: installation, writer: {
            opened = true
            return FakeSecureStoreWriter()
        }, keys: FakeSecureStoreKeys(), authenticator: FakeSecureStoreAuthenticator()))
        XCTAssertFalse(opened)
        XCTAssertFalse(FileManager.default.fileExists(atPath: installation.marker.path))
        let successful = SecureStoreInstallation(support: support, keys: SecureStoreKeychainWiper())
        try successful.prepare()
        XCTAssertTrue(FileManager.default.fileExists(atPath: successful.marker.path))
    }

    func testRealAdapterReportsWriteFailuresAndMissingKeysNeverGetGeneratedByReads() throws {
        let writer = try SecureStoreFileWriter(support: support, namespace: namespace)
        XCTAssertNil(try writer.read())
        try FileManager.default.createDirectory(at: writer.file, withIntermediateDirectories: true)
        XCTAssertThrowsError(try writer.write(Data([1])))
        XCTAssertThrowsError(try writer.read())
        let provider = SecureStoreKeyProvider(namespace: namespace)
        XCTAssertThrowsError(try provider.ungated(create: false)) { XCTAssertTrue($0 is SecureStoreRecordFailure) }
        XCTAssertEqual(passwordStatus(services[0]), errSecItemNotFound)
    }
}
