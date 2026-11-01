// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import Foundation
import UserNotifications

/// Encrypted alert replacement only. Challenges use the app's background push callback, never alerts.
@objc(NotificationService)
final class NotificationService: UNNotificationServiceExtension {
    private let requestLock = NSLock()
    private var current: PushCompletion<UNNotificationContent>?
    private static var filtering: Bool {
        #if SUITE_PUSH_FILTERING
        return Bundle.main.object(forInfoDictionaryKey: "SuitePushFilteringEnabled") as? Bool == true
        #else
        return false
        #endif
    }
    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        let generic = UNMutableNotificationContent()
        generic.title = "Solid Suite"; generic.body = PushPolicy.generic
        generic.userInfo = PushReceiver.placeholderInfo(request.content.userInfo)
        let completion = PushCompletion<UNNotificationContent>(placeholder: generic, callback: contentHandler)
        requestLock.lock(); current = completion; requestLock.unlock()
        let keys: PushKeys
        do { keys = try PushKeys() }
        catch {
            finishFallback(completion, readable: !(error is PushKeys.Locked))
            return
        }
        let outcome = PushReceiver.receive(request.content.userInfo["p"] as? String, readable: true, filtering: Self.filtering,
            decrypt: { try PushCrypto.decrypt($0, key: keys.key, auth: keys.auth) },
            accept: { try PushStore.shared().accept($0, request: request.identifier, localReplacement: Self.filtering) })
        switch outcome {
        case .placeholder: completion.expire()
        case .hidden: completion.finish(UNMutableNotificationContent())
        case let .notify(delivery):
            let payload = delivery.payload
            let content = UNMutableNotificationContent()
            content.title = "Solid Suite"; content.body = delivery.body + (delivery.count > 1 ? " (\(delivery.count))" : "")
            content.threadIdentifier = payload.kind; content.userInfo = request.content.userInfo
            content.userInfo["suitePushGroup"] = delivery.group
            content.userInfo[PushReceiver.presentationKey] = delivery.presentationToken
            let center = UNUserNotificationCenter.current()
            center.getDeliveredNotifications { notifications in
                guard completion.pending else { return }
                do {
                    let active = try PushStore.shared().withActive(payload) {
                        let previous = notifications.filter {
                            $0.request.content.userInfo["suitePushGroup"] as? String == delivery.group
                        }.map { $0.request.identifier }
                        center.removeDeliveredNotifications(withIdentifiers: previous)
                        if Self.filtering {
                            // A local request can use the stable topic id when the remote alert can be suppressed.
                            let replacement = UNNotificationRequest(identifier: delivery.group, content: content, trigger: nil)
                            if completion.finish(UNMutableNotificationContent()) { center.add(replacement, withCompletionHandler: nil) }
                        } else {
                            // APNs request.identifier is immutable in an NSE. Replace delivered content per topic.
                            completion.finish(content)
                        }
                    }
                    if !active { self.finishFallback(completion, readable: true) }
                } catch { self.finishFallback(completion, readable: true) }
            }
        }
    }
    private func finishFallback(_ completion: PushCompletion<UNNotificationContent>, readable: Bool) {
        if PushPolicy.fallback(filtering: Self.filtering, readable: readable) { completion.finish(UNMutableNotificationContent()) }
        else { completion.expire() }
    }
    override func serviceExtensionTimeWillExpire() {
        requestLock.lock(); let completion = current; requestLock.unlock()
        completion?.expire()
    }
}
