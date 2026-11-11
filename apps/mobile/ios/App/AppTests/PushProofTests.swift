// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
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
        // Force the Enclave attempt to fail: current simulators can emulate the Secure Enclave, so the
        // real provider may succeed there. The fallback below is still created by the real provider.
        let query = isolatedQuery(), provider = RecordingProvider()
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
    func testES256SignsReplayProtectedInstallationProof() throws {
        let key = P256.Signing.PrivateKey(), body = "{ \"x\": 1 }\n"
        let sign = { try PushProof.sign(method: "POST", url: "https://relay.example/push/installations", body: body, timestamp: 42,
            signer: { try key.signature(for: $0).rawRepresentation }) }
        let proof = try sign()
        let parts = proof.components(separatedBy: "."); XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(try PushCrypto.unb64(parts[0]), Data("{\"alg\":\"ES256\",\"typ\":\"installation-proof+jwt\"}".utf8))
        let claims = try XCTUnwrap(JSONSerialization.jsonObject(with: PushCrypto.unb64(parts[1])) as? [String: Any])
        XCTAssertEqual(claims.count, 5); XCTAssertEqual(claims["htm"] as? String, "POST"); XCTAssertEqual(claims["iat"] as? Int, 42)
        XCTAssertEqual(claims["htu"] as? String, "https://relay.example/push/installations")
        XCTAssertEqual(claims["body_sha256"] as? String, PushCrypto.b64(Data(SHA256.hash(data: Data(body.utf8)))))
        let jti = try XCTUnwrap(claims["jti"] as? String)
        XCTAssertNotNil(jti.range(of: "\\A[A-Za-z0-9_-]{22}\\z", options: .regularExpression))
        let other = try XCTUnwrap(JSONSerialization.jsonObject(with: PushCrypto.unb64(try sign().components(separatedBy: ".")[1])) as? [String: Any])
        XCTAssertNotEqual(other["jti"] as? String, jti)
        let signature = try P256.Signing.ECDSASignature(rawRepresentation: PushCrypto.unb64(parts[2]))
        XCTAssertTrue(key.publicKey.isValidSignature(signature, for: Data("\(parts[0]).\(parts[1])".utf8)))
        XCTAssertFalse(key.publicKey.isValidSignature(signature, for: Data("\(parts[0]).\(parts[1])x".utf8)))
    }
    func testCanonicalClaimsMatchAndroidAndInvalidInputsNeverReachSigner() throws {
        // Interop fixture: byte-identical to PushProofTest.java and accepted by the relay's
        // apps/notification-relay/src/device-proof-interop.test.ts.
        let expected = "eyJhbGciOiJFUzI1NiIsInR5cCI6Imluc3RhbGxhdGlvbi1wcm9vZitqd3QifQ.eyJib2R5X3NoYTI1NiI6InZha1VuRGhQTVpzLXJMcHZLMml0Zk95OGxFWU12UG13STJvQlNNWWtUeG8iLCJodG0iOiJQT1NUIiwiaHR1IjoiaHR0cHM6Ly9yZWxheS5leGFtcGxlL3B1c2gvaW5zdGFsbGF0aW9ucy9hYmMvYWN0aXZhdGUiLCJpYXQiOjE3MDAwMDAwMDAsImp0aSI6ImludGVyb3AtZml4dHVyZS1qdGkifQ"
        _ = try PushProof.sign(method: "POST", url: "https://relay.example/push/installations/abc/activate", body: "{\"nonce\":\"n\"}",
                               timestamp: 1700000000, jti: "interop-fixture-jti") { bytes in
            XCTAssertEqual(String(decoding: bytes, as: UTF8.self), expected); return Data(repeating: 0, count: 64)
        }
        let forbidden: (Data) throws -> Data = { _ in XCTFail("Invalid request reached key"); throw PushCrypto.Failure.invalid }
        for jti in ["", "a b", "a.b", String(repeating: "a", count: 129)] {
            XCTAssertThrowsError(try PushProof.sign(method: "DELETE", url: "https://relay.example/", body: "", timestamp: 1, jti: jti, signer: forbidden))
        }
        for url in ["http://relay.example/", "https://user@relay.example/", "https://relay.example/#f", "https://relay.example/?x=1", "https://relay.example/?",
                    "//relay.example/", "relative", "https:/path"] {
            XCTAssertThrowsError(try PushProof.sign(method: "DELETE", url: url, body: "", timestamp: 1, jti: "j", signer: forbidden))
        }
        for method in ["post", "POST\n", "", "POST DELETE"] {
            XCTAssertThrowsError(try PushProof.sign(method: method, url: "https://relay.example/", body: "", timestamp: 1, jti: "j", signer: forbidden))
        }
        XCTAssertThrowsError(try PushProof.sign(method: "POST", url: "https://relay.example/", body: String(repeating: "a", count: 65537), timestamp: 1,
                                                jti: "j", signer: forbidden))
    }
}
