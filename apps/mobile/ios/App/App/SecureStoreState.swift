// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Claude Opus 5.5
import Foundation
import CoreFoundation
import CryptoKit

enum SecureStoreFailure: String, Error {
    case cancelled, background, lockout, unavailable, stale, full, invalid, failed

    static func code(_ error: Error) -> SecureStoreFailure {
        return error as? SecureStoreFailure ?? .failed
    }
}

enum SecureStoreValidation {
    static let maxVersion: Int64 = 9_007_199_254_740_991
    static let maxValueBytes = 16 * 1024
    static let maxKeys = 32

    static func key(_ raw: Any?) throws -> String {
        guard let key = raw as? String, key.utf8.count <= 128,
              key.range(of: "^[a-z0-9][a-z0-9:._-]{0,127}\\z", options: .regularExpression) != nil else {
            throw SecureStoreFailure.invalid
        }
        return key
    }

    static func value(_ raw: Any?) throws -> String {
        guard let value = raw as? String, value.utf8.count <= maxValueBytes else { throw SecureStoreFailure.invalid }
        return value
    }

    static func version(_ raw: Any?) throws -> Int64 {
        guard let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            throw SecureStoreFailure.invalid
        }
        let value = number.doubleValue
        guard value.isFinite, value >= 0, value <= Double(maxVersion), value.rounded() == value else {
            throw SecureStoreFailure.invalid
        }
        return Int64(value)
    }

    static func boolean(_ raw: Any?) throws -> Bool {
        guard let number = raw as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
            throw SecureStoreFailure.invalid
        }
        return number.boolValue
    }

    static func next(_ version: Int64) throws -> Int64 {
        guard version >= 0, version < maxVersion else { throw SecureStoreFailure.failed }
        return version + 1
    }

    static func isKeyId(_ id: String) -> Bool {
        return id.utf8.count == 32 && id.allSatisfy { "0123456789abcdef".contains($0) }
    }

    static func namespace(_ origin: SuiteOrigin) -> String {
        let host = origin.host.contains(":") && !origin.host.hasPrefix("[") ? "[\(origin.host)]" : origin.host
        let defaultPort = origin.scheme == "https" ? 443 : 80
        // The bundled capacitor://localhost origin has no port (0).
        let port = origin.port == defaultPort || origin.port == 0 ? "" : ":\(origin.port)"
        return SHA256.hash(data: Data("\(origin.scheme)://\(host)\(port)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Records are individually encoded, so a malformed record cannot make its neighbours unreadable.
struct SecureStoreState: Codable {
    var epoch: Int64 = 0
    var versions = [String: Int64]()
    var records = [String: Data]()
    var wrappingKeyId: String?

    private enum CodingKeys: String, CodingKey { case epoch, versions, records, wrappingKeyId }
    private struct RecordKey: CodingKey {
        let stringValue: String
        var intValue: Int? { return nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        epoch = try container.decode(Int64.self, forKey: .epoch)
        versions = try container.decode([String: Int64].self, forKey: .versions)
        wrappingKeyId = try container.decodeIfPresent(String.self, forKey: .wrappingKeyId)
        let encoded = try container.nestedContainer(keyedBy: RecordKey.self, forKey: .records)
        for key in encoded.allKeys {
            // Bad base64 or the wrong JSON type is still corruption of this record alone.
            records[key.stringValue] = (try? encoded.decode(Data.self, forKey: key)) ?? Data()
        }
    }

    func version(_ key: String) -> Int64 { return versions[key] ?? epoch }

    func validate() throws {
        guard epoch >= 0, epoch <= SecureStoreValidation.maxVersion,
              records.count <= SecureStoreValidation.maxKeys,
              wrappingKeyId == nil || SecureStoreValidation.isKeyId(wrappingKeyId!) else { throw SecureStoreFailure.failed }
        for (key, version) in versions {
            _ = try SecureStoreValidation.key(key)
            guard version >= epoch, version <= SecureStoreValidation.maxVersion else { throw SecureStoreFailure.failed }
        }
        for key in records.keys {
            guard versions[key] != nil else { throw SecureStoreFailure.failed }
        }
    }

    func checkSet(key: String, version: Int64) throws {
        guard version == self.version(key) else { throw SecureStoreFailure.stale }
        guard records[key] != nil || records.count < SecureStoreValidation.maxKeys else { throw SecureStoreFailure.full }
        _ = try SecureStoreValidation.next(version)
    }

    mutating func set(key: String, record: Data) throws -> Int64 {
        let next = try SecureStoreValidation.next(version(key))
        versions[key] = next
        records[key] = record
        return next
    }

    mutating func remove(_ key: String) throws {
        versions[key] = try SecureStoreValidation.next(version(key))
        records.removeValue(forKey: key)
    }

    mutating func clear() throws {
        // Moving above the largest counter also raises versions of keys that have never existed.
        epoch = try SecureStoreValidation.next(versions.values.max() ?? epoch)
        versions.removeAll()
        records.removeAll()
    }
}

enum SecureStoreRecordFailure: Error { case corrupt, missingKey }

struct SecureStoreRecord: Codable {
    let namespace: String
    let key: String
    let mode: UInt8
    let keyId: String
    let wrappedKey: Data?
    let nonce: Data
    let ciphertext: Data
    let tag: Data
}

protocol SecureStoreRecordCoding {
    func encode(_ record: SecureStoreRecord) throws -> Data
    func decode(_ data: Data, namespace: String, key: String) throws -> SecureStoreRecord
    func seal(_ value: String, namespace: String, key: String, mode: UInt8, keyId: String,
              dataKey: Data, wrappedKey: Data?) throws -> SecureStoreRecord
    func open(_ record: SecureStoreRecord, dataKey: Data) throws -> String
}

struct SecureStoreRecordCodec: SecureStoreRecordCoding {
    static func associatedData(namespace: String, key: String, mode: UInt8, keyId: String) -> Data {
        var data = Data("SSS1".utf8)
        func append(_ value: String) {
            let bytes = Data(value.utf8)
            data.append(UInt8((bytes.count >> 8) & 255))
            data.append(UInt8(bytes.count & 255))
            data.append(bytes)
        }
        append(namespace)
        append(key)
        data.append(mode)
        append(keyId)
        return data
    }

    func encode(_ record: SecureStoreRecord) throws -> Data { return try JSONEncoder().encode(record) }

    func decode(_ data: Data, namespace: String, key: String) throws -> SecureStoreRecord {
        guard let record = try? JSONDecoder().decode(SecureStoreRecord.self, from: data),
              record.namespace == namespace, record.key == key,
              record.mode == 0 || record.mode == 1,
              (record.mode == 0 ? (record.keyId == "ungated" && record.wrappedKey == nil) :
                (SecureStoreValidation.isKeyId(record.keyId) && record.wrappedKey?.isEmpty == false)),
              record.nonce.count == 12, record.tag.count == 16,
              record.ciphertext.count <= SecureStoreValidation.maxValueBytes else { throw SecureStoreRecordFailure.corrupt }
        return record
    }

    func seal(_ value: String, namespace: String, key: String, mode: UInt8, keyId: String,
              dataKey: Data, wrappedKey: Data?) throws -> SecureStoreRecord {
        let nonce = AES.GCM.Nonce()
        let aad = Self.associatedData(namespace: namespace, key: key, mode: mode, keyId: keyId)
        let box = try AES.GCM.seal(Data(value.utf8), using: SymmetricKey(data: dataKey), nonce: nonce, authenticating: aad)
        return SecureStoreRecord(namespace: namespace, key: key, mode: mode, keyId: keyId, wrappedKey: wrappedKey,
                                 nonce: Data(nonce), ciphertext: box.ciphertext, tag: box.tag)
    }

    func open(_ record: SecureStoreRecord, dataKey: Data) throws -> String {
        guard dataKey.count == 32 else { throw SecureStoreRecordFailure.corrupt }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: record.nonce), ciphertext: record.ciphertext, tag: record.tag)
            let aad = Self.associatedData(namespace: record.namespace, key: record.key, mode: record.mode, keyId: record.keyId)
            let bytes = try AES.GCM.open(box, using: SymmetricKey(data: dataKey), authenticating: aad)
            guard let value = String(data: bytes, encoding: .utf8) else { throw SecureStoreRecordFailure.corrupt }
            return value
        } catch let error as CryptoKitError {
            if case .authenticationFailure = error { throw SecureStoreRecordFailure.corrupt }
            throw SecureStoreFailure.failed
        }
    }
}
