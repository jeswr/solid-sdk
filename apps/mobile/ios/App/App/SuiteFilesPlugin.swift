// AUTHORED-BY Claude Opus 5.5
import Capacitor
import CoreFoundation
import Foundation
import QuickLook
import UIKit

/// The Drive "Open PDF" handoff (MOB-P3 E5): base64 chunks into PdfPreviewStore, then
/// QLPreviewController. The file is deleted when the viewer closes. Only bytes and a display name
/// cross the bridge.
@objc(SuiteFilesPlugin)
public class SuiteFilesPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
    public let identifier = "SuiteFilesPlugin"
    public let jsName = "SuiteFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pdfBegin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pdfChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pdfOpen", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "org.jeswr.suite.pdf-preview")
    private var cachedStore: PdfPreviewStore?
    /// The file the open viewer shows (main thread only).
    private var showing: URL?

    private func store() throws -> PdfPreviewStore {
        if let store = cachedStore { return store }
        let store = try PdfPreviewStore(root: PdfPreviewStore.defaultRoot())
        cachedStore = store
        return store
    }

    override public func load() {
        queue.async { _ = try? self.store() }
    }

    private func reject(_ call: CAPPluginCall, _ error: Error) {
        try? store().clear()
        let code = (error as? PdfPreviewStore.Refused)?.code ?? "failed"
        call.reject(code == "no-viewer" ? "No PDF viewer is available" : "Cannot preview this PDF", code)
    }

    @objc func pdfBegin(_ call: CAPPluginCall) {
        queue.async {
            do {
                // Inspect the original value: Capacitor's numeric accessors coerce booleans and fractions.
                guard let name = call.getString("name"), let number = call.options["size"] as? NSNumber,
                      CFGetTypeID(number) != CFBooleanGetTypeID() else {
                    throw PdfPreviewStore.Refused(code: "invalid")
                }
                let value = number.doubleValue
                guard value.isFinite, value >= 0, value.rounded() == value else {
                    throw PdfPreviewStore.Refused(code: "invalid")
                }
                let size = value > Double(PdfPreviewStore.maxBytes) ? PdfPreviewStore.maxBytes + 1 : Int64(value)
                call.resolve(["handle": try self.store().begin(name: name, size: size)])
            } catch { self.reject(call, error) }
        }
    }

    @objc func pdfChunk(_ call: CAPPluginCall) {
        queue.async {
            do {
                guard let handle = call.getString("handle"), let encoded = call.getString("data"),
                      encoded.utf8.count <= 4 * ((PdfPreviewStore.maxChunkBytes + 2) / 3),
                      let data = Data(base64Encoded: encoded), data.base64EncodedString() == encoded else {
                    throw PdfPreviewStore.Refused(code: "invalid")
                }
                try self.store().append(handle: handle, data: data)
                call.resolve()
            } catch { self.reject(call, error) }
        }
    }

    @objc func pdfOpen(_ call: CAPPluginCall) {
        queue.async {
            do {
                let file = try self.store().finish(handle: call.getString("handle") ?? "")
                DispatchQueue.main.async { self.present(file, call) }
            } catch { self.reject(call, error) }
        }
    }

    private func present(_ file: URL, _ call: CAPPluginCall) {
        guard QLPreviewController.canPreview(file as NSURL), let presenter = topViewController() else {
            queue.async { self.reject(call, PdfPreviewStore.Refused(code: "no-viewer")) }
            return
        }
        let viewer = QLPreviewController()
        viewer.dataSource = self
        viewer.delegate = self
        showing = file
        presenter.present(viewer, animated: true)
        call.resolve()
    }

    private func topViewController() -> UIViewController? {
        var presenter = bridge?.viewController
        while let presented = presenter?.presentedViewController { presenter = presented }
        return presenter
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        showing == nil ? 0 : 1
    }

    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (showing ?? URL(fileURLWithPath: "/dev/null")) as NSURL
    }

    /// Read-only: no markup or editing writes back to the cache.
    public func previewController(_ controller: QLPreviewController,
                                  editingModeFor previewItem: QLPreviewItem) -> QLPreviewItemEditingMode {
        .disabled
    }

    public func previewControllerDidDismiss(_ controller: QLPreviewController) {
        guard let file = showing else { return }
        showing = nil
        queue.async { try? self.store().release(file) }
    }
}
