// AUTHORED-BY Claude Opus 5.5
import Capacitor
import UIKit

/// Replaces @capacitor/share 8.0.3's "Share" plugin, which hands any `file:` URL the page names to
/// the share sheet. Files must be committed share-out files (SuiteShareStagingPlugin) and the URL
/// must be https without credentials, matching @jeswr/suite-native's share() checks.
@objc(SuiteSharePlugin)
public class SuiteSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuiteSharePlugin"
    public let jsName = "Share"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "canShare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]
    static let maxText = 10_000
    static let maxFiles = 20

    @objc func canShare(_ call: CAPPluginCall) {
        call.resolve(["value": true])
    }

    /// The share-sheet items for a request, or nil when any field is unacceptable.
    static func items(text: Any?, url: Any?, files: Any?, committed: (URL) -> URL?) -> [Any]? {
        var items = [Any]()
        if let rawText = text {
            guard let string = rawText as? String, string.utf16.count <= maxText else { return nil }
            items.append(string)
        }
        if let rawURL = url {
            guard let raw = rawURL as? String, let parsed = URL(string: raw), parsed.scheme == "https",
                  !(parsed.host ?? "").isEmpty, parsed.user == nil, parsed.password == nil else { return nil }
            items.append(parsed)
        }
        if let rawFiles = files {
            guard let list = rawFiles as? [Any], list.count <= maxFiles else { return nil }
            for entry in list {
                guard let raw = entry as? String, let parsed = URL(string: raw), let file = committed(parsed) else {
                    return nil
                }
                items.append(file)
            }
        }
        return items.isEmpty ? nil : items
    }

    @objc func share(_ call: CAPPluginCall) {
        let title = call.options["title"]
        let titleOK = title == nil || ((title as? String).map { $0.utf16.count <= Self.maxText } ?? false)
        guard titleOK,
              let items = Self.items(text: call.options["text"], url: call.options["url"], files: call.options["files"],
                                     committed: SuiteShareStagingPlugin.committedFile) else {
            call.reject("Share needs text, an https url or staged files", "INVALID_ARGUMENT")
            return
        }
        DispatchQueue.main.async { [weak self] in
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            if let title = title as? String { sheet.setValue(title, forKey: "subject") }
            sheet.completionWithItemsHandler = { activityType, completed, _, error in
                if error != nil {
                    call.reject("Error sharing item", nil, error)
                } else if completed {
                    call.resolve(["activityType": activityType?.rawValue ?? ""])
                } else {
                    call.reject("Share canceled")
                }
            }
            var presenter = self?.bridge?.viewController
            while let presented = presenter?.presentedViewController {
                if presented is UIActivityViewController {
                    call.reject("Can't share while sharing is in progress")
                    return
                }
                presenter = presented
            }
            if let popover = sheet.popoverPresentationController, let view = presenter?.view {
                popover.sourceView = view
                popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            guard let presenter = presenter else {
                call.reject("Share is unavailable")
                return
            }
            presenter.present(sheet, animated: true)
        }
    }
}
