// AUTHORED-BY Codex GPT-6.1-Sol
import CryptoKit
import Foundation
import Security
import XCTest
@testable import App

final class PushProofTests: XCTestCase {
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
