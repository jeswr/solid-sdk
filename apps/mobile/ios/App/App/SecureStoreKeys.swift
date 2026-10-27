// AUTHORED-BY GPT-5.6 Codex
import Foundation
import CryptoKit
import LocalAuthentication
import Security

protocol SecureStoreAuthentication: AnyObject {
    var context: LAContext? { get }
    func authenticate(accessControl: SecAccessControl, completion: @escaping (Result<Void, SecureStoreFailure>) -> Void)
    func invalidate()
}

protocol SecureStoreAuthenticating {
    func makeSession() -> SecureStoreAuthentication
}

struct SecureStoreAuthenticator: SecureStoreAuthenticating {
    let isForeground: () -> Bool

    func makeSession() -> SecureStoreAuthentication { return SecureStoreAuthenticationSession(isForeground: isForeground) }
}

final class SecureStoreAuthenticationSession: SecureStoreAuthentication {
    let context: LAContext? = LAContext()
    private let isForeground: () -> Bool
    // Only the main thread starts or invalidates a session. The storage queue never waits for it.
    private var invalidated = false

    init(isForeground: @escaping () -> Bool) {
        self.isForeground = isForeground
        context?.touchIDAuthenticationAllowableReuseDuration = 0
    }

    func authenticate(accessControl: SecAccessControl, completion: @escaping (Result<Void, SecureStoreFailure>) -> Void) {
        DispatchQueue.main.async {
            guard !self.invalidated, let context = self.context else { completion(.failure(.cancelled)); return }
            guard self.isForeground() else { completion(.failure(.background)); return }
            // ECIES unwrap uses ECDH, so the Secure Enclave's privateKeyUsage constraint authorises key exchange.
            context.evaluateAccessControl(accessControl, operation: .useKeyKeyExchange,
                                          localizedReason: NSLocalizedString("Unlock Solid Suite", comment: "Secure store unlock prompt")) { success, error in
                // The evaluated access control authorises the key operation; it must not open a second prompt on the queue.
                context.interactionNotAllowed = true
                if success { completion(.success(())) }
                else { completion(.failure(Self.failure(error))) }
            }
        }
    }

    func invalidate() {
        DispatchQueue.main.async {
            self.invalidated = true
            self.context?.invalidate()
        }
    }

    static func failure(_ error: Error?) -> SecureStoreFailure {
        guard let error = error as? LAError else { return .failed }
        switch error.code {
        case .userCancel, .appCancel, .systemCancel: return .cancelled
        case .biometryLockout: return .lockout
        case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet, .notInteractive: return .unavailable
        default: return .failed
        }
    }
}

struct SecureStoreWrappedKey {
    let keyId: String
    let data: Data
}

protocol SecureStoreKeyProviding {
    var userPresence: Bool { get }
    var hardwareBacked: Bool { get }
    func ungated(create: Bool) throws -> Data
    func wrap(_ data: Data, currentKeyId: String?) throws -> SecureStoreWrappedKey
    func accessControl(keyId: String) throws -> SecAccessControl
    func unwrap(_ data: Data, keyId: String, authentication: SecureStoreAuthentication) throws -> Data
    func retire(keyId: String) throws
}

final class SecureStoreKeyProvider: SecureStoreKeyProviding {
    private let service: String
    var hardwareBacked: Bool { return SecureEnclave.isAvailable }
    var userPresence: Bool {
        return hardwareBacked && LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    init(namespace: String) { service = SecureStoreKeychainWiper.prefix + namespace }

    static func random(_ count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else { throw SecureStoreFailure.failed }
        return Data(bytes)
    }

    static func check(_ status: OSStatus) throws {
        switch status {
        case errSecSuccess: return
        case errSecItemNotFound: throw SecureStoreRecordFailure.missingKey
        case errSecInteractionNotAllowed, errSecNotAvailable: throw SecureStoreFailure.unavailable
        case errSecUserCanceled: throw SecureStoreFailure.cancelled
        default: throw SecureStoreFailure.failed
        }
    }

    func ungated(create: Bool) throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "record",
            kSecAttrSynchronizable as String: false,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound && create {
            let key = try Self.random(32)
            var item = query
            item.removeValue(forKey: kSecReturnData as String)
            item.removeValue(forKey: kSecMatchLimit as String)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            item[kSecValueData as String] = key
            try Self.check(SecItemAdd(item as CFDictionary, nil))
            return key
        }
        try Self.check(status)
        guard let key = result as? Data, key.count == 32 else { throw SecureStoreRecordFailure.corrupt }
        return key
    }

    private func tag(_ keyId: String) throws -> Data {
        guard SecureStoreValidation.isKeyId(keyId) else { throw SecureStoreRecordFailure.corrupt }
        return Data("\(service).\(keyId)".utf8)
    }

    private func keyQuery(_ keyId: String) throws -> [String: Any] {
        return [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecAttrApplicationTag as String: try tag(keyId),
            kSecAttrSynchronizable as String: false,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
    }

    func accessControl(keyId: String) throws -> SecAccessControl {
        var query = try keyQuery(keyId)
        query[kSecReturnAttributes as String] = true
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        var result: CFTypeRef?
        try Self.check(SecItemCopyMatching(query as CFDictionary, &result))
        guard let attributes = result as? [String: Any], let raw = attributes[kSecAttrAccessControl as String],
              CFGetTypeID(raw as CFTypeRef) == SecAccessControlGetTypeID() else { throw SecureStoreFailure.failed }
        return raw as! SecAccessControl
    }

    private func privateKey(_ keyId: String, context: LAContext? = nil) throws -> SecKey {
        var query = try keyQuery(keyId)
        query[kSecReturnRef as String] = true
        if let context = context { query[kSecUseAuthenticationContext as String] = context }
        else { query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail }
        var result: CFTypeRef?
        try Self.check(SecItemCopyMatching(query as CFDictionary, &result))
        guard let result = result, CFGetTypeID(result) == SecKeyGetTypeID() else { throw SecureStoreFailure.failed }
        return result as! SecKey
    }

    func wrap(_ data: Data, currentKeyId: String?) throws -> SecureStoreWrappedKey {
        guard userPresence else { throw SecureStoreFailure.unavailable }
        var keyId = currentKeyId
        var key: SecKey?
        if let current = currentKeyId {
            do { key = try privateKey(current) }
            catch SecureStoreRecordFailure.missingKey { try retire(keyId: current); keyId = nil }
        }
        if key == nil {
            keyId = try Self.random(16).map { String(format: "%02x", $0) }.joined()
            var error: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                                                               [.privateKeyUsage, .userPresence], &error) else {
                throw Self.failure(error?.takeRetainedValue())
            }
            let attributes: [String: Any] = [
                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeySizeInBits as String: 256,
                kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
                kSecPrivateKeyAttrs as String: [
                    kSecAttrIsPermanent as String: true,
                    kSecAttrApplicationTag as String: try tag(keyId!),
                    kSecAttrAccessControl as String: access,
                    kSecAttrSynchronizable as String: false
                ]
            ]
            key = SecKeyCreateRandomKey(attributes as CFDictionary, &error)
            if key == nil { throw Self.failure(error?.takeRetainedValue()) }
        }
        guard let key = key, let id = keyId, let publicKey = SecKeyCopyPublicKey(key) else { throw SecureStoreFailure.failed }
        var error: Unmanaged<CFError>?
        guard let wrapped = SecKeyCreateEncryptedData(publicKey, .eciesEncryptionCofactorVariableIVX963SHA256AESGCM,
                                                       data as CFData, &error) else { throw Self.failure(error?.takeRetainedValue()) }
        return SecureStoreWrappedKey(keyId: id, data: wrapped as Data)
    }

    func unwrap(_ data: Data, keyId: String, authentication: SecureStoreAuthentication) throws -> Data {
        guard let context = authentication.context else { throw SecureStoreFailure.failed }
        let key = try privateKey(keyId, context: context)
        return try Self.unwrap(data, using: key)
    }

    static func unwrap(_ data: Data, using key: SecKey) throws -> Data {
        // ECIES starts with an uncompressed P-256 ephemeral public key and ends with a GCM tag.
        guard data.count >= 65 + 16, data.first == 0x04 else { throw SecureStoreRecordFailure.corrupt }
        var error: Unmanaged<CFError>?
        guard let value = SecKeyCreateDecryptedData(key, .eciesEncryptionCofactorVariableIVX963SHA256AESGCM,
                                                    data as CFData, &error) else {
            throw Self.unwrapFailure(error?.takeRetainedValue())
        }
        return value as Data
    }

    static func unwrapFailure(_ error: CFError?) -> Error {
        if let error = error, CFErrorGetDomain(error) == kCFErrorDomainOSStatus {
            let status = CFErrorGetCode(error)
            // Security also uses errSecParam for truncated ECIES packets and failed GCM tags.
            if status == Int(errSecDecode) || status == Int(errSecParam) { return SecureStoreRecordFailure.corrupt }
        }
        return failure(error)
    }

    private static func failure(_ error: CFError?) -> Error {
        guard let error = error else { return SecureStoreFailure.failed }
        if CFErrorGetDomain(error) == kCFErrorDomainOSStatus {
            do { try check(OSStatus(CFErrorGetCode(error))) } catch { return error }
        }
        if CFErrorGetDomain(error) as String == LAError.errorDomain {
            return SecureStoreAuthenticationSession.failure(error as Error)
        }
        return SecureStoreFailure.failed
    }

    func retire(keyId: String) throws {
        var query = try keyQuery(keyId)
        query.removeValue(forKey: kSecMatchLimit as String)
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecItemNotFound { try Self.check(status) }
    }
}
