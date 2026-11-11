// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const project = read("ios/App/App.xcodeproj/project.pbxproj");

function object(id: string): string {
  const block = project.match(
    new RegExp(`^\\t\\t${id}(?: /\\*[^\\n]*?\\*/)? = \\{([\\s\\S]*?)^\\t\\t\\};`, "m"),
  );
  if (!block?.[1]) throw new Error(`Missing project object ${id}`);
  return block[1];
}
function target(name: string): string {
  const id = project.match(
    new RegExp(`([A-F0-9]{24}) /\\* ${name} \\*/ = \\{\\s*isa = PBXNativeTarget;`),
  )?.[1];
  if (!id) throw new Error(`Missing target ${name}`);
  return object(id);
}
function sources(name: string): string[] {
  const id = target(name).match(/([A-F0-9]{24}) \/\* Sources \*\//)?.[1];
  if (!id) throw new Error(`Missing sources for ${name}`);
  return [...object(id).matchAll(/\/\* ([\w.]+) in Sources \*\//g)]
    .map((match) => match[1] as string)
    .sort();
}

test("the app embeds and builds the NSE in both unsigned CI configurations", () => {
  expect(target("NotificationService")).toContain(
    'productType = "com.apple.product-type.app-extension"',
  );
  const dependencyId = project.match(
    /([A-F0-9]{24}) \/\* PBXTargetDependency \*\/ = \{\s*isa = PBXTargetDependency;\s*name = NotificationService;/,
  )?.[1];
  expect(dependencyId).toBeDefined();
  expect(target("App")).toContain(`${dependencyId} /* PBXTargetDependency */`);
  const embedPhase = target("App").match(
    /([A-F0-9]{24}) \/\* Embed Foundation Extensions \*\//,
  )?.[1];
  expect(embedPhase).toBeDefined();
  expect(object(embedPhase ?? "")).toContain(
    "NotificationService.appex in Embed Foundation Extensions",
  );
  expect(
    project.match(
      /CODE_SIGN_ENTITLEMENTS = NotificationService\/NotificationService.entitlements;/g,
    ),
  ).toHaveLength(2);
  expect(project.match(/INFOPLIST_FILE = NotificationService\/Info.plist;/g)).toHaveLength(2);
  expect(project).toContain("APS_ENVIRONMENT = development;");
  expect(project).toContain("APS_ENVIRONMENT = production;");
});

test("NSE and app share the crypto core with signing compiled into the app alone", () => {
  const shared = [
    "PushCompletion.swift",
    "PushCrypto.swift",
    "PushKeys.swift",
    "PushPolicy.swift",
    "PushReceiver.swift",
    "PushStore.swift",
  ];
  expect(sources("NotificationService")).toEqual([...shared, "NotificationService.swift"].sort());
  for (const file of [
    ...shared,
    "PushActivation.swift",
    "PushSigningKey.swift",
    "SuitePushCoordinator.swift",
    "SuitePushPlugin.swift",
  ]) {
    expect(sources("App")).toContain(file);
  }
  for (const file of ["PushCryptoTests.swift", "PushProofTests.swift", "PushStateTests.swift"])
    expect(sources("AppTests")).toContain(file);
  expect(read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme")).toContain(
    'BuildableName = "AppTests.xctest"',
  );
});

test("the NSE shares only decryption credentials and defaults filtering off", () => {
  const entitlements = read("ios/App/NotificationService/NotificationService.entitlements");
  const info = read("ios/App/NotificationService/Info.plist");
  for (const path of [
    "ios/App/App/App.entitlements",
    "ios/App/NotificationService/NotificationService.entitlements",
  ]) {
    expect(read(path)).toContain("<string>group.org.jeswr.suite</string>");
    expect(read(path)).toContain("<string>$(AppIdentifierPrefix)org.jeswr.suite.push</string>");
  }
  expect(entitlements).not.toContain("<string>$(AppIdentifierPrefix)org.jeswr.suite</string>");
  expect(entitlements).not.toContain("com.apple.developer.usernotifications.filtering");
  expect(info).toMatch(/<key>SuitePushFilteringEnabled<\/key>\s*<false\/>/);
  expect(info).toContain("com.apple.usernotifications.service");
  expect(read("ios/App/NotificationService/NotificationService.swift")).toContain(
    "#if SUITE_PUSH_FILTERING",
  );
});

test("both guarded bridges register SuitePush and OS delivery is private", () => {
  expect(read("android/app/src/main/java/org/jeswr/suite/MainActivity.java")).toContain(
    "registerPlugin(SuitePushPlugin.class)",
  );
  expect(read("ios/App/App/MainViewController.swift")).toContain(
    "bridge.registerPluginInstance(SuitePushPlugin())",
  );
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  expect(manifest).toMatch(
    /<service android:name="\.SuitePushService" android:exported="false" android:directBootAware="true">/,
  );
  expect(manifest).toContain("android.permission.POST_NOTIFICATIONS");
  for (const flag of [
    "firebase_messaging_auto_init_enabled",
    "firebase_messaging_notification_delegation_enabled",
  ]) {
    expect(manifest).toContain(`<meta-data android:name="${flag}" android:value="false" />`);
  }
  const gradle = read("android/app/build.gradle");
  expect(gradle).toContain('implementation "com.google.firebase:firebase-messaging:24.1.2"');
  expect(gradle).toContain("def servicesJSON = file('google-services.json')");
  expect(read("ios/App/App/Info.plist")).toContain("<string>remote-notification</string>");
  expect(read("ios/App/App/SceneDelegate.swift")).toContain(
    "connectionOptions.notificationResponse",
  );
});

test("iOS delivery paths share request-bound presentation claims and strip rejected payloads", () => {
  const service = read("ios/App/NotificationService/NotificationService.swift");
  const coordinator = read("ios/App/App/SuitePushCoordinator.swift");
  expect(service).toContain(
    "generic.userInfo = PushReceiver.placeholderInfo(request.content.userInfo)",
  );
  expect(service).toContain(
    "accept($0, request: request.identifier, localReplacement: Self.filtering)",
  );
  expect(service).toContain(
    "content.userInfo[PushReceiver.presentationKey] = delivery.presentationToken",
  );
  expect(coordinator).toContain(
    "safe.userInfo[PushReceiver.presentationKey] = delivery.presentationToken",
  );
  expect(coordinator).toContain("notification.request.trigger is UNPushNotificationTrigger");
  expect(coordinator).toContain(".remote(request: notification.request.identifier, token: token)");
  expect(coordinator).toContain(".local(request: notification.request.identifier, token: token)");
  expect(coordinator).toContain("withPresentation(payload, source: source)");
  const receiver = read("ios/App/Shared/PushReceiver.swift");
  expect(receiver).toContain('safe.removeValue(forKey: "p")');
  expect(receiver).toContain("safe.removeValue(forKey: presentationKey)");
});

test("Android foreground and background data delivery use the same deduplicating service", () => {
  const service = read("android/app/src/main/java/org/jeswr/suite/SuitePushService.java");
  const receiver = read("android/app/src/main/java/org/jeswr/suite/PushReceiver.java");
  expect(service).toContain('PushReceiver.receive(message.getData().get("p")');
  expect(service).toContain("() -> SuitePushPlugin.store(this)");
  expect(receiver).toContain("PushStore.Delivery delivery = store.accept(payload)");
  expect(service).toContain("result.kind == PushReceiver.Kind.NOTIFY");
  expect(service).toContain("SuitePushPlugin.store(this).withActive(result.payload");
});

test("every iOS enable requests APNs and unsolicited rotations reach durable state", () => {
  const registration = read("ios/App/App/PushActivation.swift");
  const coordinator = read("ios/App/App/SuitePushCoordinator.swift");
  const plugin = read("ios/App/App/SuitePushPlugin.swift");
  expect(registration).not.toContain("if let token = token");
  expect(registration).toContain("self.completion = completion; request()");
  expect(registration).toContain("try recordToken(token)");
  expect(coordinator).toContain("PushTokenRegistration(recordToken:");
  expect(coordinator).toContain("try PushStore.shared().recordToken(token)");
  expect(coordinator).toContain("UIApplication.shared.registerForRemoteNotifications()");
  expect(plugin).toContain("self.enablement.finish(call)");
  expect(plugin).toContain("SuitePushCoordinator.shared.cancelRegistration()");
  expect(plugin).toContain('"registrationStale": try PushStore.shared().registrationStale()');
  expect(plugin).toContain('pushToken: call.getString("pushToken")');
});

test("Android requests Firebase's current token and records service rotations without a bridge", () => {
  const plugin = read("android/app/src/main/java/org/jeswr/suite/SuitePushPlugin.java");
  const service = read("android/app/src/main/java/org/jeswr/suite/SuitePushService.java");
  expect(plugin).toContain("FirebaseMessaging.getInstance().getToken().addOnCompleteListener");
  expect(plugin).toContain("enablement.finish(call");
  expect(plugin).toContain("store(getContext()).recordToken(task.getResult())");
  expect(service).toContain("@Override public void onNewToken(String token)");
  expect(service).toContain("SuitePushPlugin.store(this).recordToken(token)");
  expect(plugin).toContain(
    'result.put("registrationStale", store(getContext()).registrationStale())',
  );
  expect(plugin).toContain(
    'args.containsKey("pushToken") ? PushJson.string(args.get("pushToken")) : null',
  );
});

test("both native proof signers share one relay-verified interop fixture", () => {
  const input = /[\w-]{40,}\.[\w-]{40,}/u;
  const android = read("android/app/src/test/java/org/jeswr/suite/PushProofTest.java").match(
    new RegExp(`String expected = "(${input.source})"`, "u"),
  )?.[1];
  const ios = read("ios/App/AppTests/PushProofTests.swift").match(
    new RegExp(`let expected = "(${input.source})"`, "u"),
  )?.[1];
  const relay = read("../notification-relay/src/device-proof-interop.test.ts");
  expect(android).toBeDefined();
  expect(ios).toBe(android);
  expect(relay).toContain(`"${android}"`);
  for (const signer of [
    "android/app/src/main/java/org/jeswr/suite/PushProof.java",
    "ios/App/App/PushSigningKey.swift",
  ])
    expect(read(signer)).toContain('installation-proof+jwt\\"}"');
});

test("relay and both native decryptors share the exact encrypted challenge and activity fixtures", () => {
  const files = [
    "../notification-relay/src/push-payload-interop.test.ts",
    "android/app/src/test/java/org/jeswr/suite/PushPayloadInteropTest.java",
    "ios/App/AppTests/PushCryptoTests.swift",
  ].map(read);
  for (const name of ["challengeCiphertext", "activityCiphertext"]) {
    const fixtures = files.map(
      (source) => source.match(new RegExp(`${name} =\\s*"([A-Za-z0-9_-]+)"`, "u"))?.[1],
    );
    expect(fixtures[0]).toMatch(/^[A-Za-z0-9_-]{820}$/u);
    expect(fixtures[1]).toBe(fixtures[0]);
    expect(fixtures[2]).toBe(fixtures[0]);
  }
});
