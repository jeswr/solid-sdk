// AUTHORED-BY Codex GPT-6.1-Sol
import CryptoKit
import Foundation

/// Platform-independent validation. A route has one unreserved, opaque chat id; no decoding steps.
enum PushPolicy {
    static let generic = "You have new activity"
    static func route(_ route: String) -> Bool {
        route.utf8.count <= 512 && !route.contains("..") && route != "/chat/." &&
            (route == "/notifications" || route.range(of: "\\A/chat/[A-Za-z0-9_.~-]+\\z", options: .regularExpression) != nil)
    }
    static func identifier(_ id: String) -> Bool {
        id.range(of: "\\A[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil
    }
    static func group(_ registration: String, _ index: Int) -> String {
        SHA256.hash(data: Data("\(registration):\(index)".utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    }
    static func text(kind: String, label: String) -> String {
        kind == "inbox" ? "New item in your inbox" : "New message in \(label)"
    }
    /// The entitlement flag is false in shipping plists. Timeout/locked always keep the placeholder.
    static func fallback(filtering: Bool, readable: Bool, expired: Bool = false) -> Bool {
        filtering && readable && !expired
    }
}

struct PushPayload {
    let id: String
    let kind: String
    let registrationId: String
    let topicIndex: Int
    let nonce: String?

    init(_ bytes: Data) throws {
        guard bytes.count == 512, String(data: bytes, encoding: .utf8) != nil else { throw PushCrypto.Failure.invalid }
        var parser = PushPlainJSON(bytes: Array(bytes))
        let fields = try parser.object()
        guard case .integer(1)? = fields["v"],
              case let .string(id)? = fields["id"], PushPolicy.identifier(id),
              case let .string(kind)? = fields["kind"], ["inbox", "chat", "challenge"].contains(kind),
              case let .string(registration)? = fields["registrationId"], PushPolicy.identifier(registration),
              case let .integer(index)? = fields["topicIndex"], (0..<16).contains(index),
              case let .integer(sentAt)? = fields["sentAt"], sentAt >= 0 else { throw PushCrypto.Failure.invalid }
        var expected: Set<String> = ["v", "id", "kind", "registrationId", "topicIndex", "sentAt"]
        var nonce: String?
        if kind == "challenge" {
            expected.insert("nonce")
            guard case let .string(value)? = fields["nonce"], try PushCrypto.unb64(value).count == 16 else { throw PushCrypto.Failure.invalid }
            nonce = value
        }
        guard Set(fields.keys) == expected else { throw PushCrypto.Failure.invalid }
        self.id = id; self.kind = kind; registrationId = registration; topicIndex = index; self.nonce = nonce
    }
}

/// P5 JSON is flat strings/integers only. Reject duplicates, floats, booleans, extra fields and invalid escapes.
private struct PushPlainJSON {
    enum Value { case string(String), integer(Int) }
    let bytes: [UInt8]
    var at = 0
    mutating func space() { while at < bytes.count && [9, 10, 13, 32].contains(bytes[at]) { at += 1 } }
    mutating func expect(_ byte: UInt8) throws {
        guard at < bytes.count, bytes[at] == byte else { throw PushCrypto.Failure.invalid }; at += 1
    }
    mutating func string() throws -> String {
        let start = at
        try expect(34)
        while at < bytes.count {
            let byte = bytes[at]; at += 1
            if byte == 34 {
                let data = Data(bytes[start..<at])
                guard let value = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as? String else { throw PushCrypto.Failure.invalid }
                return value
            }
            if byte == 92 { guard at < bytes.count else { throw PushCrypto.Failure.invalid }; at += 1 }
        }
        throw PushCrypto.Failure.invalid
    }
    mutating func object() throws -> [String: Value] {
        space(); try expect(123); space()
        var fields = [String: Value]()
        while true {
            let key = try string(); space(); try expect(58); space()
            guard fields[key] == nil, at < bytes.count else { throw PushCrypto.Failure.invalid }
            if bytes[at] == 34 { fields[key] = .string(try string()) }
            else {
                let start = at
                while at < bytes.count && (48...57).contains(bytes[at]) { at += 1 }
                guard start < at, at - start == 1 || bytes[start] != 48,
                      let value = Int(String(decoding: bytes[start..<at], as: UTF8.self)) else { throw PushCrypto.Failure.invalid }
                fields[key] = .integer(value)
            }
            space()
            if at < bytes.count && bytes[at] == 125 { at += 1; break }
            try expect(44); space()
        }
        // Exactly trailing SP bytes, rather than arbitrary JSON whitespace, provide P5 padding.
        guard bytes[at...].allSatisfy({ $0 == 32 }) else { throw PushCrypto.Failure.invalid }
        return fields
    }
}
