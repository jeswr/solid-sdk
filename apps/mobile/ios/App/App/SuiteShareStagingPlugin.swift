// AUTHORED-BY GPT-5.6 Codex
import Foundation
import CoreFoundation
import Capacitor

@objc(SuiteShareStagingPlugin)
public class SuiteShareStagingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuiteShareStagingPlugin"
    public let jsName = "SuiteShareStaging"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "org.jeswr.suite.share-staging")
    private var cachedStore: ShareOutStore?

    private func store() throws -> ShareOutStore {
        if let store = cachedStore { return store }
        let store = try ShareOutStore()
        cachedStore = store
        return store
    }

    override public func load() {
        queue.async { try? self.store().evict() }
    }

    /// Inspect the original value: Capacitor's numeric accessors can coerce booleans/fractions.
    private func integer(_ call: CAPPluginCall, _ key: String) throws -> Int64 {
        guard let number = call.options[key] as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { throw ShareOutStore.Failure.invalid }
        let value = number.doubleValue
        guard value.isFinite, value >= 0, value <= Double(ShareOutStore.maxBytes), value.rounded() == value else {
            throw ShareOutStore.Failure.invalid
        }
        return Int64(value)
    }

    @objc func begin(_ call: CAPPluginCall) {
        queue.async {
            do {
                guard let name = call.getString("name"), let mime = call.getString("mimeType") else {
                    throw ShareOutStore.Failure.invalid
                }
                let id = try self.store().begin(name: name, mimeType: mime, size: self.integer(call, "size"))
                call.resolve(["stagingId": id])
            } catch { call.reject("Cannot begin staging", "INVALID_ARGUMENT") }
        }
    }

    @objc func writeChunk(_ call: CAPPluginCall) {
        queue.async {
            let id = call.getString("stagingId") ?? ""
            do {
                guard let encoded = call.getString("data"), !encoded.isEmpty,
                      encoded.utf8.count <= 4 * ((ShareOutStore.maxChunkBytes + 2) / 3),
                      let data = Data(base64Encoded: encoded), data.base64EncodedString() == encoded else {
                    throw ShareOutStore.Failure.invalid
                }
                try self.store().writeChunk(id: id, offset: self.integer(call, "offset"), data: data)
                call.resolve()
            } catch { self.fail(call, id: id) }
        }
    }

    @objc func commit(_ call: CAPPluginCall) {
        queue.async {
            let id = call.getString("stagingId") ?? ""
            do { call.resolve(["uri": try self.store().commit(id: id).absoluteString]) }
            catch { self.fail(call, id: id) }
        }
    }

    @objc func abort(_ call: CAPPluginCall) {
        queue.async {
            guard let id = call.getString("stagingId"), ShareOutStore.isId(id) else {
                call.reject("Invalid staging id", "INVALID_ARGUMENT")
                return
            }
            do { try self.store().abort(id); call.resolve() }
            catch { call.reject("Cannot abort staging", "STAGING_FAILED") }
        }
    }

    private func fail(_ call: CAPPluginCall, id: String) {
        try? store().abort(id)
        call.reject("Cannot stage file", "STAGING_FAILED")
    }
}
