// AUTHORED-BY Codex GPT-6
import Foundation
import Security
import XCTest
@testable import App

final class SecureStoreMigrationTests: XCTestCase {
    private var root: URL!
    private var oldOrigin: String!
    private var old: String!
    private var local: String!
    private let fm = FileManager.default

    final class Keys: SecureStoreMigrationKeys {
        var entries = [String: [Data]]()
        var deletions = 0
        var failAfter = -1
        var ignoreDeletion = false
        var failEnumeration = false
        func artifacts(namespace: String) throws -> [Data] {
            if failEnumeration { throw SecureStoreFailure.failed }
            return entries[namespace] ?? []
        }
        func delete(_ reference: Data) throws {
            if !ignoreDeletion {
                for namespace in Array(entries.keys) { entries[namespace]?.removeAll { $0 == reference } }
            }
            deletions += 1
            if deletions == failAfter { throw SecureStoreFailure.failed }
        }
    }

    override func setUpWithError() throws {
        root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        oldOrigin = "https://\(UUID().uuidString.lowercased()).example"
        old = SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: URL(string: oldOrigin))))
        local = SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin.local(URL(string: "capacitor://localhost"))))
    }
    override func tearDownWithError() throws { try? fm.removeItem(at: root) }
    private func plan(_ origins: [Any]? = nil) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["target": "native", "predecessorOrigins": origins ?? [oldOrigin!]])
    }
    private func state(_ namespace: String) -> URL { root.appendingPathComponent("securestore/\(namespace).bin") }
    private func write(_ file: URL, _ data: Data = Data([42])) throws {
        try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: file)
    }
    private func seed() throws -> Keys {
        let keys = Keys()
        keys.entries[old] = [Data("old-ungated".utf8), Data("old-gated".utf8)]
        keys.entries[local] = [Data("local".utf8)]
        keys.entries[old + "0"] = [Data("neighbour".utf8)]
        var session = SecureStoreState()
        session.records["pod-auth:refresh:a"] = Data([42])
        session.versions["pod-auth:refresh:a"] = 1
        try write(state(old), JSONEncoder().encode(session)); try write(state(local), Data([43]))
        try write(root.appendingPathComponent("share/pending/item"), Data([44]))
        return keys
    }
    private func survivors(_ keys: Keys) throws {
        XCTAssertEqual(try Data(contentsOf: state(local)), Data([43]))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("share/pending/item")), Data([44]))
        XCTAssertEqual(keys.entries[local], [Data("local".utf8)])
        XCTAssertEqual(keys.entries[old + "0"], [Data("neighbour".utf8)])
    }
    private func removed(_ keys: Keys) {
        XCTAssertFalse(fm.fileExists(atPath: state(old).path))
        XCTAssertEqual(keys.entries[old] ?? [], [])
        XCTAssertTrue(fm.fileExists(atPath: root.appendingPathComponent("securestore-migration/\(old!).bin").path))
    }

    func testExactScopeAndOneShotSurviveRestartsAndDuplicateOrigins() throws {
        let keys = try seed()
        let migration = SecureStoreMigration(support: root, keys: keys)
        try migration.run(plan([oldOrigin!, oldOrigin!]))
        XCTAssertEqual(keys.deletions, 2)
        removed(keys); try survivors(keys)
        XCTAssertTrue(try SecureStoreMigration(support: root, keys: keys).takeNotice())
        try migration.run(plan())
        XCTAssertFalse(try migration.takeNotice())
        try survivors(keys)
    }

    func testEveryMissingArtifactCombinationAndExistingMarker() throws {
        for mask in 0..<8 {
            try? fm.removeItem(at: root)
            let keys = try seed()
            if mask & 1 != 0 { try fm.removeItem(at: state(old)) }
            if mask & 2 != 0 { keys.entries[old]?.removeAll { $0 == Data("old-ungated".utf8) } }
            if mask & 4 != 0 { keys.entries[old]?.removeAll { $0 == Data("old-gated".utf8) } }
            try write(root.appendingPathComponent("securestore-migration/\(old!).bin"), Data([1]))
            let migration = SecureStoreMigration(support: root, keys: keys)
            try migration.run(plan())
            removed(keys); try survivors(keys)
            XCTAssertEqual(try migration.takeNotice(), mask != 7)
            try migration.run(plan())
            XCTAssertFalse(try migration.takeNotice())
        }
    }

    func testInterruptionAtEveryDurableTransitionResumesAndKeepsNotice() throws {
        // notice write, state deletion, each key deletion, and completion marker.
        for stop in 1...5 {
            try? fm.removeItem(at: root)
            let keys = try seed()
            var transitions = 0
            let migration = SecureStoreMigration(support: root, keys: keys, checkpoint: {
                transitions += 1
                if transitions == stop { throw SecureStoreFailure.failed }
            })
            XCTAssertThrowsError(try migration.run(plan()))
            let resumed = SecureStoreMigration(support: root, keys: keys)
            try resumed.run(plan())
            removed(keys); try survivors(keys)
            XCTAssertTrue(try resumed.takeNotice())
            XCTAssertFalse(try resumed.takeNotice())
        }
    }

    func testMalformedWholePlanNeverTouchesAnyArtifact() throws {
        let keys = try seed()
        let migration = SecureStoreMigration(support: root, keys: keys)
        let hostile: [Any] = ["http://old.example", "https://old.example/", "https://old.example/path", "https://a@old.example",
                              "https://old.example?", "https://old.example#", "https://old.example:443", "https://old.example:0",
                              "https://old.example:65536", "https://OLD.example", "https://localhost", "https://localhost:8443",
                              "https://a.localhost", "capacitor://localhost", "https://old.example\\path", "https://bad host", "https://bad%20host", " https://old.example",
                              "https://old.example\n", "https://old.example/../", "https://old example", "https://", "https://%65vil.example", "", NSNull(), 5, ["origin": oldOrigin!]]
        for entry in hostile {
            XCTAssertThrowsError(try migration.run(plan([oldOrigin!, entry])))
            XCTAssertTrue(fm.fileExists(atPath: state(old).path))
            XCTAssertEqual(keys.deletions, 0)
            XCTAssertFalse(fm.fileExists(atPath: root.appendingPathComponent("securestore-migration").path))
            try survivors(keys)
        }
        for data in [Data("{".utf8), Data("null".utf8), Data("{}".utf8), try plan(Array(repeating: oldOrigin!, count: 33)),
                     try JSONSerialization.data(withJSONObject: ["target": "web", "predecessorOrigins": [oldOrigin!]])] {
            XCTAssertThrowsError(try migration.run(data))
            XCTAssertEqual(keys.deletions, 0)
        }
    }

    func testFreshInstallEmptyListAndEmptyStateDoNotNotify() throws {
        let keys = Keys()
        let migration = SecureStoreMigration(support: root, keys: keys)
        try migration.run(plan([])); XCTAssertFalse(try migration.takeNotice())
        try write(state(old), JSONEncoder().encode(SecureStoreState()))
        keys.entries[old] = [Data("unused-ungated".utf8)]
        try migration.run(plan()); XCTAssertFalse(try migration.takeNotice())
        XCTAssertFalse(fm.fileExists(atPath: state(old).path))
        try write(state(old), JSONEncoder().encode(SecureStoreState()))
        keys.entries[old] = [Data("unused-ungated-key".utf8)]
        try migration.run(plan()); XCTAssertFalse(try migration.takeNotice())
        XCTAssertTrue(keys.entries[old]?.isEmpty == true)
        try migration.run(plan()); XCTAssertFalse(try migration.takeNotice())
    }

    func testFailuresCannotPublishCompletionOrDeleteBeforeNoticeIsDurable() throws {
        let keys = try seed()
        let journal = root.appendingPathComponent("securestore-migration")
        try write(journal) // A file where the journal directory must be.
        XCTAssertThrowsError(try SecureStoreMigration(support: root, keys: keys).run(plan()))
        XCTAssertTrue(fm.fileExists(atPath: state(old).path)); XCTAssertEqual(keys.deletions, 0)
        try fm.removeItem(at: journal)
        keys.failEnumeration = true
        XCTAssertThrowsError(try SecureStoreMigration(support: root, keys: keys).run(plan()))
        XCTAssertTrue(fm.fileExists(atPath: state(old).path)); XCTAssertEqual(keys.deletions, 0)
        keys.failEnumeration = false; keys.ignoreDeletion = true
        XCTAssertThrowsError(try SecureStoreMigration(support: root, keys: keys).run(plan()))
        XCTAssertFalse(fm.fileExists(atPath: journal.appendingPathComponent("\(old!).bin").path))
    }

    func testNoticeCorruptionAndFailedConsumptionRemainFailClosed() throws {
        let migration = SecureStoreMigration(support: root, keys: try seed())
        try migration.run(plan())
        let notice = root.appendingPathComponent("securestore-migration/notice.bin")
        for bytes in [Data(), Data([2]), Data([1, 0])] {
            try write(notice, bytes)
            XCTAssertThrowsError(try migration.takeNotice())
            XCTAssertEqual(try Data(contentsOf: notice), bytes)
        }
        try fm.removeItem(at: notice)
        try fm.createDirectory(at: notice, withIntermediateDirectories: true)
        try write(notice.appendingPathComponent("child"))
        XCTAssertThrowsError(try migration.takeNotice())
        try fm.removeItem(at: notice)
        try write(notice, Data([1]))
        XCTAssertTrue(try migration.takeNotice())
        XCTAssertFalse(try migration.takeNotice())
    }

    func testCorruptStateStillNotifiesWithoutKeysOrDecryption() throws {
        for bytes in [Data([42]), Data("{\"epoch\":-1,\"versions\":{},\"records\":{}}".utf8)] {
            try? fm.removeItem(at: root)
            try write(state(old), bytes)
            let migration = SecureStoreMigration(support: root, keys: Keys())
            try migration.run(plan())
            XCTAssertFalse(fm.fileExists(atPath: state(old).path))
            XCTAssertTrue(try migration.takeNotice())
            XCTAssertFalse(try migration.takeNotice())
        }
    }

    func testRealKeychainScopeIncludesBothClassesAndKeepsNeighbours() throws {
        let oldService = SecureStoreKeychainWiper.prefix + old!
        let localService = SecureStoreKeychainWiper.prefix + local!
        // Use a unique neighbour to avoid modifying any other XCTest's real keys.
        let neighbour = oldService + "0"
        let services = [oldService, neighbour]
        let tags = services.map { Data(($0 + ".0123456789abcdef0123456789abcdef").utf8) }
        defer {
            for service in services { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary) }
            for tag in tags { SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag] as CFDictionary) }
        }
        for service in services {
            XCTAssertEqual(SecItemAdd([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                      kSecAttrAccount as String: "record", kSecValueData as String: Data([1]),
                                      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly] as CFDictionary, nil), errSecSuccess)
        }
        for tag in tags {
            var error: Unmanaged<CFError>?
            let key = SecKeyCreateRandomKey([kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                                            kSecAttrKeySizeInBits as String: 256,
                                            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true,
                                                                          kSecAttrApplicationTag as String: tag]] as CFDictionary, &error)
            XCTAssertNotNil(key)
            if let error { throw error.takeRetainedValue() as Error }
        }
        let adapter = SecureStoreMigrationKeychain()
        XCTAssertEqual(try adapter.artifacts(namespace: old).count, 2)
        XCTAssertFalse(SecureStoreMigrationKeychain.owns(localService, namespace: old, password: true))
        XCTAssertFalse(SecureStoreMigrationKeychain.owns(neighbour, namespace: old, password: true))
        XCTAssertFalse(SecureStoreMigrationKeychain.owns(neighbour + ".key", namespace: old, password: false))
        try SecureStoreMigration(support: root, keys: adapter).run(plan())
        XCTAssertTrue(try adapter.artifacts(namespace: old).isEmpty)
        XCTAssertEqual(SecItemCopyMatching([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: neighbour] as CFDictionary, nil), errSecSuccess)
        XCTAssertEqual(SecItemCopyMatching([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tags[1]] as CFDictionary, nil), errSecSuccess)
    }
    func testMultiplePredecessorsAndConsumptionFailureKeepUnlistedStateAndNotice() throws {
        let keys = try seed()
        let otherOrigin = "https://other.example:8443"
        let other = SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: URL(string: otherOrigin))))
        let unlisted = SecureStoreValidation.namespace(try XCTUnwrap(SuiteOrigin(url: URL(string: "https://unlisted.example"))))
        try write(state(other), Data([45])); try write(state(unlisted), Data([46]))
        keys.entries[other] = [Data("other-gated".utf8)]
        keys.entries[unlisted] = [Data("unlisted".utf8)]
        let migration = SecureStoreMigration(support: root, keys: keys)
        try migration.run(plan([oldOrigin!, otherOrigin]))
        removed(keys); try survivors(keys)
        XCTAssertFalse(fm.fileExists(atPath: state(other).path))
        XCTAssertTrue(keys.entries[other]?.isEmpty == true)
        XCTAssertEqual(try Data(contentsOf: state(unlisted)), Data([46]))
        XCTAssertEqual(keys.entries[unlisted], [Data("unlisted".utf8)])
        let failing = SecureStoreMigration(support: root, keys: keys, checkpoint: { throw SecureStoreFailure.failed })
        XCTAssertThrowsError(try failing.takeNotice())
        XCTAssertTrue(try migration.takeNotice()); XCTAssertFalse(try migration.takeNotice())
    }

}
