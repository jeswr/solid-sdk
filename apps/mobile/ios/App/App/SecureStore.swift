// AUTHORED-BY GPT-5.6 Codex
// AUTHORED-BY Codex GPT-6
import Foundation
import Security

struct SecureStoreRead {
    let value: String?
    let version: Int64
}

/// Shared with the bridge so lifecycle cancellation never waits behind decryption on the storage queue.
final class SecureStoreCancellation {
    struct Ticket {
        let key: String
        let generation: UInt64
        let keyGeneration: UInt64
        let documentGeneration: UInt64
    }
    private let lock = NSRecursiveLock()
    private var generation: UInt64 = 0
    private var keyGenerations = [String: UInt64]()
    private var documentGeneration: UInt64 = 0

    func ticket(key: String) -> Ticket {
        lock.lock()
        defer { lock.unlock() }
        return Ticket(key: key, generation: generation, keyGeneration: keyGenerations[key, default: 0],
                      documentGeneration: documentGeneration)
    }

    func cancel(key: String? = nil) {
        lock.lock()
        defer { lock.unlock() }
        if let key = key { keyGenerations[key, default: 0] &+= 1 }
        else { generation &+= 1 }
    }

    func documentChanged() {
        lock.lock()
        defer { lock.unlock() }
        // Every KVO navigation signal and every main-frame commit invalidates the old document.
        // A read begun during provisional loading belongs to that generation until commit.
        documentGeneration &+= 1
    }

    func isCurrent(_ ticket: Ticket) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return ticket.documentGeneration == documentGeneration && ticket.generation == generation &&
            ticket.keyGeneration == keyGenerations[ticket.key, default: 0]
    }

    func check(_ ticket: Ticket) throws {
        guard isCurrent(ticket) else { throw SecureStoreFailure.cancelled }
    }

    func deliver(_ ticket: Ticket, _ result: Result<SecureStoreRead, Error>,
                 completion: (Result<SecureStoreRead, Error>) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        // Keep the final check and bridge delivery indivisible with respect to cancellation.
        completion(isCurrent(ticket) ? result : .failure(SecureStoreFailure.cancelled))
    }
}

/// Owned by the store's queue. Removing an id precedes invalidation or invoking any completion.
final class SecureStoreOperations {
    private struct Operation {
        let key: String
        let ticket: SecureStoreCancellation.Ticket
        let authentication: SecureStoreAuthentication
        let completion: (Result<SecureStoreRead, Error>) -> Void
    }
    private var pending = [UUID: Operation]()

    func begin(key: String, ticket: SecureStoreCancellation.Ticket, authentication: SecureStoreAuthentication,
               completion: @escaping (Result<SecureStoreRead, Error>) -> Void) -> UUID {
        let id = UUID()
        pending[id] = Operation(key: key, ticket: ticket, authentication: authentication, completion: completion)
        return id
    }

    func contains(_ id: UUID) -> Bool { return pending[id] != nil }

    func finish(_ id: UUID, _ result: Result<SecureStoreRead, Error>) {
        guard let operation = pending.removeValue(forKey: id) else { return }
        operation.authentication.invalidate()
        operation.completion(result)
    }

    func cancel(key: String? = nil) {
        let ids = pending.filter { key == nil || $0.value.key == key }.map { $0.key }
        for id in ids { finish(id, .failure(SecureStoreFailure.cancelled)) }
    }

    func cancelInvalidated(using cancellation: SecureStoreCancellation) {
        let ids = pending.filter { !cancellation.isCurrent($0.value.ticket) }.map { $0.key }
        for id in ids { finish(id, .failure(SecureStoreFailure.cancelled)) }
    }
}

enum SecureStoreRecovery {
    static func shouldRemove(_ error: Error) -> Bool { return error is SecureStoreRecordFailure }
    static func shouldRetire(_ error: Error) -> Bool {
        guard let error = error as? SecureStoreRecordFailure else { return false }
        if case .missingKey = error { return true }
        return false
    }
}

/// All state, crypto and persistence run on `queue`; authentication returns there asynchronously.
final class SecureStore {
    let namespace: String
    private let queue: DispatchQueue
    private let writer: SecureStoreFileWriting
    private let keys: SecureStoreKeyProviding
    private let authenticator: SecureStoreAuthenticating
    private let codec: SecureStoreRecordCoding
    private let cancellation: SecureStoreCancellation
    private let operations = SecureStoreOperations()
    private var state: SecureStoreState

    init(namespace: String, queue: DispatchQueue, installation: SecureStoreInstallChecking,
         writer: () throws -> SecureStoreFileWriting, keys: SecureStoreKeyProviding,
         authenticator: SecureStoreAuthenticating, codec: SecureStoreRecordCoding = SecureStoreRecordCodec(),
         cancellation: SecureStoreCancellation = SecureStoreCancellation()) throws {
        self.namespace = namespace
        self.queue = queue
        self.keys = keys
        self.authenticator = authenticator
        self.codec = codec
        self.cancellation = cancellation
        try installation.prepare()
        self.writer = try writer()
        if let data = try self.writer.read() {
            state = try JSONDecoder().decode(SecureStoreState.self, from: data)
            try state.validate()
        } else { state = SecureStoreState() }
    }

    var userPresence: Bool { return keys.userPresence }
    var hardwareBacked: Bool { return keys.hardwareBacked }

    private func commit(_ next: SecureStoreState) throws {
        let data = try JSONEncoder().encode(next)
        try writer.write(data)
        state = next
    }

    func set(key: String, value: String, userPresence: Bool, version: Int64) throws -> Int64 {
        _ = try SecureStoreValidation.key(key)
        _ = try SecureStoreValidation.value(value)
        guard version >= 0, version <= SecureStoreValidation.maxVersion else { throw SecureStoreFailure.invalid }
        try state.checkSet(key: key, version: version)
        var next = state
        let record: SecureStoreRecord
        if userPresence {
            guard keys.userPresence else { throw SecureStoreFailure.unavailable }
            let dataKey = try SecureStoreKeyProvider.random(32)
            let wrapped = try keys.wrap(dataKey, currentKeyId: state.wrappingKeyId)
            record = try codec.seal(value, namespace: namespace, key: key, mode: 1,
                                    keyId: wrapped.keyId, dataKey: dataKey, wrappedKey: wrapped.data)
            next.wrappingKeyId = wrapped.keyId
        } else {
            record = try codec.seal(value, namespace: namespace, key: key, mode: 0,
                                    keyId: "ungated", dataKey: keys.ungated(create: true), wrappedKey: nil)
        }
        let committedVersion = try next.set(key: key, record: codec.encode(record))
        try commit(next)
        return committedVersion
    }

    func get(key: String, ticket: SecureStoreCancellation.Ticket? = nil,
             completion: @escaping (Result<SecureStoreRead, Error>) -> Void) {
        let ticket = ticket ?? cancellation.ticket(key: key)
        let deliver: (Result<SecureStoreRead, Error>) -> Void = { [cancellation] result in
            cancellation.deliver(ticket, result, completion: completion)
        }
        do {
            _ = try SecureStoreValidation.key(key)
            try cancellation.check(ticket)
            guard ticket.key == key else { throw SecureStoreFailure.cancelled }
            guard let data = state.records[key] else {
                deliver(.success(SecureStoreRead(value: nil, version: state.version(key))))
                return
            }
            let record: SecureStoreRecord
            do { record = try codec.decode(data, namespace: namespace, key: key) }
            catch { deliver(Result { try recover(error, key: key, record: nil) }); return }
            if record.mode == 0 {
                deliver(Result {
                    do {
                        return SecureStoreRead(value: try codec.open(record, dataKey: keys.ungated(create: false)), version: state.version(key))
                    } catch { return try recover(error, key: key, record: record) }
                })
                return
            }
            let access: SecAccessControl
            do { access = try keys.accessControl(keyId: record.keyId) }
            catch { deliver(Result { try recover(error, key: key, record: record) }); return }
            let version = state.version(key)
            let authentication = authenticator.makeSession()
            let id = operations.begin(key: key, ticket: ticket, authentication: authentication, completion: deliver)
            authentication.authenticate(accessControl: access) { [weak self] result in
                guard let self = self else { return }
                self.queue.async {
                    guard self.operations.contains(id) else { return }
                    let read: Result<SecureStoreRead, Error> = Result {
                        try self.cancellation.check(ticket)
                        // A rotation during the prompt must never return the previous token.
                        guard self.state.version(key) == version else { throw SecureStoreFailure.stale }
                        try result.get()
                        do {
                            let dataKey = try self.keys.unwrap(record.wrappedKey!, keyId: record.keyId, authentication: authentication)
                            let value = try self.codec.open(record, dataKey: dataKey)
                            try self.cancellation.check(ticket)
                            return SecureStoreRead(value: value, version: version)
                        } catch {
                            try self.cancellation.check(ticket)
                            return try self.recover(error, key: key, record: record)
                        }
                    }
                    self.operations.finish(id, read)
                }
            }
        } catch { deliver(.failure(error)) }
    }

    private func recover(_ error: Error, key: String, record: SecureStoreRecord?) throws -> SecureStoreRead {
        guard SecureStoreRecovery.shouldRemove(error) else { throw error }
        if SecureStoreRecovery.shouldRetire(error), let record = record, record.mode == 1 {
            try keys.retire(keyId: record.keyId)
        }
        var next = state
        try next.remove(key)
        try commit(next)
        return SecureStoreRead(value: nil, version: state.version(key))
    }

    func remove(key: String) throws {
        _ = try SecureStoreValidation.key(key)
        operations.cancel(key: key)
        var next = state
        try next.remove(key)
        try commit(next)
    }

    func clear() throws {
        operations.cancel()
        var next = state
        try next.clear()
        try commit(next)
    }

    func cancelInvalidated() { operations.cancelInvalidated(using: cancellation) }
    func cancel() { cancellation.cancel(); operations.cancel() }
    func background() { cancel() }
    func navigationCommitted() { cancellation.documentChanged(); cancelInvalidated() }
    func teardown() { cancel() }
}
