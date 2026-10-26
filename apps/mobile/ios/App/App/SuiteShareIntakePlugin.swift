// AUTHORED-BY Claude Opus 5.5
import Capacitor
import UIKit

/// Hands batches saved by the Share Extension to the suite (DESIGN D7). An extension cannot open
/// its app, so the plugin announces pending batches whenever the app becomes active. The batch
/// JSON is untrusted on the JavaScript side too: @jeswr/suite-native re-validates it.
@objc(SuiteShareIntakePlugin)
public class SuiteShareIntakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuiteShareIntakePlugin"
    public let jsName = "SuiteShareIntake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "org.jeswr.suite.share-intake")
    private var announced = Set<String>()

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(announcePending), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func announcePending() {
        queue.async {
            guard let store = ShareStore.shared() else { return }
            store.evict()
            for batch in store.pending() where !self.announced.contains(batch.id) {
                self.announced.insert(batch.id)
                self.notifyListeners("shareReceived", data: batch.json)
            }
        }
    }

    @objc func getPending(_ call: CAPPluginCall) {
        queue.async {
            let batches = ShareStore.shared()?.pending().map { $0.json } ?? []
            call.resolve(["batches": batches])
        }
    }

    @objc func readChunk(_ call: CAPPluginCall) {
        guard let batchId = call.getString("batchId"), let index = call.getInt("index"),
              let offset = call.getDouble("offset"), let length = call.getInt("length"),
              offset >= 0, offset <= Double(ShareStore.maxItemBytes), offset.rounded() == offset else {
            call.reject("batchId, index, offset and length are required", "INVALID_ARGUMENT")
            return
        }
        queue.async {
            do {
                guard let store = ShareStore.shared() else { throw ShareStore.Failure.notFound }
                let chunk = try store.readChunk(batchId: batchId, index: index, offset: Int64(offset), length: length)
                call.resolve(["data": chunk.data.base64EncodedString(), "eof": chunk.eof])
            } catch {
                call.reject("Cannot read the shared file", "NOT_FOUND")
            }
        }
    }

    @objc func acknowledge(_ call: CAPPluginCall) {
        let batchId = call.getString("batchId")
        queue.async {
            ShareStore.shared()?.acknowledge(batchId)
            if let batchId = batchId { self.announced.remove(batchId) }
            call.resolve()
        }
    }
}
