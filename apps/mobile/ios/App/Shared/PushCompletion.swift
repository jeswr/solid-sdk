// AUTHORED-BY Codex GPT-6.1-Sol
import Foundation

/// Exactly-once NSE completion. A per-request object prevents late work from completing a newer request.
final class PushCompletion<Content> {
    let placeholder: Content
    private let lock = NSLock()
    private var callback: ((Content) -> Void)?
    init(placeholder: Content, callback: @escaping (Content) -> Void) {
        self.placeholder = placeholder; self.callback = callback
    }
    var pending: Bool { lock.lock(); defer { lock.unlock() }; return callback != nil }
    @discardableResult func finish(_ content: Content) -> Bool {
        lock.lock(); let callback = self.callback; self.callback = nil; lock.unlock()
        callback?(content); return callback != nil
    }
    @discardableResult func expire() -> Bool { finish(placeholder) }
}
