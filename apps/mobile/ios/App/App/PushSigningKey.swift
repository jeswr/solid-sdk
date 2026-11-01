// AUTHORED-BY Codex GPT-6.1-Sol
import CryptoKit
import Foundation
import Security

/// App-only signing operations. No private key representation crosses this API or the JS bridge.
final class PushSigningKey {
    private let key: SecKey
    private static func query() throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "SuitePushSigningGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { throw PushCrypto.Failure.invalid }
        return [kSecClass as String: kSecClassKey, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
                kSecAttrApplicationTag as String: Data("org.jeswr.suite.push.sign".utf8),
                kSecAttrAccessGroup as String: group, kSecAttrSynchronizable as String: false]
    }
    init(create: Bool) throws {
        var query = try Self.query(); query[kSecReturnRef as String] = true
        var found: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &found)
        if status == errSecSuccess, let found = found {
            let stored = found as! SecKey
            guard let attributes = SecKeyCopyAttributes(stored) as? [String: Any], Self.acceptsAttributes(attributes) else { throw PushCrypto.Failure.invalid }
            key = stored; return
        }
        guard status == errSecItemNotFound && create else { throw PushCrypto.Failure.invalid }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, .privateKeyUsage, &error) else { throw PushCrypto.Failure.invalid }
        let privateAttrs: [String: Any] = [
            kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: query[kSecAttrApplicationTag as String]!,
            kSecAttrAccessGroup as String: query[kSecAttrAccessGroup as String]!, kSecAttrAccessControl as String: access,
            kSecAttrSynchronizable as String: false
        ]
        var attributes: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256, kSecPrivateKeyAttrs as String: privateAttrs,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave]
        if let enclave = SecKeyCreateRandomKey(attributes as CFDictionary, &error) { key = enclave; return }
        // Simulator/provider fallback: a permanent Keychain SecKey. Only signing is exposed by this class.
        // Require the provider to report non-extractability; unsupported/exportable fallbacks fail closed.
        attributes.removeValue(forKey: kSecAttrTokenID as String)
        var fallbackPrivate = privateAttrs; fallbackPrivate[kSecAttrIsExtractable as String] = false
        attributes[kSecPrivateKeyAttrs as String] = fallbackPrivate
        guard let fallback = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else { throw PushCrypto.Failure.invalid }
        guard let provider = SecKeyCopyAttributes(fallback) as? [String: Any], Self.acceptsAttributes(provider) else {
            try? Self.delete(); throw PushCrypto.Failure.invalid
        }
        key = fallback
    }
    static func acceptsAttributes(_ attributes: [String: Any]) -> Bool {
        if attributes[kSecAttrTokenID as String] as? String == kSecAttrTokenIDSecureEnclave as String { return true }
        return attributes[kSecAttrIsExtractable as String] as? Bool == false
    }
    func publicJWK() throws -> [String: String] {
        guard let publicKey = SecKeyCopyPublicKey(key),
              let raw = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?, raw.count == 65, raw.first == 4 else { throw PushCrypto.Failure.invalid }
        return ["kty": "EC", "crv": "P-256", "x": PushCrypto.b64(Data(raw[1..<33])), "y": PushCrypto.b64(Data(raw[33..<65]))]
    }
    func sign(_ bytes: Data) throws -> Data {
        guard let der = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, bytes as CFData, nil) as Data? else { throw PushCrypto.Failure.invalid }
        return try P256.Signing.ECDSASignature(derRepresentation: der).rawRepresentation
    }
    static func delete() throws {
        let status = SecItemDelete(try query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw PushCrypto.Failure.invalid }
    }
}

/// JWS payload bytes match Android. Hash the exact UTF-8 request body; timestamp is native Unix seconds.
enum PushProof {
    static func sign(method: String, url: String, body: String, timestamp: Int, signer: (Data) throws -> Data) throws -> String {
        guard method.range(of: "\\A[A-Z]{1,16}\\z", options: .regularExpression) != nil,
              url.utf8.count <= 2048, let parsed = URLComponents(string: url), parsed.scheme == "https", parsed.host != nil,
              parsed.user == nil, parsed.password == nil, parsed.fragment == nil, body.utf8.count <= 65536, timestamp >= 0 else { throw PushCrypto.Failure.invalid }
        let claims: [String: Any] = ["bodyHash": PushCrypto.b64(Data(SHA256.hash(data: Data(body.utf8)))),
                                   "method": method, "timestamp": timestamp, "url": url]
        let input = PushCrypto.b64(Data("{\"alg\":\"ES256\"}".utf8)) + "." +
            PushCrypto.b64(try JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys, .withoutEscapingSlashes]))
        let signature = try signer(Data(input.utf8))
        guard signature.count == 64 else { throw PushCrypto.Failure.invalid }
        return input + "." + PushCrypto.b64(signature)
    }
}
