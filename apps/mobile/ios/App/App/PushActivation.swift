// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import Foundation

/// Permission/token operations share this gate with synchronous local-first disable.
final class PushEnablement<Call: AnyObject> {
    private let lock = NSRecursiveLock()
    private var pending: Call?
    func begin(_ call: Call) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard pending == nil else { return false }; pending = call; return true
    }
    @discardableResult func withCurrent(_ call: Call, action: () -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard pending === call else { return false }; action(); return true
    }
    @discardableResult func finish(_ call: Call, action: () -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard pending === call else { return false }; pending = nil; action(); return true
    }
    @discardableResult func disable(silence: () throws -> Void) rethrows -> Call? {
        lock.lock(); defer { lock.unlock() }
        try silence()
        let cancelled = pending; pending = nil; return cancelled
    }
}

/// Main-queue APNs state. Each enable waits for APNs; unsolicited updates still record rotation.
final class PushTokenRegistration {
    private enum Failure: Error { case busy }
    private(set) var token: String?
    private var acceptingCallbacks = true
    private let recordToken: (String) throws -> Void
    private var completion: ((Result<String, Error>) -> Void)?
    init(recordToken: @escaping (String) throws -> Void = { _ in }) { self.recordToken = recordToken }
    func register(_ completion: @escaping (Result<String, Error>) -> Void, request: () -> Void) {
        guard self.completion == nil else { completion(.failure(Failure.busy)); return }
        acceptingCallbacks = true
        self.completion = completion; request()
    }
    func registered(_ token: String) {
        guard acceptingCallbacks else { return }
        self.token = token
        let completion = self.completion; self.completion = nil
        do { try recordToken(token); completion?(.success(token)) }
        catch { completion?(.failure(error)) }
    }
    func failed(_ error: Error) {
        let completion = self.completion; self.completion = nil; completion?(.failure(error))
    }
    func cancel() { completion = nil }
    func clear() { completion = nil; token = nil; acceptingCallbacks = false }
}

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
