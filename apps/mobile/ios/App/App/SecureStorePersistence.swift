// AUTHORED-BY GPT-5.6 Codex
import Foundation
import Security

protocol SecureStoreFileWriting {
    func read() throws -> Data?
    func write(_ data: Data) throws
}

final class SecureStoreFileWriter: SecureStoreFileWriting {
    let file: URL

    init(support: URL, namespace: String) throws {
        var directory = support.appendingPathComponent("securestore", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        // Excluding the directory also excludes atomic replacements and their temporary files.
        try directory.setResourceValues(values)
        file = directory.appendingPathComponent("\(namespace).bin")
    }

    func read() throws -> Data? {
        do { return try Data(contentsOf: file) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return nil }
    }

    func write(_ data: Data) throws {
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

protocol SecureStoreInstallChecking {
    func prepare() throws
}

protocol SecureStoreKeyWiping {
    func wipe() throws
}

/// The marker is published only after every namespace and both Keychain classes were wiped.
struct SecureStoreInstallation: SecureStoreInstallChecking {
    let support: URL
    let keys: SecureStoreKeyWiping
    var marker: URL { support.appendingPathComponent("securestore-installed.bin") }

    func prepare() throws {
        let fm = FileManager.default
        try fm.createDirectory(at: support, withIntermediateDirectories: true)
        if fm.fileExists(atPath: marker.path) { return }
        let directory = support.appendingPathComponent("securestore", isDirectory: true)
        if fm.fileExists(atPath: directory.path) { try fm.removeItem(at: directory) }
        try keys.wipe()
        var pending = support.appendingPathComponent("securestore-installing.bin")
        try Data([1]).write(to: pending, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try pending.setResourceValues(values)
        try fm.moveItem(at: pending, to: marker)
    }
}

struct SecureStoreKeychainWiper: SecureStoreKeyWiping {
    static let prefix = "org.jeswr.suite.securestore."

    func wipe() throws {
        try wipeClass(kSecClassGenericPassword, field: kSecAttrService)
        try wipeClass(kSecClassKey, field: kSecAttrApplicationTag)
    }

    private func wipeClass(_ itemClass: CFString, field: CFString) throws {
        var result: CFTypeRef?
        let query: [String: Any] = [
            kSecClass as String: itemClass,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
            kSecReturnPersistentRef as String: true,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
        ]
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return }
        guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw SecureStoreFailure.failed }
        for item in items {
            let identifier: String?
            if let data = item[field as String] as? Data { identifier = String(data: data, encoding: .utf8) }
            else { identifier = item[field as String] as? String }
            guard identifier?.hasPrefix(Self.prefix) == true else { continue }
            guard let reference = item[kSecValuePersistentRef as String] as? Data else { throw SecureStoreFailure.failed }
            let deletion: [String: Any] = [kSecValuePersistentRef as String: reference]
            let deleted = SecItemDelete(deletion as CFDictionary)
            guard deleted == errSecSuccess || deleted == errSecItemNotFound else { throw SecureStoreFailure.failed }
        }
    }
}
