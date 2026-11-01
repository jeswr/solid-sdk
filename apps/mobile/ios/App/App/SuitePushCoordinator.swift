// AUTHORED-BY Codex GPT-6.1-Sol
import Foundation
import UIKit
import UserNotifications

/// Installed at application launch (before the WebView) and restored after Capacitor installs its router.
final class SuitePushCoordinator: NSObject, UNUserNotificationCenterDelegate {
    static let shared = SuitePushCoordinator()
    let challenges = PushActivation()
    var onChallenge: (() -> Void)?
    var tokenCompletion: ((Result<String, Error>) -> Void)?
    private var token: String?

    func install() { UNUserNotificationCenter.current().delegate = self }
    func register(_ completion: @escaping (Result<String, Error>) -> Void) {
        if let token = token { completion(.success(token)); return }
        tokenCompletion = completion
        UIApplication.shared.registerForRemoteNotifications()
    }
    func registered(_ bytes: Data) {
        token = bytes.map { String(format: "%02x", $0) }.joined()
        let completion = tokenCompletion; tokenCompletion = nil
        if let token = token { completion?(.success(token)) }
    }
    func registrationFailed(_ error: Error) {
        let completion = tokenCompletion; tokenCompletion = nil; completion?(.failure(error))
    }
    func unregister() {
        UIApplication.shared.unregisterForRemoteNotifications(); token = nil; tokenCompletion = nil
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
        completionHandler([.banner, .list, .sound])
    }
}
