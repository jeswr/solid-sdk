// AUTHORED-BY Codex GPT-6
import Foundation
import Security

protocol SecureStoreMigrationKeys {
    func artifacts(namespace: String) throws -> [Data]
    func delete(_ reference: Data) throws
}

/// Inspects attributes only, never decrypts, authenticates, or reads a token.
struct SecureStoreMigrationKeychain: SecureStoreMigrationKeys {
    static func owns(_ identifier: String, namespace: String, password: Bool) -> Bool {
        let service = SecureStoreKeychainWiper.prefix + namespace
        return password ? identifier == service : identifier.hasPrefix(service + ".")
    }

    func artifacts(namespace: String) throws -> [Data] {
        var references = [Data]()
        for password in [true, false] {
            var result: CFTypeRef?
            let query: [String: Any] = [
                kSecClass as String: password ? kSecClassGenericPassword : kSecClassKey,
                kSecMatchLimit as String: kSecMatchLimitAll,
                kSecReturnAttributes as String: true,
                kSecReturnPersistentRef as String: true,
                kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
                kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
            ]
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound { continue }
            guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw SecureStoreFailure.failed }
            for item in items {
                let field = password ? kSecAttrService : kSecAttrApplicationTag
                let raw = item[field as String]
                let identifier = (raw as? Data).flatMap { String(data: $0, encoding: .utf8) } ?? raw as? String
                guard let identifier, Self.owns(identifier, namespace: namespace, password: password) else { continue }
                guard let reference = item[kSecValuePersistentRef as String] as? Data else { throw SecureStoreFailure.failed }
                references.append(reference)
            }
        }
        return references
    }

    func delete(_ reference: Data) throws {
        let status = SecItemDelete([kSecValuePersistentRef as String: reference] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw SecureStoreFailure.failed }
    }
}

/// Native startup only; the bridge exposes only the one-shot notice, never this migration or its inputs.
struct SecureStoreMigration {
    private static let lock = NSLock()
    let support: URL
    let keys: SecureStoreMigrationKeys
    // Fault injection lets XCTest interrupt every durable transition, including after the last deletion.
    var checkpoint: () throws -> Void = {}
    private var journal: URL { support.appendingPathComponent("securestore-migration", isDirectory: true) }
    private var notice: URL { journal.appendingPathComponent("notice.bin") }

    static func predecessors(_ data: Data) throws -> [SuiteOrigin] {
        guard let info = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              info["target"] as? String == "native",
              let values = info["predecessorOrigins"] as? [String], values.count <= 32 else { throw SecureStoreFailure.invalid }
        var origins = [SuiteOrigin]()
        for value in values {
            guard let parts = URLComponents(string: value), parts.scheme == "https", parts.user == nil, parts.password == nil,
                  parts.path.isEmpty, parts.query == nil, parts.fragment == nil,
                  let host = parts.host, !host.isEmpty, host == host.lowercased(),
                  host.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789.-:[]").contains($0) }),
                  host != "localhost", !host.hasSuffix(".localhost"),
                  parts.port == nil || (parts.port! > 0 && parts.port! <= 65535 && parts.port! != 443),
                  value == "https://" + host + (parts.port.map { ":\($0)" } ?? ""),
                  let origin = SuiteOrigin(url: parts.url) else { throw SecureStoreFailure.invalid }
            if !origins.contains(origin) { origins.append(origin) }
        }
        return origins
    }

    private func publish(_ bytes: Data, to file: URL) throws {
        try FileManager.default.createDirectory(at: journal, withIntermediateDirectories: true)
        var directory = journal
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        try bytes.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func run(_ buildInfo: Data) throws {
        let origins = try Self.predecessors(buildInfo) // All entries pass before any artifact is touched.
        Self.lock.lock()
        defer { Self.lock.unlock() }
        let fm = FileManager.default
        for origin in origins {
            let namespace = SecureStoreValidation.namespace(origin)
            let file = support.appendingPathComponent("securestore/\(namespace).bin")
            let references = try keys.artifacts(namespace: namespace)
            let exists = fm.fileExists(atPath: file.path)
            var session = !references.isEmpty
            if exists {
                // A signed-out epoch/tombstone alone needs no notice. Corrupt state may contain credentials.
                let state: SecureStoreState? = try? {
                    let decoded = try JSONDecoder().decode(SecureStoreState.self, from: Data(contentsOf: file))
                    try decoded.validate()
                    return decoded
                }()
                session = state == nil || state?.records.isEmpty == false
            }
            if session { try publish(Data([1]), to: notice); try checkpoint() }
            if exists { try fm.removeItem(at: file); try checkpoint() }
            for reference in references { try keys.delete(reference); try checkpoint() }
            guard !fm.fileExists(atPath: file.path), try keys.artifacts(namespace: namespace).isEmpty else { throw SecureStoreFailure.failed }
            // Always recheck artifacts, including when this completion marker already exists.
            try publish(Data([1]), to: journal.appendingPathComponent("\(namespace).bin"))
            try checkpoint()
        }
    }

    func takeNotice() throws -> Bool {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        guard FileManager.default.fileExists(atPath: notice.path) else { return false }
        let bytes = try Data(contentsOf: notice)
        guard bytes == Data([0]) || bytes == Data([1]) else { throw SecureStoreFailure.failed }
        guard bytes == Data([1]) else { return false }
        try checkpoint()
        try publish(Data([0]), to: notice)
        return true
    }
}
