// AUTHORED-BY Codex GPT-6
import { expect, test } from "vitest";
import { auth, receiverPublic } from "../test/delivery-fixtures.js";
import { encryptPayload } from "./push-crypto.js";
import { activityPayload, challengePayload } from "./push-payload.js";

// RFC 8291 section 5 device keys/auth, salt and sender scalar: public test material only.
// The Java and Swift tests decrypt these exact full-size Suite payloads and validate their schema.
const challengeCiphertext =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_e3c0XWOO2NEjY8bRb6hUOrDe25ugBXpzQpS5L1uKoEq3eXzohA23eUgT3yBmNzBkSBusco1_xiaN0-ceddC7p-iv7zcNFWrvIfas3XzNG1-h3nD0KurUZ_p9NPEU4Q9pxrU3oDH4i6D9RcYd5nwf_ai1mkt8-avX_-3RuH70vZ-CRXZhtydj5YDb9RpszcIff3UtUog4e6RouSCTUdNbtUXPfWqbetnILoV_jpUUn3D6OPmf2TfXVfbq7jMMcCceRAGDX2PdO76lIb86FVFmADbrRfZyCHRtCS9uBwc9Wt-13U2vGPvr1KL4BuR5vTUTIlw7uWdUD6LFsNRjYLopkGGct0x3KfvsFNnij3NXU0z_BPYMALWhNQPtv6oUUwkfEIqeIhP0r3kIOE6Y6EgnK-Wm8zcWwBaQLzVJAdkMZWclNgxxPWjh1KSUuDI5KyAqSgEeMzbn2acbGHJASP4h_UcZh9CnAs0dDttawywBliEi1nVUJc3SM4mcanCllgOJNHRUeFnsSlKqdFtynLH9pZARxnLRvnRhS_vuxDWNj3tqlLQGK-PGBDyUU_x1ujXk1Fw8bht4OtLOOfGdr_VFB_U7Kifg6XO9pSMxFqNQkbF9btUbo3rjnA5KdiaBf8Fv_RA2CcHQJ1jnxSSrRv3NbRdt2dTKpOuOxDqvevadjHP2UPQEezIVSOjTTR9Lza3ls";
const activityCiphertext =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_e3c0XWOO2NEjY8bRb6xQNrza34e8AX5_TpC9E2eOpSvXdXDsgBGrfUwf0nk-NzBkSBusco1_xiaN04YnUODvpv26qy9RDR6HTYYMnFGYK_-82yWoUpvdGuZ5eagZqXtZIqkrEGjh9ozFJMs41hSnlK3J1kM1PG4CMijMPac94eYnyLNcBrbnpD1KqRJcxI8KRiSoAoBQP8Qo-WDTEZMb9QWPPB6betnILoV_jpUUn3D6OPmf2TfXVfbq7jMMcCceRAGDX2PdO76lIb86FVFmADbrRfZyCHRtCS9uBwc9Wt-13U2vGPvr1KL4BuR5vTUTIlw7uWdUD6LFsNRjYLopkGGct0x3KfvsFNnij3NXU0z_BPYMALWhNQPtv6oUUwkfEIqeIhP0r3kIOE6Y6EgnK-Wm8zcWwBaQLzVJAdkMZWclNgxxPWjh1KSUuDI5KyAqSgEeMzbn2acbGHJASP4h_UcZh9CnAs0dDttawywBliEi1nVUJc3SM4mcanCllgOJNHRUeFnsSlKqdFtynLH9pZARxnLRvnRhS_vuxDWNj3tqlLQGK-PGBDyUU_x1ujXk1Fw8bht4OtLOOfGdr_VFB_U7Kifg6XO9pSMxFqNQkbF9btUbo3rjnA5KdiaBf8Fv_RA2CcHQJ1jnxSSrRv3NbRdt2dTKpOuOxDqvevadjHP0qZsRSheFUoDh3_fE34yDH";

const entropy = {
  salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
  ephemeral: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
};

test("both builders use native-safe random identifiers and integer timestamps", () => {
  const payloads = [
    challengePayload("phone-1", "AAECAwQFBgcICQoLDA0ODw", 0.75),
    activityPayload("account-1", 15, "inbox", 0.75),
  ];
  for (const payload of payloads) {
    expect(payload.id).toMatch(/^[a-f0-9]{32}$/u);
    expect(payload.registrationId).toMatch(/^[A-Za-z0-9_-]{1,128}$/u);
    expect(payload.sentAt).toBe(0);
  }
  expect(payloads[0]?.id).not.toBe(payloads[1]?.id);
});

test("relay challenge and activity builders produce the exact native-decryptable wire fixtures", () => {
  const challenge = challengePayload(
    "phone-1",
    "AAECAwQFBgcICQoLDA0ODw",
    1_800_000_000_000.75,
    "00112233445566778899aabbccddeeff",
  );
  const activity = activityPayload(
    "account-1",
    3,
    "chat",
    1_800_000_000_000.75,
    "112233445566778899aabbccddeeff00",
  );
  expect(challenge).toEqual({
    v: 1,
    id: "00112233445566778899aabbccddeeff",
    kind: "challenge",
    registrationId: "phone-1",
    topicIndex: 0,
    nonce: "AAECAwQFBgcICQoLDA0ODw",
    sentAt: 1_800_000_000_000,
  });
  expect(activity).toEqual({
    v: 1,
    id: "112233445566778899aabbccddeeff00",
    kind: "chat",
    registrationId: "account-1",
    topicIndex: 3,
    sentAt: 1_800_000_000_000,
  });
  expect(encryptPayload(challenge, receiverPublic, auth, entropy)).toBe(challengeCiphertext);
  expect(encryptPayload(activity, receiverPublic, auth, entropy)).toBe(activityCiphertext);
});
