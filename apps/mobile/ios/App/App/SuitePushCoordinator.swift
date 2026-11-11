// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import Foundation
import UIKit
import UserNotifications

/// Installed at application launch (before the WebView) and restored after Capacitor installs its router.
final class SuitePushCoordinator: NSObject, UNUserNotificationCenterDelegate {
    static let shared = SuitePushCoordinator()
    private static let renewalId = "suite-push-renewal"
    private let renewalLock = NSRecursiveLock()
    let challenges = PushActivation()
    var onChallenge: (() -> Void)?
    private let registration = PushTokenRegistration(recordToken: { token in
        // No bridge call is needed for rotation. Never recreate push state after confirmed cleanup.
        if PushKeys.installed() { try PushStore.shared().recordToken(token) }
    })

    func install() { UNUserNotificationCenter.current().delegate = self }
    func register(_ completion: @escaping (Result<String, Error>) -> Void) {
        registration.register(completion) { UIApplication.shared.registerForRemoteNotifications() }
    }
    func registered(_ bytes: Data) {
        registration.registered(bytes.map { String(format: "%02x", $0) }.joined())
    }
    func registrationFailed(_ error: Error) {
        registration.failed(error)
    }
    func unregister() {
        registration.clear(); UIApplication.shared.unregisterForRemoteNotifications()
    }
    func cancelRegistration() { registration.cancel() }
    func cancelRenewalReminder() throws {
        renewalLock.lock(); defer { renewalLock.unlock() }
        try PushStore.shared().setRenewalExpiry(nil)
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.renewalId])
        center.removeDeliveredNotifications(withIdentifiers: [Self.renewalId])
    }
    func scheduleRenewalReminder(_ expiry: Double?, completion: @escaping (Error?) -> Void) throws {
        renewalLock.lock(); defer { renewalLock.unlock() }
        try cancelRenewalReminder()
        guard let expiry = expiry else { completion(nil); return }
        let now = Date().timeIntervalSince1970 * 1000
        let trigger = PushPolicy.renewalTrigger(expiry, now: now)
        guard trigger < expiry else { completion(nil); return }
        try PushStore.shared().setRenewalExpiry(expiry)
        let content = UNMutableNotificationContent()
        content.title = "Solid Suite"; content.body = PushPolicy.renewal
        content.userInfo = ["suitePushRenewalExpiry": expiry]
        let request = UNNotificationRequest(identifier: Self.renewalId, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, (trigger - now) / 1000), repeats: false))
        UNUserNotificationCenter.current().add(request, withCompletionHandler: completion)
    }
    private func presentRenewal(_ notification: UNNotification, completion: PushCompletion<UNNotificationPresentationOptions>) -> Bool {
        guard notification.request.identifier == Self.renewalId,
              !(notification.request.trigger is UNPushNotificationTrigger),
              let number = notification.request.content.userInfo["suitePushRenewalExpiry"] as? NSNumber else { return false }
        let expiry = number.doubleValue
        guard expiry.isFinite, expiry.rounded(.towardZero) == expiry else { return false }
        return (try? PushStore.shared().withRenewalReminder(expiry, now: Date().timeIntervalSince1970 * 1000) {
            let content = notification.request.content
            completion.finish(content.title == "Solid Suite" && content.body == PushPolicy.renewal ? [.banner, .list, .sound] : [])
        }) ?? false
    }
    func background(_ info: [AnyHashable: Any], completion: @escaping (UIBackgroundFetchResult) -> Void) {
        // Only authenticated, encrypted challenges use the background path. No local alert is ever scheduled.
        guard let encoded = info["p"] as? String else { completion(.noData); return }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let keys = try PushKeys()
                guard let payload = try PushReceiver.background(encoded, decrypt: {
                    try PushCrypto.decrypt($0, key: keys.key, auth: keys.auth)
                }) else { DispatchQueue.main.async { completion(.noData) }; return }
                DispatchQueue.main.async {
                    self.challenges.deliver(payload, now: Date().timeIntervalSince1970); self.onChallenge?(); completion(.newData)
                }
            } catch { DispatchQueue.main.async { completion(.noData) } }
        }
    }
    func tap(_ response: UNNotificationResponse) {
        // A late tap remains a generic launch even after the subscription expired or signed out.
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           response.notification.request.identifier == Self.renewalId,
           response.notification.request.trigger is UNTimeIntervalNotificationTrigger {
            try? PushStore.shared().launchNotifications(); return
        }
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let encoded = response.notification.request.content.userInfo["p"] as? String else { return }
        // Ignore forged plaintext tap metadata. Re-decrypt p and resolve the route from the current local map.
        do {
            let keys = try PushKeys()
            let payload = try PushPayload(PushCrypto.decrypt(encoded, key: keys.key, auth: keys.auth))
            guard payload.kind != "challenge" else { return }
            try PushStore.shared().launch(registration: payload.registrationId, index: payload.topicIndex)
        } catch { /* Unreadable/unknown state carries no launch route. */ }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        tap(response); completionHandler()
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let completion = PushCompletion<UNNotificationPresentationOptions>(placeholder: [], callback: completionHandler)
        if presentRenewal(notification, completion: completion) { return }
        let info = notification.request.content.userInfo
        let remote = notification.request.trigger is UNPushNotificationTrigger
        let token = info[PushReceiver.presentationKey] as? String
        let source: PushStore.PresentationSource = remote
            ? .remote(request: notification.request.identifier, token: token)
            : .local(request: notification.request.identifier, token: token)
        let presented = PushReceiver.foreground(info["p"] as? String, decrypt: { encoded in
            let keys = try PushKeys()
            return try PushCrypto.decrypt(encoded, key: keys.key, auth: keys.auth)
        }, present: { payload in
            try PushStore.shared().withPresentation(payload, source: source) { delivery in
                let safe = UNMutableNotificationContent()
                safe.title = "Solid Suite"
                safe.body = delivery.body + (delivery.count > 1 ? " (\(delivery.count))" : "")
                safe.threadIdentifier = payload.kind
                safe.userInfo = ["p": info["p"] ?? "", "suitePushGroup": delivery.group]
                safe.userInfo[PushReceiver.presentationKey] = delivery.presentationToken
                if remote {
                    // Suppress remote text. Only a freshly constructed local notice can be presented.
                    if completion.finish([]) {
                        center.add(UNNotificationRequest(identifier: delivery.group, content: safe, trigger: nil), withCompletionHandler: nil)
                    }
                } else {
                    // The one-use local permit and freshly validated content must both match.
                    let content = notification.request.content
                    completion.finish(content.title == safe.title && content.body == safe.body &&
                        content.threadIdentifier == safe.threadIdentifier ? [.banner, .list, .sound] : [])
                }
            }
        })
        if !presented { completion.expire() }
    }
}
