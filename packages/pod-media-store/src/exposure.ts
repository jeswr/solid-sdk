// AUTHORED-BY Claude Sonnet 5.5

export type ExposureState = "private" | "exposed" | "unknown";

/**
 * Reports whether `containerUrl` can be read by the public or by agents other than the owner.
 * It must be read-only: this package never writes `.acl` or `.acr` and never widens access.
 */
export type ExposureCheck = (containerUrl: string, signal?: AbortSignal) => Promise<ExposureState>;

/** The structural subset of `@jeswr/pod-access` `checkOwnerOnly`'s result that is used here. */
export type OwnerOnlyLike =
  | { readonly private: true }
  | {
      readonly private: false;
      readonly reasons: readonly { readonly reason: string; readonly subject?: string }[];
    };

/**
 * Adapt `@jeswr/pod-access` `checkOwnerOnly` to an {@link ExposureCheck}:
 *
 * ```ts
 * exposure: exposureFromOwnerOnly((url, signal) =>
 *   checkOwnerOnly({ storage, url, ownerWebId, acpDialect }))
 * ```
 *
 * An explicit non-owner grant is "exposed"; every inconclusive outcome (unknown policy,
 * unrepresentable rule, LWS, root not provable) and every failure of the check is "unknown",
 * never "private".
 */
export function exposureFromOwnerOnly(
  check: (containerUrl: string, signal?: AbortSignal) => Promise<OwnerOnlyLike>,
): ExposureCheck {
  return async (containerUrl, signal) => {
    let result: OwnerOnlyLike;
    try {
      result = await check(containerUrl, signal);
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return "unknown";
    }
    if (result.private) return "private";
    return result.reasons.some((entry) => entry.reason === "non-owner") ? "exposed" : "unknown";
  };
}
