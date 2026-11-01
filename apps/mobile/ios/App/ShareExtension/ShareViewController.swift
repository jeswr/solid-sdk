// AUTHORED-BY Claude Opus 5.5
import UIKit
import UniformTypeIdentifiers

/// The Share Extension (DESIGN D7): saves what another app shares into the App Group container
/// under the ShareStore caps, then tells the person to open Solid Suite to file it.
@objc(ShareViewController)
final class ShareViewController: UIViewController {
    private let label = UILabel()
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        label.text = NSLocalizedString("Saving for Solid Suite…", comment: "share extension progress")
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .headline)
        label.adjustsFontForContentSizeCategory = true
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        // NSItemProvider callbacks arrive on other queues; this queue waits for each in turn.
        DispatchQueue.global(qos: .userInitiated).async {
            let saved: Bool
            do {
                guard let store = ShareStore.shared() else { throw ShareStore.Failure.rejected("no App Group") }
                guard providers.count <= ShareStore.maxItems else { throw ShareStore.Failure.rejected("too many items") }
                _ = try store.store(try providers.map(Self.incoming))
                saved = true
            } catch {
                saved = false
            }
            DispatchQueue.main.async { self.finish(saved: saved) }
        }
    }

    private func finish(saved: Bool) {
        label.text = saved
            ? NSLocalizedString("Saved for Solid Suite: open the app to file it.", comment: "share extension done")
            : NSLocalizedString("Could not share with Solid Suite: unsupported or too large.", comment: "share extension failed")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            if saved {
                self.extensionContext?.completeRequest(returningItems: nil)
            } else {
                self.extensionContext?.cancelRequest(withError: ShareStore.Failure.rejected("share rejected"))
            }
        }
    }

    // MARK: Reading the providers (blocking; never on the main queue)

    private static func incoming(_ provider: NSItemProvider) throws -> ShareStore.Incoming {
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            guard let url = try loadItem(provider, UTType.url.identifier) as? URL else {
                throw ShareStore.Failure.rejected("unreadable url")
            }
            return .url(url.absoluteString, title: provider.suggestedName)
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
           !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
           let text = try? loadItem(provider, UTType.plainText.identifier) as? String {
            return .text(text)
        }
        let type = provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .data) == true }
            ?? UTType.data.identifier
        return .file(name: provider.suggestedName, mimeType: UTType(type)?.preferredMIMEType) { body in
            let done = DispatchSemaphore(value: 0)
            var failure: Error?
            _ = provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                defer { done.signal() }
                guard let url = url else {
                    failure = error ?? ShareStore.Failure.rejected("no file")
                    return
                }
                do { try body(url) } catch { failure = error }
            }
            done.wait()
            if let failure = failure { throw failure }
        }
    }

    private static func loadItem(_ provider: NSItemProvider, _ type: String) throws -> NSSecureCoding? {
        let done = DispatchSemaphore(value: 0)
        var item: NSSecureCoding?
        var failure: Error?
        provider.loadItem(forTypeIdentifier: type, options: nil) { value, error in
            item = value
            failure = error
            done.signal()
        }
        done.wait()
        if let failure = failure { throw failure }
        return item
    }
}
