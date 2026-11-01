// AUTHORED-BY Codex GPT-6.1-Sol
import Foundation

/// Main-queue early-challenge mailbox. The challenge registrationId names the installation (P4).
final class PushActivation {
    private struct Challenge { let nonce: String; let expires: TimeInterval }
    private var early = [String: Challenge]()
    private var seen = [String]()
    func deliver(_ payload: PushPayload, now: TimeInterval) {
        guard payload.kind == "challenge", let nonce = payload.nonce, !seen.contains(payload.id) else { return }
        seen.append(payload.id); seen = Array(seen.suffix(50))
        early = early.filter { $0.value.expires > now }
        if early.count >= 4, let key = early.keys.sorted().first { early.removeValue(forKey: key) }
        early[payload.registrationId] = Challenge(nonce: nonce, expires: now + 60)
    }
    func take(_ installation: String, now: TimeInterval) -> String? {
        guard let challenge = early.removeValue(forKey: installation), challenge.expires > now else { return nil }
        return challenge.nonce
    }
    func clear() { early.removeAll(); seen.removeAll() }
}
