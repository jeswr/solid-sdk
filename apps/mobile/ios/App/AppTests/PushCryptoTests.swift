// AUTHORED-BY Codex GPT-6.1-Sol
import CryptoKit
import Foundation
import XCTest
@testable import App

final class PushCryptoTests: XCTestCase {
    static let rfc = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
        "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
        "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    static func receiver() throws -> P256.KeyAgreement.PrivateKey {
        try P256.KeyAgreement.PrivateKey(rawRepresentation: PushCrypto.unb64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"))
    }
    /// Independent sender uses CryptoKit's HKDF API, while the receiver expands the RFC's HMAC sequence.
    static func encrypt(_ plain: Data, receiver: P256.KeyAgreement.PrivateKey, auth: Data, delimiter: UInt8 = 2) throws -> String {
        let sender = P256.KeyAgreement.PrivateKey()
        let salt = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
        let shared = try sender.sharedSecretFromKeyAgreement(with: receiver.publicKey)
        let ikm = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: auth,
            sharedInfo: Data("WebPush: info\0".utf8) + receiver.publicKey.x963Representation + sender.publicKey.x963Representation,
            outputByteCount: 32)
        let cek = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: salt, info: Data("Content-Encoding: aes128gcm\0".utf8), outputByteCount: 16)
        let nonceKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: salt, info: Data("Content-Encoding: nonce\0".utf8), outputByteCount: 12)
        let nonce = nonceKey.withUnsafeBytes { Data($0) }
        let sealed = try AES.GCM.seal(plain + Data([delimiter, 0, 0]), using: cek, nonce: AES.GCM.Nonce(data: nonce))
        return PushCrypto.b64(salt + Data([0, 0, 16, 0, 65]) + sender.publicKey.x963Representation + sealed.ciphertext + sealed.tag)
    }
    func testRFC8291Section5() throws {
        let plain = try PushCrypto.decrypt(Self.rfc, key: Self.receiver(), auth: PushCrypto.unb64("BTBZMqHH6r4Tts7J_aSIgg"))
        XCTAssertEqual(String(data: plain, encoding: .utf8), "When I grow up, I want to be a watermelon")
        // The RFC example is deliberately not a Suite payload (it is not 512-byte JSON).
        XCTAssertThrowsError(try PushPayload(plain))
    }
    func testRoundTripsAndTampering() throws {
        for index in 0..<8 {
            let key = P256.KeyAgreement.PrivateKey(), auth = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
            let plain = PushStateTests.padded(PushStateTests.json(id: "id\(index)"))
            let wire = try Self.encrypt(plain, receiver: key, auth: auth)
            XCTAssertEqual(try PushCrypto.decrypt(wire, key: key, auth: auth), plain)
            var tampered = try PushCrypto.unb64(wire); tampered[tampered.count - 1] ^= 1
            XCTAssertThrowsError(try PushCrypto.decrypt(PushCrypto.b64(tampered), key: key, auth: auth))
            var wrongAuth = auth; wrongAuth[0] ^= 1
            XCTAssertThrowsError(try PushCrypto.decrypt(wire, key: key, auth: wrongAuth))
            let wrongDelimiter = try Self.encrypt(plain, receiver: key, auth: auth, delimiter: 1)
            XCTAssertThrowsError(try PushCrypto.decrypt(wrongDelimiter, key: key, auth: auth))
            let wrongLength = try Self.encrypt(Data(repeating: 32, count: 511), receiver: key, auth: auth)
            XCTAssertThrowsError(try PushPayload(PushCrypto.decrypt(wrongLength, key: key, auth: auth)))
        }
    }
    func testHeaderSizeAndPointValidation() throws {
        let key = try Self.receiver(), auth = try PushCrypto.unb64("BTBZMqHH6r4Tts7J_aSIgg")
        for invalid in ["", "a", Self.rfc + "=", Self.rfc + "\n", PushCrypto.b64(Data(repeating: 0, count: 4097))] {
            XCTAssertThrowsError(try PushCrypto.decrypt(invalid, key: key, auth: auth))
        }
        for offset in [16, 18, 20, 21, 22] {
            var wire = try PushCrypto.unb64(Self.rfc); wire[offset] ^= 1
            XCTAssertThrowsError(try PushCrypto.decrypt(PushCrypto.b64(wire), key: key, auth: auth))
        }
        var offCurve = try PushCrypto.unb64(Self.rfc)
        offCurve.replaceSubrange(22..<86, with: Data(repeating: 0, count: 64))
        XCTAssertThrowsError(try PushCrypto.decrypt(PushCrypto.b64(offCurve), key: key, auth: auth))
        XCTAssertThrowsError(try PushCrypto.unb64("AB"))
    }
}
