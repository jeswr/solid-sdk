// AUTHORED-BY Codex GPT-6.1-Sol
import CryptoKit
import Foundation
import Security

/// Only the RFC 8291 material is shared with the NSE. Signing keys stay in the app's own group.
struct PushKeys {
    struct Locked: Error {}
    let key: P256.KeyAgreement.PrivateKey
    let auth: Data
    private static let service = "org.jeswr.suite.push.decryption"
    private struct Material: Codable { let privateKey: Data; let auth: Data }
    private static func query() throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "SuitePushKeychainGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw PushCrypto.Failure.invalid }
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                kSecAttrAccount as String: "rfc8291", kSecAttrAccessGroup as String: group,
                kSecAttrSynchronizable as String: false]
    }
    static func installed() -> Bool {
        guard var query = try? query() else { return false }
        query[kSecReturnAttributes as String] = true
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }
    init(create: Bool = false) throws {
        var query = try Self.query(); query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let bytes = result as? Data {
            let material = try JSONDecoder().decode(Material.self, from: bytes)
            guard material.auth.count == 16 else { throw PushCrypto.Failure.invalid }
            key = try P256.KeyAgreement.PrivateKey(rawRepresentation: material.privateKey); auth = material.auth
        } else if status == errSecItemNotFound && create {
            key = P256.KeyAgreement.PrivateKey()
            var secret = Data(count: 16)
            let randomStatus = secret.withUnsafeMutableBytes { buffer in
                SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
            }
            guard randomStatus == errSecSuccess else { throw PushCrypto.Failure.invalid }; auth = secret
            query.removeValue(forKey: kSecReturnData as String)
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            query[kSecValueData as String] = try JSONEncoder().encode(Material(privateKey: key.rawRepresentation, auth: auth))
            guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw PushCrypto.Failure.invalid }
        } else {
            if status == errSecInteractionNotAllowed || status == errSecNotAvailable { throw Locked() }
            throw PushCrypto.Failure.invalid
        }
    }
    static func delete() throws {
        let status = SecItemDelete(try query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw PushCrypto.Failure.invalid }
    }
}
