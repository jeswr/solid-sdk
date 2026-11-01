// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import CryptoKit
import Foundation
import Security
import XCTest
@testable import App

final class PushProofTests: XCTestCase {
    private final class RecordingProvider: PushSigningKeyProvider {
        let real = SecurityPushSigningKeyProvider()
        var enclaveAttempts = [Bool]()
        var rejectEnclave = true
        var reportExtractable = false
        var generatedFallback: SecKey?
        var persistedFallback: [String: Any]?
        func find(_ query: [String: Any]) throws -> SecKey? { try real.find(query) }
        func create(_ attributes: [String: Any]) throws -> SecKey {
            let enclave = attributes[kSecAttrTokenID as String] != nil
            enclaveAttempts.append(enclave)
            if enclave && rejectEnclave { throw PushCrypto.Failure.invalid }
            let key = try real.create(attributes)
            if !enclave {
                generatedFallback = key
                let privateAttrs = attributes[kSecPrivateKeyAttrs as String] as? [String: Any] ?? [:]
                var query: [String: Any] = [kSecClass as String: kSecClassKey,
                    kSecAttrKeyClass as String: kSecAttrKeyClassPrivate, kSecReturnAttributes as String: true]
                query[kSecAttrApplicationTag as String] = privateAttrs[kSecAttrApplicationTag as String]
                query[kSecAttrAccessGroup as String] = privateAttrs[kSecAttrAccessGroup as String]
                var item: CFTypeRef?
                if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess {
                    persistedFallback = item as? [String: Any]
                }
            }
            return key
        }
        func attributes(_ key: SecKey) -> [String: Any]? {
            guard var attributes = real.attributes(key) else { return nil }
            if reportExtractable { attributes[kSecAttrIsExtractable as String] = true }
            return attributes
        }
        func delete(_ query: [String: Any]) throws { try real.delete(query) }
    }
    private func isolatedQuery() -> [String: Any] {
        // No access group override: unsigned simulator tests use their default Keychain group.
        [kSecClass as String: kSecClassKey, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
         kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
         kSecAttrApplicationTag as String: Data("org.jeswr.suite.push.test.\(UUID().uuidString)".utf8),
         kSecAttrSynchronizable as String: false]
    }
    func testFallbackReallyCreatesProtectedKeyAndEnforcesActualProviderPolicy() throws {
        let query = isolatedQuery(), provider = RecordingProvider()
        #if targetEnvironment(simulator)
        provider.rejectEnclave = false // The real simulator provider must reject Enclave and create the fallback.
        #endif
        defer { try? provider.delete(query) }
        let outcome = Result { try PushSigningKey(create: true, query: query, provider: provider) }
        XCTAssertEqual(provider.enclaveAttempts, [true, false])
        // Generation must actually succeed; failing before this point (including a bad ACL) fails the test.
        let generated = try XCTUnwrap(provider.generatedFallback)
        let attributes = try XCTUnwrap(provider.real.attributes(generated))
        let persisted = try XCTUnwrap(provider.persistedFallback)
        XCTAssertEqual(persisted[kSecAttrAccessible as String] as? String, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        XCTAssertFalse(persisted[kSecAttrSynchronizable as String] as? Bool ?? false)
        let publicRef = try XCTUnwrap(SecKeyCopyPublicKey(generated))
        let raw = try XCTUnwrap(SecKeyCopyExternalRepresentation(publicRef, nil) as Data?)
        let publicKey = try P256.Signing.PublicKey(x963Representation: raw)
        let message = Data("real provider fallback".utf8)
        let der = try XCTUnwrap(SecKeyCreateSignature(generated, .ecdsaSignatureMessageX962SHA256, message as CFData, nil) as Data?)
        XCTAssertTrue(publicKey.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: der), for: message))
        if PushSigningKey.acceptsAttributes(attributes) {
            let key = try outcome.get(), reloaded = try PushSigningKey(create: false, query: query, provider: provider)
            XCTAssertEqual(try key.publicJWK(), try reloaded.publicJWK())
            XCTAssertTrue(publicKey.isValidSignature(try P256.Signing.ECDSASignature(rawRepresentation: reloaded.sign(message)), for: message))
            XCTAssertEqual(provider.enclaveAttempts.count, 2)
        } else {
            // Real software providers may report extractability. Never turn that into a mock success.
            XCTAssertThrowsError(try outcome.get()); XCTAssertNil(try provider.real.find(query))
        }
    }
    func testActualProviderKeyIsDeletedIfNonExtractabilityIsNotReported() throws {
        let query = isolatedQuery(), provider = RecordingProvider(); provider.reportExtractable = true
        defer { try? provider.delete(query) }
        XCTAssertThrowsError(try PushSigningKey(create: true, query: query, provider: provider))
        XCTAssertEqual(provider.enclaveAttempts, [true, false])
        XCTAssertNil(try provider.real.find(query))
    }
    func testSigningKeyProviderMustGuaranteeNonExportability() {
        XCTAssertTrue(PushSigningKey.acceptsAttributes([kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave]))
        XCTAssertTrue(PushSigningKey.acceptsAttributes([kSecAttrIsExtractable as String: false]))
        XCTAssertFalse(PushSigningKey.acceptsAttributes([kSecAttrIsExtractable as String: true]))
        XCTAssertFalse(PushSigningKey.acceptsAttributes([:]))
    }
    func testES256SignsExactRequestBytes() throws {
        let key = P256.Signing.PrivateKey(), body = "{ \"x\": 1 }\n"
        let proof = try PushProof.sign(method: "POST", url: "https://relay.example/push/installations?x=1", body: body, timestamp: 42,
            signer: { try key.signature(for: $0).rawRepresentation })
        let parts = proof.components(separatedBy: "."); XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(try PushCrypto.unb64(parts[0]), Data("{\"alg\":\"ES256\"}".utf8))
        let claims = try XCTUnwrap(JSONSerialization.jsonObject(with: PushCrypto.unb64(parts[1])) as? [String: Any])
        XCTAssertEqual(claims.count, 4); XCTAssertEqual(claims["method"] as? String, "POST"); XCTAssertEqual(claims["timestamp"] as? Int, 42)
        XCTAssertEqual(claims["url"] as? String, "https://relay.example/push/installations?x=1")
        XCTAssertEqual(claims["bodyHash"] as? String, PushCrypto.b64(Data(SHA256.hash(data: Data(body.utf8)))))
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: PushCrypto.unb64(parts[2]))
        XCTAssertTrue(key.publicKey.isValidSignature(signature, for: Data("\(parts[0]).\(parts[1])".utf8)))
        XCTAssertFalse(key.publicKey.isValidSignature(signature, for: Data("\(parts[0]).\(parts[1])x".utf8)))
    }
    func testCanonicalClaimsMatchAndroidAndInvalidInputsNeverReachSigner() throws {
        let expected = "{\"bodyHash\":\"47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU\",\"method\":\"DELETE\",\"timestamp\":1,\"url\":\"https://relay.example/push/installations/id\"}"
        _ = try PushProof.sign(method: "DELETE", url: "https://relay.example/push/installations/id", body: "", timestamp: 1) { bytes in
            let parts = String(decoding: bytes, as: UTF8.self).components(separatedBy: ".")
            XCTAssertEqual(try PushCrypto.unb64(parts[1]), Data(expected.utf8)); return Data(repeating: 0, count: 64)
        }
        let forbidden: (Data) throws -> Data = { _ in XCTFail("Invalid request reached key"); throw PushCrypto.Failure.invalid }
        for url in ["http://relay.example/", "https://user@relay.example/", "https://relay.example/#f", "//relay.example/", "relative", "https:/path"] {
            XCTAssertThrowsError(try PushProof.sign(method: "DELETE", url: url, body: "", timestamp: 1, signer: forbidden))
        }
        for method in ["post", "POST\n", "", "POST DELETE"] {
            XCTAssertThrowsError(try PushProof.sign(method: method, url: "https://relay.example/", body: "", timestamp: 1, signer: forbidden))
        }
        XCTAssertThrowsError(try PushProof.sign(method: "POST", url: "https://relay.example/", body: String(repeating: "a", count: 65537), timestamp: 1, signer: forbidden))
    }
}
