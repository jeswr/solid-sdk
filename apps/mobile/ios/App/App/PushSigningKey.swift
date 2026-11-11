// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import CryptoKit
import Foundation
import Security

/// Injectable Security operations; tests can exercise real Keychain creation without app-group entitlements.
protocol PushSigningKeyProvider {
    func find(_ query: [String: Any]) throws -> SecKey?
    func create(_ attributes: [String: Any]) throws -> SecKey
    func attributes(_ key: SecKey) -> [String: Any]?
    func delete(_ query: [String: Any]) throws
}
struct SecurityPushSigningKeyProvider: PushSigningKeyProvider {
    func find(_ query: [String: Any]) throws -> SecKey? {
        var lookup = query; lookup[kSecReturnRef as String] = true
        var found: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &found)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let found = found else { throw PushCrypto.Failure.invalid }
        return (found as! SecKey)
    }
    func create(_ attributes: [String: Any]) throws -> SecKey {
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else { throw PushCrypto.Failure.invalid }
        return key
    }
    func attributes(_ key: SecKey) -> [String: Any]? { SecKeyCopyAttributes(key) as? [String: Any] }
    func delete(_ query: [String: Any]) throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw PushCrypto.Failure.invalid }
    }
}

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
    convenience init(create: Bool) throws {
        try self.init(create: create, query: Self.query(), provider: SecurityPushSigningKeyProvider())
    }
    init(create: Bool, query: [String: Any], provider: PushSigningKeyProvider) throws {
        if let stored = try provider.find(query) {
            guard let attributes = provider.attributes(stored), Self.acceptsAttributes(attributes) else { throw PushCrypto.Failure.invalid }
            key = stored; return
        }
        guard create else { throw PushCrypto.Failure.invalid }
        func attributes(enclave: Bool) throws -> [String: Any] {
            var error: Unmanaged<CFError>?
            // privateKeyUsage is valid only inside the Secure Enclave. Build a fresh fallback ACL.
            let flags: SecAccessControlCreateFlags = enclave ? .privateKeyUsage : []
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly, flags, &error),
                  let tag = query[kSecAttrApplicationTag as String] else { throw PushCrypto.Failure.invalid }
            var privateAttrs: [String: Any] = [
                kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag,
                kSecAttrAccessControl as String: access, kSecAttrSynchronizable as String: false,
                kSecAttrIsExtractable as String: false
            ]
            if let group = query[kSecAttrAccessGroup as String] { privateAttrs[kSecAttrAccessGroup as String] = group }
            var result: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeySizeInBits as String: 256, kSecPrivateKeyAttrs as String: privateAttrs]
            if enclave { result[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave }
            return result
        }
        let generated: SecKey
        if let enclave = try? provider.create(attributes(enclave: true)) { generated = enclave }
        else { generated = try provider.create(attributes(enclave: false)) }
        guard let reported = provider.attributes(generated), Self.acceptsAttributes(reported) else {
            try? provider.delete(query); throw PushCrypto.Failure.invalid
        }
        key = generated
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
        try SecurityPushSigningKeyProvider().delete(query())
    }
}

/// installation-proof+jwt: the exact header and sorted claims the relay verifier admits, byte-identical
/// to Android. htu is the request URL with no query; jti is fresh per proof so the relay rejects replays.
/// Hash the exact UTF-8 request body; iat is native Unix seconds.
enum PushProof {
    static let header = "{\"alg\":\"ES256\",\"typ\":\"installation-proof+jwt\"}"
    static func sign(method: String, url: String, body: String, timestamp: Int, signer: (Data) throws -> Data) throws -> String {
        var nonce = Data(count: 16)
        let status = nonce.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        guard status == errSecSuccess else { throw PushCrypto.Failure.invalid }
        return try sign(method: method, url: url, body: body, timestamp: timestamp, jti: PushCrypto.b64(nonce), signer: signer)
    }
    static func sign(method: String, url: String, body: String, timestamp: Int, jti: String, signer: (Data) throws -> Data) throws -> String {
        guard method.range(of: "\\A[A-Z]{1,16}\\z", options: .regularExpression) != nil,
              url.utf8.count <= 2048, let parsed = URLComponents(string: url), parsed.scheme == "https", parsed.host != nil,
              parsed.user == nil, parsed.password == nil, parsed.percentEncodedQuery == nil, parsed.fragment == nil,
              body.utf8.count <= 65536, timestamp >= 0,
              jti.range(of: "\\A[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil else { throw PushCrypto.Failure.invalid }
        let claims: [String: Any] = ["body_sha256": PushCrypto.b64(Data(SHA256.hash(data: Data(body.utf8)))),
                                     "htm": method, "htu": url, "iat": timestamp, "jti": jti]
        let input = PushCrypto.b64(Data(header.utf8)) + "." +
            PushCrypto.b64(try JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys, .withoutEscapingSlashes]))
        let signature = try signer(Data(input.utf8))
        guard signature.count == 64 else { throw PushCrypto.Failure.invalid }
        return input + "." + PushCrypto.b64(signature)
    }
}
