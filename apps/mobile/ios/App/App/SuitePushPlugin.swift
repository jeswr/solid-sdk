// AUTHORED-BY Codex GPT-6.1-Sol
import Capacitor
import Foundation
import UIKit
import UserNotifications

@objc(SuitePushPlugin)
public class SuitePushPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SuitePushPlugin"
    public let jsName = "SuitePush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTopicMap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "silence", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sign", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeLaunchRoute", returnType: CAPPluginReturnPromise)
    ]
    // CAP calls and callbacks join this queue before touching pending calls.
    private var enableCall: CAPPluginCall?
    private var activation: CAPPluginCall?
    private var installation: String?
    private var activationDeadline: TimeInterval = 0

    override public func load() {
        DispatchQueue.main.async {
            SuitePushCoordinator.shared.install()
            SuitePushCoordinator.shared.onChallenge = { [weak self] in self?.resolveChallenge() }
        }
    }
    private static func permission(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "prompt"
        }
    }
    @objc func status(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["permission": Self.permission(settings.authorizationStatus), "installed": PushKeys.installed(), "platform": "ios"])
        }
    }
    @objc func enable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.enableCall == nil else { call.reject("Push enable is already pending", "BUSY"); return }
            self.enableCall = call
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                DispatchQueue.main.async {
                    guard self.enableCall === call else { return }
                    guard granted else { self.enableCall = nil; call.reject("Notifications are not permitted", "permission-denied"); return }
                    do {
                        let keys = try PushKeys(create: true)
                        let jwk = try PushSigningKey(create: true).publicJWK()
                        SuitePushCoordinator.shared.register { result in
                            guard self.enableCall === call else { return }; self.enableCall = nil
                            switch result {
                            case let .success(token):
                                call.resolve(["pushToken": token, "devicePublicKey": PushCrypto.b64(keys.key.publicKey.x963Representation),
                                              "authSecret": PushCrypto.b64(keys.auth), "deviceSigningKey": jwk])
                            case .failure: call.reject("APNs is unavailable for this build", "push-unavailable")
                            }
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
                            if self.enableCall === call {
                                self.enableCall = nil; SuitePushCoordinator.shared.tokenCompletion = nil
                                call.reject("APNs registration timed out", "push-unavailable")
                            }
                        }
                    } catch { self.enableCall = nil; call.reject("Cannot open the push key store", "push-unavailable") }
                }
            }
        }
    }
    @objc func setTopicMap(_ call: CAPPluginCall) {
        guard let registration = call.getString("registrationId"), let topics = call.getArray("topics") else {
            call.reject("registrationId and topics are required", "INVALID_ARGUMENT"); return
        }
        do {
            let expected: Set<String> = ["index", "kind", "label", "route", "enabled"]
            guard topics.allSatisfy({ value in
                guard let object = value as? [String: Any] else { return false }
                return Set(object.keys) == expected
            }) else { throw PushCrypto.Failure.invalid }
            let bytes = try JSONSerialization.data(withJSONObject: topics)
            guard bytes.count <= 32768 else { throw PushCrypto.Failure.invalid }
            let decoded = try JSONDecoder().decode([PushStore.Topic].self, from: bytes)
            try PushStore.shared().setTopics(registration: registration, topics: decoded); call.resolve()
        } catch { call.reject("Invalid or unavailable topic map", "INVALID_ARGUMENT") }
    }
    @objc func silence(_ call: CAPPluginCall) {
        guard let id = call.getString("registrationId") else { call.reject("registrationId is required", "INVALID_ARGUMENT"); return }
        do { try PushStore.shared().silence(id); call.resolve() }
        catch { call.reject("Cannot silence registration", "INVALID_ARGUMENT") }
    }
    @objc func sign(_ call: CAPPluginCall) {
        guard let method = call.getString("method"), let url = call.getString("url"),
              call.options["body"] == nil || call.getString("body") != nil else {
            call.reject("method and url are required", "INVALID_ARGUMENT"); return
        }
        do {
            let key = try PushSigningKey(create: false)
            let proof = try PushProof.sign(method: method, url: url, body: call.getString("body") ?? "",
                                           timestamp: Int(Date().timeIntervalSince1970), signer: key.sign)
            call.resolve(["proof": proof])
        } catch { call.reject("Cannot sign installation request", "INVALID_ARGUMENT") }
    }
    @objc func activate(_ call: CAPPluginCall) {
        guard let id = call.getString("installationId"), PushPolicy.identifier(id) else { call.reject("Invalid installationId", "INVALID_ARGUMENT"); return }
        DispatchQueue.main.async {
            guard self.activation == nil else { call.reject("Activation is already pending", "BUSY"); return }
            self.activation = call; self.installation = id; self.activationDeadline = Date().timeIntervalSince1970 + 60; self.resolveChallenge()
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
                if self.activation === call {
                    self.activation = nil; self.installation = nil
                    call.reject("Activation challenge timed out; try again", "activation-timeout")
                }
            }
        }
    }
    private func resolveChallenge() {
        guard let call = activation, let id = installation else { return }
        let now = Date().timeIntervalSince1970
        guard now < activationDeadline else {
            activation = nil; installation = nil; call.reject("Activation challenge timed out; try again", "activation-timeout"); return
        }
        guard let nonce = SuitePushCoordinator.shared.challenges.take(id, now: now) else { return }
        activation = nil; installation = nil; call.resolve(["nonce": nonce])
    }
    @objc func disable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.enableCall == nil else { call.reject("Push enable is still pending", "BUSY"); return }
            do {
                try PushStore.shared().silenceAll()
                self.activation?.reject("Push was disabled", "disabled"); self.activation = nil; self.installation = nil
                SuitePushCoordinator.shared.challenges.clear()
                if call.getBool("deleteLocalData") == true {
                    // Registrar confirms relay deletion first. Default disable keeps keys for signed cleanup retries.
                    SuitePushCoordinator.shared.unregister()
                    try PushKeys.delete(); try PushSigningKey.delete(); try PushStore.shared().clear()
                }
                call.resolve()
            } catch { call.reject("Cannot disable push; retry cleanup", "push-unavailable") }
        }
    }
    @objc func consumeLaunchRoute(_ call: CAPPluginCall) {
        do {
            if let launch = try PushStore.shared().consumeLaunch() {
                call.resolve(["launchRoute": ["registrationId": launch.registrationId, "route": launch.route]])
            } else { call.resolve(["launchRoute": NSNull()]) }
        } catch { call.reject("Cannot read launch route", "push-unavailable") }
    }
}
