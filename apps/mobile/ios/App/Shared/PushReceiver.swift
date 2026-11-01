// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import Foundation

/// The NSE's decision seam. No key or map access is attempted before protected data is readable.
enum PushReceiver {
    static let presentationKey = "suitePushPresentation"
    enum Outcome { case placeholder, hidden, notify(PushStore.Delivery) }
    /// Rejected/expired NSE work must never give the foreground delegate another encrypted delivery.
    static func placeholderInfo(_ info: [AnyHashable: Any]) -> [AnyHashable: Any] {
        var safe = info
        safe.removeValue(forKey: "p"); safe.removeValue(forKey: presentationKey)
        safe.removeValue(forKey: "suitePushGroup")
        return safe
    }
    static func foreground(_ encoded: String?, decrypt: (String) throws -> Data,
                           present: (PushPayload) throws -> Bool) -> Bool {
        guard let encoded = encoded, encoded.utf8.count <= 5462 else { return false }
        do {
            let payload = try PushPayload(decrypt(encoded))
            guard payload.kind != "challenge" else { return false }
            return try present(payload)
        } catch { return false }
    }
    /// APNs background challenges bypass topic lookup because installation activation precedes registration.
    static func background(_ encoded: String?, decrypt: (String) throws -> Data) throws -> PushPayload? {
        guard let encoded = encoded, encoded.utf8.count <= 5462 else { return nil }
        let payload = try PushPayload(decrypt(encoded))
        return payload.kind == "challenge" ? payload : nil
    }
    static func receive(_ encoded: String?, readable: Bool, filtering: Bool,
                        decrypt: (String) throws -> Data, accept: (PushPayload) throws -> PushStore.Delivery?) -> Outcome {
        guard readable else { return .placeholder }
        let fallback: Outcome = filtering ? .hidden : .placeholder
        guard let encoded = encoded, encoded.utf8.count <= 5462 else { return fallback }
        do {
            let payload = try PushPayload(decrypt(encoded))
            guard payload.kind != "challenge", let delivery = try accept(payload) else { return fallback }
            return .notify(delivery)
        } catch { return fallback }
    }
}
