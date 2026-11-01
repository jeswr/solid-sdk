// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import Darwin
import Foundation

/// Small App Group file, protected until first unlock. flock serializes app/NSE read-modify-write.
final class PushStore {
    struct Topic: Codable {
        let index: Int
        let kind: String
        let label: String
        let route: String
        let enabled: Bool
        func validate() throws {
            guard (0..<16).contains(index), ["inbox", "chat"].contains(kind), !label.isEmpty, label.utf16.count <= 160,
                  !label.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  PushPolicy.route(route) else { throw PushCrypto.Failure.invalid }
        }
    }
    struct Registration: Codable { var silenced: Bool; let topics: [Topic] }
    struct Launch { let registrationId: String?; let route: String }
    // Optional index safely migrates old saved routes; their route text is never used.
    private struct PendingLaunch: Codable { let registrationId: String; let topicIndex: Int? }
    private struct State: Codable {
        var registrations = [String: Registration]()
        var seen = [String]()
        var counts = [String: Int]()
        var launch: PendingLaunch?
    }
    struct Delivery {
        let payload: PushPayload
        let body: String
        let group: String
        let count: Int
    }
    let root: URL
    init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var mutable = root
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try mutable.setResourceValues(values)
    }
    static func shared() throws -> PushStore {
        guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.org.jeswr.suite") else { throw PushCrypto.Failure.invalid }
        return try PushStore(root: group.appendingPathComponent("push", isDirectory: true))
    }
    private func transaction<T>(_ action: (inout State) throws -> T) throws -> T {
        let lockURL = root.appendingPathComponent("state.lock")
        let fd = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw PushCrypto.Failure.invalid }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw PushCrypto.Failure.invalid }
        defer { flock(fd, LOCK_UN) }
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: lockURL.path)
        let url = root.appendingPathComponent("topics.json")
        var state = State()
        if FileManager.default.fileExists(atPath: url.path) {
            let bytes = try Data(contentsOf: url, options: .mappedIfSafe)
            guard bytes.count <= 131072 else { throw PushCrypto.Failure.invalid }
            state = try JSONDecoder().decode(State.self, from: bytes)
        }
        let result = try action(&state)
        try JSONEncoder().encode(state).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return result
    }
    func setTopics(registration: String, topics: [Topic]) throws {
        guard PushPolicy.identifier(registration), topics.count <= 16, Set(topics.map { $0.index }).count == topics.count else { throw PushCrypto.Failure.invalid }
        try topics.forEach { try $0.validate() }
        try transaction { state in
            if topics.isEmpty {
                state.registrations.removeValue(forKey: registration)
                for index in 0..<16 { state.counts.removeValue(forKey: PushPolicy.group(registration, index)) }
                return
            }
            guard state.registrations[registration] != nil || state.registrations.count < 4 else { throw PushCrypto.Failure.invalid }
            state.registrations[registration] = Registration(silenced: false, topics: topics)
        }
    }
    func silence(_ registration: String) throws {
        guard PushPolicy.identifier(registration) else { throw PushCrypto.Failure.invalid }
        try transaction { $0.registrations[registration]?.silenced = true }
    }
    func silenceAll() throws {
        try transaction { state in
            for id in Array(state.registrations.keys) { state.registrations[id]?.silenced = true }
        }
    }
    func clear() throws { try transaction { $0 = State() } }
    private static func topic(_ state: State, _ registration: String, _ index: Int) -> Topic? {
        guard let reg = state.registrations[registration], !reg.silenced,
              let topic = reg.topics.first(where: { $0.index == index && $0.enabled }), PushPolicy.route(topic.route) else { return nil }
        return topic
    }
    func accept(_ payload: PushPayload) throws -> Delivery? {
        try transaction { state in
            guard payload.kind != "challenge", let topic = Self.topic(state, payload.registrationId, payload.topicIndex),
                  topic.kind == payload.kind, !state.seen.contains(payload.id) else { return nil }
            state.seen.append(payload.id); state.seen = Array(state.seen.suffix(50))
            let group = PushPolicy.group(payload.registrationId, payload.topicIndex)
            let count = min(state.counts[group, default: 0], 999998) + 1; state.counts[group] = count
            return Delivery(payload: payload, body: PushPolicy.text(kind: payload.kind, label: topic.label), group: group, count: count)
        }
    }
    /// Serialize the final content delivery with local silence, including across app/NSE processes.
    func withActive(_ payload: PushPayload, action: () -> Void) throws -> Bool {
        try transaction { state in
            guard let topic = Self.topic(state, payload.registrationId, payload.topicIndex), topic.kind == payload.kind else { return false }
            action(); return true
        }
    }
    /// Foreground presentation never trusts APNs content, even when an NSE did not run.
    func withPresentation(_ payload: PushPayload, action: (Delivery) -> Void) throws -> Bool {
        try transaction { state in
            guard payload.kind != "challenge", let topic = Self.topic(state, payload.registrationId, payload.topicIndex),
                  topic.kind == payload.kind else { return false }
            let group = PushPolicy.group(payload.registrationId, payload.topicIndex)
            action(Delivery(payload: payload, body: PushPolicy.text(kind: topic.kind, label: topic.label),
                            group: group, count: max(1, state.counts[group, default: 1])))
            return true
        }
    }
    func launch(registration: String, index: Int) throws {
        guard PushPolicy.identifier(registration), (0..<16).contains(index) else { throw PushCrypto.Failure.invalid }
        try transaction { state in
            state.launch = PendingLaunch(registrationId: registration, topicIndex: index)
            state.counts.removeValue(forKey: PushPolicy.group(registration, index))
        }
    }
    func consumeLaunch() throws -> Launch? {
        try transaction { state in
            guard let launch = state.launch else { return nil }; state.launch = nil
            let topic = launch.topicIndex.flatMap { Self.topic(state, launch.registrationId, $0) }
            return Launch(registrationId: state.registrations[launch.registrationId] == nil ? nil : launch.registrationId,
                          route: topic?.route ?? "/notifications")
        }
    }
}
