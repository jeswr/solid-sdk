// AUTHORED-BY Codex GPT-6.1-Sol
import CryptoKit
import Foundation

/// RFC 8291 + RFC 8188 single-record aes128gcm, shared by the app and NSE.
enum PushCrypto {
    enum Failure: Error { case invalid }
    static func b64(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func unb64(_ string: String) throws -> Data {
        guard string.utf8.count <= 8192, string.range(of: "\\A[A-Za-z0-9_-]*\\z", options: .regularExpression) != nil,
              let data = Data(base64Encoded: string.replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - string.utf8.count % 4) % 4)),
              b64(data) == string else { throw Failure.invalid }
        return data
    }
    static func hmac(_ key: Data, _ input: Data) -> Data {
        Data(HMAC<SHA256>.authenticationCode(for: input, using: SymmetricKey(data: key)))
    }
    static func derive(key: P256.KeyAgreement.PrivateKey, auth: Data, salt: Data, sender: Data) throws -> (Data, Data) {
        guard auth.count == 16, salt.count == 16, sender.count == 65, sender.first == 4 else { throw Failure.invalid }
        // CryptoKit validates that the decoded point lies on P-256.
        let shared = try key.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PublicKey(x963Representation: sender))
        let secret = shared.withUnsafeBytes { Data($0) }
        let info = Data("WebPush: info\0".utf8) + key.publicKey.x963Representation + sender + Data([1])
        let ikm = hmac(hmac(auth, secret), info)
        let prk = hmac(salt, ikm)
        return (Data(hmac(prk, Data("Content-Encoding: aes128gcm\0\u{1}".utf8)).prefix(16)),
                Data(hmac(prk, Data("Content-Encoding: nonce\0\u{1}".utf8)).prefix(12)))
    }
    static func decrypt(_ encoded: String, key: P256.KeyAgreement.PrivateKey, auth: Data) throws -> Data {
        guard encoded.utf8.count <= 5462 else { throw Failure.invalid }
        let body = try unb64(encoded)
        guard body.count >= 103, body.count <= 4096,
              Array(body[16..<20]) == [0, 0, 16, 0], body[20] == 65 else { throw Failure.invalid }
        let (cek, nonce) = try derive(key: key, auth: auth, salt: Data(body.prefix(16)), sender: Data(body[21..<86]))
        let record = body.dropFirst(86)
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: record.dropLast(16), tag: record.suffix(16))
        var plaintext = try AES.GCM.open(box, using: SymmetricKey(data: cek))
        while plaintext.last == 0 { plaintext.removeLast() }
        guard plaintext.last == 2 else { throw Failure.invalid }
        plaintext.removeLast()
        return plaintext
    }
}
