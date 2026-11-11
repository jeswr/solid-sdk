// AUTHORED-BY Codex GPT-6
package org.jeswr.suite;

import static org.junit.Assert.*;
import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.ECPrivateKeySpec;
import org.junit.Test;

/** Full Suite payloads emitted by the relay, not merely the RFC's unpadded text vector. */
public class PushPayloadInteropTest {
    static final String challengeCiphertext = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_e3c0XWOO2NEjY8bRb6hUOrDe25ugBXpzQpS5L1uKoEq3eXzohA23eUgT3yBmNzBkSBusco1_xiaN0-ceddC7p-iv7zcNFWrvIfas3XzNG1-h3nD0KurUZ_p9NPEU4Q9pxrU3oDH4i6D9RcYd5nwf_ai1mkt8-avX_-3RuH70vZ-CRXZhtydj5YDb9RpszcIff3UtUog4e6RouSCTUdNbtUXPfWqbetnILoV_jpUUn3D6OPmf2TfXVfbq7jMMcCceRAGDX2PdO76lIb86FVFmADbrRfZyCHRtCS9uBwc9Wt-13U2vGPvr1KL4BuR5vTUTIlw7uWdUD6LFsNRjYLopkGGct0x3KfvsFNnij3NXU0z_BPYMALWhNQPtv6oUUwkfEIqeIhP0r3kIOE6Y6EgnK-Wm8zcWwBaQLzVJAdkMZWclNgxxPWjh1KSUuDI5KyAqSgEeMzbn2acbGHJASP4h_UcZh9CnAs0dDttawywBliEi1nVUJc3SM4mcanCllgOJNHRUeFnsSlKqdFtynLH9pZARxnLRvnRhS_vuxDWNj3tqlLQGK-PGBDyUU_x1ujXk1Fw8bht4OtLOOfGdr_VFB_U7Kifg6XO9pSMxFqNQkbF9btUbo3rjnA5KdiaBf8Fv_RA2CcHQJ1jnxSSrRv3NbRdt2dTKpOuOxDqvevadjHP2UPQEezIVSOjTTR9Lza3ls";
    static final String activityCiphertext = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_e3c0XWOO2NEjY8bRb6xQNrza34e8AX5_TpC9E2eOpSvXdXDsgBGrfUwf0nk-NzBkSBusco1_xiaN04YnUODvpv26qy9RDR6HTYYMnFGYK_-82yWoUpvdGuZ5eagZqXtZIqkrEGjh9ozFJMs41hSnlK3J1kM1PG4CMijMPac94eYnyLNcBrbnpD1KqRJcxI8KRiSoAoBQP8Qo-WDTEZMb9QWPPB6betnILoV_jpUUn3D6OPmf2TfXVfbq7jMMcCceRAGDX2PdO76lIb86FVFmADbrRfZyCHRtCS9uBwc9Wt-13U2vGPvr1KL4BuR5vTUTIlw7uWdUD6LFsNRjYLopkGGct0x3KfvsFNnij3NXU0z_BPYMALWhNQPtv6oUUwkfEIqeIhP0r3kIOE6Y6EgnK-Wm8zcWwBaQLzVJAdkMZWclNgxxPWjh1KSUuDI5KyAqSgEeMzbn2acbGHJASP4h_UcZh9CnAs0dDttawywBliEi1nVUJc3SM4mcanCllgOJNHRUeFnsSlKqdFtynLH9pZARxnLRvnRhS_vuxDWNj3tqlLQGK-PGBDyUU_x1ujXk1Fw8bht4OtLOOfGdr_VFB_U7Kifg6XO9pSMxFqNQkbF9btUbo3rjnA5KdiaBf8Fv_RA2CcHQJ1jnxSSrRv3NbRdt2dTKpOuOxDqvevadjHP0qZsRSheFUoDh3_fE34yDH";

    static PushPolicy.Payload parse(String ciphertext) throws Exception {
        PrivateKey key = KeyFactory.getInstance("EC").generatePrivate(new ECPrivateKeySpec(new BigInteger(1,
            PushCrypto.unb64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94")), PushCrypto.curve()));
        return PushPolicy.plaintext(PushCrypto.decrypt(ciphertext, key,
            PushCrypto.unb64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"), PushCrypto.unb64("BTBZMqHH6r4Tts7J_aSIgg")));
    }
    @Test public void decryptsAndValidatesRelayChallengeAndActivity() throws Exception {
        PushPolicy.Payload challenge = parse(challengeCiphertext);
        assertEquals("00112233445566778899aabbccddeeff", challenge.id);
        assertEquals("challenge", challenge.kind);
        assertEquals("phone-1", challenge.registrationId);
        assertEquals(0, challenge.topicIndex);
        assertEquals("AAECAwQFBgcICQoLDA0ODw", challenge.nonce);
        PushPolicy.Payload activity = parse(activityCiphertext);
        assertEquals("112233445566778899aabbccddeeff00", activity.id);
        assertEquals("chat", activity.kind);
        assertEquals("account-1", activity.registrationId);
        assertEquals(3, activity.topicIndex);
        assertNull(activity.nonce);
    }
}
